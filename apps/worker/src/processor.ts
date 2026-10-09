/* Author: ramanpal singh | URL: https://kwebby.com */
import type { Database,Entity,Collection } from '../../../packages/contracts/src/index.js';
import { assert,DomainError } from '../../../packages/contracts/src/index.js';
import { IntegrationService,MailDeliveryError,RETRIABLE_MAIL } from '../../api/src/integrations.js';
import { entity,asActor,type User } from '../../api/src/auth.js';
import { baseVisible } from '../../../packages/core/src/access.js';
import { notificationConditionApplies,keyedId } from './scheduler.js';
import { failureInfo } from './outbox.js';
import { pages } from '../../api/src/paging.js';
import { deliveryPreferences,nextDeliveryTime,type DeliveryPreferences } from './preferences.js';
import { digest,publicOrigin,installationId } from '../../api/src/security.js';
import type { Redis } from 'ioredis';

class DeferredDelivery extends Error {constructor(readonly until:Date){super('Notification deferred during quiet hours');}}
export class OutboxProcessor {
 constructor(private db:Database,private integrations:IntegrationService,private redis:Redis){}
 async process(id:string){
  if(process.env.OUTBOUND_WORKERS_ENABLED!=='true')return;
  const event=await this.db.transaction([`outbox:${id}`],async tx=>{const row=await tx.get('outbox',id);if(!row||row.status==='completed'||row.status==='failed'||Date.parse(String(row.nextAttemptAt))>Date.now())return null;if(row.status==='processing'&&Date.parse(String(row.leaseUntil))>Date.now())return null;return tx.put('outbox',{...row,status:'processing',attempts:Number(row.attempts)+1,leaseUntil:new Date(Date.now()+120000).toISOString(),version:row.version+1,updatedAt:new Date().toISOString()},row.version);});
  if(!event)return;
  try{await this.handle(event);await this.finish(event,'completed');}
  catch(error){if(error instanceof DeferredDelivery){await this.finish(event,'pending',undefined,error.until,true);return;}const settings=(await this.db.get('settings','notifications'))?.value as {retryLimit?:number}|undefined;const limit=Math.min(10,Math.max(1,Number(settings?.retryLimit??5)));await this.finish(event,Number(event.attempts)>=limit?'failed':'pending',failureInfo(error));throw error;}
 }
 private async finish(event:Entity,status:string,failure?:{errorType:string;failureCode?:string},nextAttempt?:Date,deferred=false){await this.db.transaction([`outbox:${event.id}`],async tx=>{const current=await tx.get('outbox',event.id);assert(current,'OUTBOX','Missing outbox event');if(current.version!==event.version)return;await tx.put('outbox',{...current,status,nextAttemptAt:(nextAttempt??new Date(Date.now()+Math.min(3600000,30000*2**Number(current.attempts)))).toISOString(),attempts:deferred?Math.max(0,Number(current.attempts)-1):current.attempts,leaseUntil:null,lastErrorType:failure?.errorType??null,failureCode:failure?.failureCode??null,completedAt:status==='completed'?new Date().toISOString():null,version:current.version+1,updatedAt:new Date().toISOString()},current.version);});}
 private mailContent(template:string,data:Record<string,any>){
  if(['staff.invitation','verify-email','reset-password'].includes(template)){const title=template==='staff.invitation'?'Your clinic team invitation':template==='verify-email'?'Verify your clinic account':'Reset your clinic password';assert(typeof data.url==='string'&&data.url.startsWith(publicOrigin()+'/'),'MAIL_TEMPLATE','Invalid account URL');return {subject:title,text:`${title}\n\n${data.url}\n\nIf you did not expect this message, you can ignore it.`};}
  if(template==='account.exists'){assert(typeof data.url==='string'&&data.url.startsWith(publicOrigin()+'/'),'MAIL_TEMPLATE','Invalid account URL');return {subject:'Your clinic account',text:`Someone tried to create a new clinic account with this email address, which already has one.\n\nIf this was you, sign in, or reset your password here:\n${data.url}\n\nIf it was not you, you can ignore this message.`};}
  if(template==='tool.report')return {subject:'Your requested clinic planning report',text:`${String(data.summary)}\n\n${(data.items??[]).join('\n')}\n\n${Object.entries(data.values??{}).map(([k,v])=>`${k}: ${v}`).join('\n')}`};
  assert(template==='notification','MAIL_TEMPLATE','Unknown email template');return {subject:'You have an update from your clinic',text:`Sign in securely to read your update:\n${publicOrigin()}/portal\n\nThis email contains no medical or financial details.`};
 }
 private async preferences(userId:string):Promise<DeliveryPreferences>{const [user,clinic]=await Promise.all([this.db.get('preferences',`notification-${userId}`),this.db.get('settings','notifications')]);return deliveryPreferences(user?.value,clinic?.value);}
 private async resourceVisible(user:User,category:string,resourceId:string):Promise<boolean>{
  const candidates:Record<string,Collection[]>={appointments:['appointments'],messages:['conversations'],clinical:['results','encounters','prescriptions','documents','tasks','referrals'],finance:['invoices','payments','refunds','documents','tasks'],hr:['documents','payroll','employees'],operations:['tasks','leads','appointments','documents'],content:['pages','templates','publications'],security:[]};
  if(category==='security')return user.roles.some(role=>['owner','admin'].includes(role));
  for(const collection of candidates[category]??[]){const source=await this.db.get(collection,resourceId);if(source)return baseVisible(collection,source,asActor(user));}
  return false;
 }
 private async email(event:Entity){
  const p=event.payload as any;
  if(p.template==='notification'){
   const user=await this.db.get<User>('users',String(p.userId));if(!user||user.status!=='active'||!user.emailVerified||user.organizationId!==event.organizationId||user.email!==p.to)return;
   if(!await notificationConditionApplies(this.db,user,p.condition))return;
   const preference=await this.preferences(user.id);if(!preference.email||!preference.categories.includes(p.category)||!await this.resourceVisible(user,p.category,p.resourceId))return;
   const allowed=nextDeliveryTime(new Date(),preference);if(allowed.getTime()>Date.now())throw new DeferredDelivery(allowed);
  }
  const content=this.mailContent(p.template,p.data??{});const id=`mail-${event.id}`;const existing=await this.db.get('mailDeliveries',id);if(existing?.status==='smtp-accepted')return;assert(!existing||RETRIABLE_MAIL.includes(String(existing.status)),'SMTP_UNCERTAIN','A previous send may have been accepted. Review before retrying.',409);
  assert(await this.integrations.config('smtp',event.organizationId),'SMTP_UNCONFIGURED','SMTP is not configured',503);
  const row={...(existing??entity(event.organizationId,id)),outboxId:event.id,status:'sending',recipientHash:digest(String(p.to)),version:existing?existing.version+1:1,updatedAt:new Date().toISOString()};await this.db.put('mailDeliveries',row,existing?.version);
  const record=(status:string,extra:Record<string,unknown>={})=>this.db.put('mailDeliveries',{...row,status,deliveryConfirmed:false,...extra,version:row.version+1,updatedAt:new Date().toISOString()},row.version);
  let result:{accepted:boolean};
  // Only a failure that may have followed the server receiving the message is recorded as uncertain; anything else stays retriable.
  try{result=await this.integrations.sendMail(event.organizationId,String(p.to),content.subject,content.text,id);}
  catch(error){await record(error instanceof MailDeliveryError?error.outcome:'acceptance-unknown',error instanceof MailDeliveryError&&error.smtpCode?{smtpCode:error.smtpCode}:{});throw error;}
  if(!result.accepted){await record('smtp-rejected');throw new DomainError('SMTP_REJECTED','SMTP did not accept the message',502);}
  await record('smtp-accepted');
 }
 private async notify(event:Entity,user:User,category:string,title:string,resourceId:string){
  const legacy=`notice-request-${digest(event.id+user.id)}`,key=keyedId(Date.parse(String(event.createdAt)),legacy);
  await this.db.transaction([`notice:${legacy}`],async tx=>{if(await tx.get('outbox',key)||await tx.get('outbox',legacy))return;await tx.put('outbox',{...entity(event.organizationId,key),type:'notification.requested',status:'pending',payload:{userId:user.id,category,title,resourceId},attempts:0,nextAttemptAt:new Date().toISOString()});});
 }
 private async deliverNotification(event:Entity){
  const p=event.payload as any,user=await this.db.get<User>('users',String(p.userId));if(!user||user.status!=='active'||user.organizationId!==event.organizationId)return;
  if(!await notificationConditionApplies(this.db,user,p.condition))return;
  const preference=await this.preferences(user.id);if(!preference.categories.includes(p.category)||!await this.resourceVisible(user,p.category,p.resourceId))return;
  const allowed=nextDeliveryTime(new Date(),preference);if(allowed.getTime()>Date.now())throw new DeferredDelivery(allowed);
  const key=`notice-${digest(event.id+user.id)}`;
  const delivered=await this.db.transaction([`notice:${key}`],async tx=>{
   const existing=await tx.get('notificationDeliveries',key);if(existing)return existing;
   if(preference.inApp)await tx.put('notifications',{...entity(event.organizationId,key),userId:user.id,category:p.category,title:p.title,resourceId:p.resourceId,read:false});
   if(preference.email&&user.emailVerified)await tx.put('outbox',{...entity(event.organizationId),type:'email.send',status:'pending',payload:{to:user.email,template:'notification',data:{},userId:user.id,category:p.category,resourceId:p.resourceId,...(p.condition?{condition:p.condition}:{})},attempts:0,nextAttemptAt:new Date().toISOString()});
   return tx.put('notificationDeliveries',{...entity(event.organizationId,key),userId:user.id,inApp:preference.inApp,email:preference.email&&user.emailVerified});
  });
  if(delivered.inApp)await this.redis.publish(`clinic:${installationId()}:events`,JSON.stringify({type:'notification.created',payload:{userId:user.id,notificationId:key}}));
 }
 private async handle(event:Entity){
  const p=event.payload as Record<string,any>;
  if(event.type==='email.send'){await this.email(event);return;}
  if(event.type==='notification.requested'){await this.deliverNotification(event);return;}
  if(['notification.created','chat.message'].includes(String(event.type))){await this.redis.publish(`clinic:${installationId()}:events`,JSON.stringify({type:event.type==='chat.message'?'message.created':event.type,payload:p}));return;}
  const recognized=['appointment.booked','appointment.rescheduled','appointment.status','encounter.signed','encounter.amended','prescription.signed','result.released','payroll.paid','document.released','invoice.issued','invoice.credited','payment.recorded','payment.refunded','payment.settled','payment.reconciliation-required','refund.processed','refund.failed','payroll.approved','page.published','lead.created'];assert(recognized.includes(String(event.type)),'OUTBOX_HANDLER','No handler is installed for this event',503);
  if(event.type==='page.published')return; // Public reads are uncached and use committed publication snapshots.
  let patientId=p.patientId,branchId:string|undefined,resourceId=String(p.appointmentId??p.invoiceId??p.resultId??p.documentId??p.leadId??p.payrollId??p.encounterId??p.prescriptionId??'');
  const collection=p.appointmentId?'appointments':p.invoiceId?'invoices':p.resultId?'results':p.documentId?'documents':p.leadId?'leads':p.payrollId?'payroll':p.encounterId?'encounters':p.prescriptionId?'prescriptions':undefined;
  if(collection){const source=await this.db.get(collection,resourceId);patientId??=source?.patientId;branchId=source?.branchId as string|undefined;}
  const financial=/^(invoice|payment)/.test(String(event.type)),hr=String(event.type).startsWith('payroll'),clinical=/^(result|encounter|prescription)/.test(String(event.type));const category=financial?'finance':hr?'hr':clinical?'clinical':String(event.type).startsWith('appointment')?'appointments':'operations';
  for await(const users of pages<User>(this.db,'users',{organizationId:event.organizationId,status:'active'}))for(const user of users){const patient=user.roles.every(r=>r==='patient');const mayPatient=patient&&user.emailVerified&&patientId&&user.patientIds.includes(patientId)&&['appointment.booked','appointment.rescheduled','appointment.status','result.released','document.released','invoice.issued','payment.settled','payment.recorded'].includes(String(event.type));const staff=!patient&&(user.roles.some(r=>['owner','admin'].includes(r))||(!branchId||user.branchIds.includes(branchId))&&user.roles.some(r=>(financial?['accountant','receptionist']:hr?['hr','accountant']:clinical?['doctor','nurse']:['receptionist','manager']).includes(r)));if(mayPatient||staff)await this.notify(event,user,category,'A clinic workflow needs your attention',resourceId);}
 }
}
