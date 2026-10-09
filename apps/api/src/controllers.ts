/* Author: ramanpal singh | URL: https://kwebby.com */
import { Body,Controller,Get,Post,Patch,Put,Param,Query,Req,Res,Inject,UploadedFile,UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Request,Response } from 'express';
import { z } from 'zod';
import { assert,isCollection,type Collection,type Entity } from '../../../packages/contracts/src/index.js';
import { AiDraftService,runPublicTool,renderFinancialPdf,renderFinancialHtml,PUBLIC_TOOLS,analyzePublicWebsite } from '../../../packages/platform/src/index.js';
import { Runtime } from './runtime.js';
import { SecureUpload } from './guards.js';
import { entity } from './auth.js';
import { assertOrigin,publicOrigin,digest } from './security.js';
import { listAll,pageQuery } from './paging.js';
import { baseVisible } from '../../../packages/core/src/access.js';
const ok=(data:unknown)=>({data});
/** Anyone can type any address into a public form, so marketing consent from it is only a request until the person confirms it. */
const anonymousConsent=(requested:boolean)=>({marketingConsent:false,...(requested?{marketingConsentStatus:'unconfirmed',marketingConsentRequestedAt:new Date().toISOString()}:{})});
export const publicJob=(row:Entity)=>Object.fromEntries(['id','version','createdAt','updatedAt','type','status','attempts','nextAttemptAt','startedAt','completedAt','failureCode'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
type Upload={buffer:Buffer;originalname:string;mimetype:string};
const zoneFormats=new Map<string,Intl.DateTimeFormat>(),zoneOffsets=new Map<string,number>();
/** UTC offset (ms) of a zone at an instant, cached per zone and quarter hour (zone transitions fall on quarter-hour boundaries). */
export function zoneOffset(timeZone:string,at:number):number{
 const bucket=Math.floor(at/900000)*900000,key=`${timeZone}|${bucket}`,cached=zoneOffsets.get(key);if(cached!==undefined)return cached;
 let format=zoneFormats.get(timeZone);if(!format){format=new Intl.DateTimeFormat('en-CA',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});zoneFormats.set(timeZone,format);}
 const p=Object.fromEntries(format.formatToParts(bucket).map(v=>[v.type,v.value]));const offset=Date.UTC(Number(p.year),Number(p.month)-1,Number(p.day),Number(p.hour),Number(p.minute))-bucket;
 if(zoneOffsets.size>50000)zoneOffsets.clear();zoneOffsets.set(key,offset);return offset;
}
/** Public slot suggestions for one civil date. Work is one offset check per slot boundary: at most 20 rules x 288 five-minute slots. */
export function availableSlots(rules:Entity[],date:string,now:number,busy:(start:number,end:number)=>boolean):{startsAt:string;endsAt:string}[]{
 const [year,month,dayOfMonth]=date.split('-').map(Number),day=Date.UTC(year,month-1,dayOfMonth),weekday=new Date(day).getUTCDay(),slots=new Map<string,{startsAt:string;endsAt:string}>();
 for(const rule of rules){
  const [h,m]=String(rule.startTime).split(':').map(Number),[eh,em]=String(rule.endTime).split(':').map(Number),duration=Number(rule.slotMinutes),zone=String(rule.timezone);
  if(Number(rule.weekday)!==weekday||![h,m,eh,em].every(Number.isFinite)||!Number.isInteger(duration)||duration<5)continue;
  for(let minutes=h*60+m;minutes+duration<=eh*60+em;minutes+=duration){
   // A wall-clock time maps to zero instants (DST gap), one, or two (DST overlap); offsets in effect lie within the surrounding 26 hours.
   const wall=day+minutes*60000;
   for(const offset of new Set([zoneOffset(zone,wall-14*3600000),zoneOffset(zone,wall+12*3600000)])){const start=wall-offset,key=new Date(start).toISOString();if(zoneOffset(zone,start)!==offset||start<=now)continue;const end=start+duration*60000;if(!busy(start,end))slots.set(key,{startsAt:key,endsAt:new Date(end).toISOString()});}
  }
 }
 return [...slots.values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
}

@Controller('api/v1/auth')
export class AuthController {
 constructor(@Inject(Runtime) private r:Runtime){}
 @Get('status') async status(){return ok(await this.r.auth.status());}
 @Get('session') async session(@Req() req:Request){return ok(await this.r.auth.session(req));}
 @Post('bootstrap') async bootstrap(@Body() body:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){return ok(await this.r.auth.bootstrap(body,req,res));}
 @Post('register') async register(@Body() body:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){return ok(await this.r.auth.register(body,req,res));}
 @Post('login') async login(@Body() body:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){return ok(await this.r.auth.login(body,req,res));}
 @Post('revoke-sessions') async revoke(@Req() req:Request){return ok(await this.r.auth.revokeSessions(req));}
 @Post('logout') async logout(@Req() req:Request,@Res({passthrough:true}) res:Response){return ok(await this.r.auth.logout(req,res));}
 @Post('mfa/begin') async mfa(@Req() req:Request){return ok(await this.r.auth.mfaBegin(req));}
 @Post('mfa/confirm') async confirm(@Body() body:unknown,@Req() req:Request){return ok(await this.r.auth.mfaConfirm(body,req));}
 @Get('team') async team(@Req() req:Request){return ok(await this.r.auth.team(await this.r.auth.require(req)));}
 @Post('invite') async invite(@Body() body:unknown,@Req() req:Request){return ok(await this.r.auth.invite(body,await this.r.auth.require(req)));}
 @Post('accept-invite') async accept(@Body() body:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){return ok(await this.r.auth.acceptInvite(body,req,res));}
 @Patch('team/:id') async change(@Param('id') id:string,@Body() body:Record<string,unknown>,@Req() req:Request){return ok(await this.r.auth.changeUser({...body,id},await this.r.auth.require(req)));}
 @Post('reset-password') async reset(@Body() body:unknown,@Req() req:Request){return ok(await this.r.auth.requestReset(body,req));}
 @Post('consume-token') async consume(@Body() body:unknown,@Req() req:Request){return ok(await this.r.auth.consumeToken(body,req));}
}

@Controller('api/v1')
export class ClinicController {
 constructor(@Inject(Runtime) private r:Runtime){}
 @Get('health') health(){return ok({status:'ok',version:'0.1.0'});}
 @Get('ready') async ready(){await this.r.redis.ping();await this.r.db.list('settings',{limit:1});return ok({ready:true,database:this.r.db.driver});}
 @Get('dashboard') async dashboard(@Req() req:Request){return ok(await this.r.clinic.dashboard(await this.r.auth.require(req)));}
 @Get('notifications/preferences') async notificationPreferences(@Req() req:Request){return ok(await this.r.clinic.notificationPreferences(await this.r.auth.require(req)));}
 @Get('directory') async directory(@Req() req:Request){const actor=await this.r.auth.require(req),patient=actor.roles.every(r=>r==='patient');const branches=new Set(actor.branchIds);if(patient)for(const id of actor.patientIds){const p=await this.r.db.get('patients',id);if(p?.organizationId===actor.organizationId)branches.add(String(p.branchId));}const users=await listAll(this.r.db,'users',{organizationId:actor.organizationId,status:'active'});return ok(users.filter(u=>{const roles=u.roles as string[],scopes=u.branchIds as string[];if(!Array.isArray(roles)||roles.every(r=>r==='patient'))return false;if(patient&&!roles.some(r=>['owner','admin','manager','receptionist'].includes(r)))return false;return actor.roles.some(r=>['owner','admin'].includes(r))||scopes.some(b=>branches.has(b));}).map(u=>({id:u.id,name:u.name,roles:u.roles,branchIds:(u.branchIds as string[]).filter(b=>actor.roles.some(r=>['owner','admin'].includes(r))||branches.has(b))})));}
 @Get('records/:collection') async list(@Param('collection') c:string,@Query() q:Record<string,string>,@Req() req:Request){assert(isCollection(c),'NOT_FOUND','Collection not found',404);const actor=await this.r.auth.require(req);const eq:Record<string,string|boolean>={};for(const [key,value]of Object.entries(q)){assert(typeof value==='string','QUERY','Repeat each query parameter at most once');if(!['limit','after','q','order'].includes(key)){assert(/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(key),'QUERY','Invalid filter');eq[key]=['true','false'].includes(value)?value==='true':value;}}
  const search=(q.q??'').trim();assert(search.length<=100,'QUERY','Search text is limited to 100 characters');assert(q.order===undefined||q.order==='asc'||q.order==='desc','QUERY','order must be asc or desc');
  // `next` continues the list; a short page with `next` is not the end (the scan budget stopped first).
  const page=await this.r.clinic.listPage(c,actor,{limit:q.limit?Number(q.limit):100,after:q.after,eq,...(search?{q:search}:{}),...(q.order?{order:q.order as 'asc'|'desc'}:{})});return {data:page.data,...(page.next?{next:page.next}:{})};}
 @Get('records/:collection/:id') async get(@Param('collection') c:string,@Param('id') id:string,@Req() req:Request){assert(isCollection(c),'NOT_FOUND','Collection not found',404);return ok(await this.r.clinic.get(c,id,await this.r.auth.require(req)));}
 @Post('records/:collection') async create(@Param('collection') c:string,@Body() body:unknown,@Req() req:Request){assert(isCollection(c),'NOT_FOUND','Collection not found',404);return ok(await this.r.clinic.create(c,body,await this.r.auth.require(req)));}
 @Patch('records/:collection/:id') async update(@Param('collection') c:string,@Param('id') id:string,@Body() body:Record<string,unknown>,@Req() req:Request){assert(isCollection(c),'NOT_FOUND','Collection not found',404);const {expectedVersion,...data}=body;assert(Number.isInteger(expectedVersion),'VERSION','An expected version is required');return ok(await this.r.clinic.update(c,id,{...data,expectedVersion:Number(expectedVersion)},await this.r.auth.require(req)));}
 @Post('actions/:action') async action(@Param('action') action:string,@Body() body:unknown,@Req() req:Request){return ok(await this.r.clinic.execute(action,body,await this.r.auth.require(req)));}
 @Get('integrations') async integrations(@Req() req:Request){return ok(await this.r.integrations.list(await this.r.auth.require(req)));}
 @Get('integrations/:name') async integration(@Param('name') name:string,@Req() req:Request){return ok(await this.r.integrations.get(name,await this.r.auth.require(req)));}
 @Put('integrations/:name') async configure(@Param('name') name:string,@Body() body:unknown,@Req() req:Request){return ok(await this.r.integrations.save(name,body,await this.r.auth.require(req)));}
 @Post('integrations/smtp/test') async testMail(@Body() body:unknown,@Req() req:Request){return ok(await this.r.integrations.testMail(body,await this.r.auth.require(req)));}
 @Get('payments/activity') async paymentActivity(@Req() req:Request,@Query() q:Record<string,unknown>={}){
  const actor=await this.r.auth.require(req);assert(actor.roles.some(r=>['owner','admin','accountant'].includes(r)),'FORBIDDEN','Finance access required',403);const {limit}=pageQuery({limit:q.limit??500});
  // Visibility is decided per invoice (not by a sample of invoices), and both lists are newest first with their own cursor.
  const visible=new Map<string,boolean>();const invoiceVisible=async(id:string)=>{if(!visible.has(id)){const invoice=await this.r.db.get('invoices',id);visible.set(id,!!invoice&&baseVisible('invoices',invoice,actor));}return visible.get(id)!;};
  const recent=async(collection:string,fields:string[],after:unknown)=>{assert(after===undefined||(typeof after==='string'&&after.length<=200),'QUERY','Invalid page cursor');const rows=(await listAll(this.r.db,collection,{organizationId:actor.organizationId})).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.id.localeCompare(a.id));const start=after?rows.findIndex(r=>r.id===after)+1:0;assert(!after||start>0,'QUERY','Invalid page cursor');const page:Record<string,unknown>[]=[];for(const row of rows.slice(start)){if(page.length>=limit)break;if(await invoiceVisible(String(row.invoiceId)))page.push(Object.fromEntries(fields.filter(k=>row[k]!==undefined).map(k=>[k,row[k]])));}return page;};
  return ok({attempts:await recent('paymentAttempts',['id','invoiceId','provider','amount','currency','status','providerReference','createdAt'],q.attemptsAfter),refunds:await recent('refundRequests',['id','paymentId','invoiceId','provider','amount','status','providerRefundId','createdAt'],q.refundsAfter),limit});
 }
 @Post('payments/:provider/checkout') async checkout(@Param('provider') provider:string,@Body() body:unknown,@Req() req:Request){return ok(await this.r.payments.checkout(provider,body,await this.r.auth.require(req)));}
 @Post('payments/:provider/refund/reconcile') async reconcileRefund(@Param('provider') provider:string,@Body() body:unknown,@Req() req:Request){return ok(await this.r.payments.reconcileRefund(provider,body,await this.r.auth.require(req)));}
 @Post('payments/:provider/refund') async refund(@Param('provider') provider:string,@Body() body:unknown,@Req() req:Request){return ok(await this.r.payments.refund(provider,body,await this.r.auth.require(req)));}
 @Post('payments/:provider/reconcile') async reconcile(@Param('provider') provider:string,@Body() body:unknown,@Req() req:Request){return ok(await this.r.payments.reconcile(provider,body,await this.r.auth.require(req)));}
 @Post('webhooks/:provider') async webhook(@Param('provider') provider:string,@Req() req:Request&{rawBody?:Buffer}){assert(req.rawBody,'BODY','A raw webhook body is required');return ok(await this.r.payments.webhook(provider,req.rawBody,req.get(provider==='stripe'?'stripe-signature':'x-razorpay-signature')??''));}
 @Post('public-assets') @SecureUpload('owner','admin','editor') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:10*1024*1024,files:1,fields:1}}))
 async publicAssetUpload(@UploadedFile() file:Upload,@Body() body:unknown,@Req() req:Request){const actor=await this.r.auth.require(req);assert(file,'FILE','Choose an image');const {alt}=z.object({alt:z.string().min(1).max(500)}).strict().parse(body);return ok(await this.r.publicAssets.upload({bytes:file.buffer,mime:file.mimetype,alt},actor));}
 @Post('files') @SecureUpload() @UseInterceptors(FileInterceptor('file',{limits:{fileSize:20*1024*1024,files:1,fields:4}}))
 async upload(@UploadedFile() file:Upload,@Body() body:Record<string,string>,@Req() req:Request){const actor=await this.r.auth.require(req);assert(file,'FILE','Choose a file');const options=z.object({patientId:z.string().optional(),scope:z.enum(['clinical','conversation','personal','payroll']).optional()}).strict().parse(body);return ok(await this.r.files.upload({bytes:file.buffer,name:file.originalname,mime:file.mimetype,...options},actor));}
 @Get('files/:id') async file(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const data=await this.r.files.read(id,await this.r.auth.require(req));res.type(String(data.record.mime)).setHeader('Content-Disposition',`attachment; filename="document"; filename*=UTF-8''${encodeURIComponent(String(data.record.originalName??'document'))}`);res.send(data.bytes);}
 @Post('themes/import') @SecureUpload('owner','admin','editor') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:25*1024*1024,files:1,fields:0}}))
 async importTheme(@UploadedFile() file:Upload,@Req() req:Request){const actor=await this.r.auth.require(req);assert(file,'FILE','Choose a ZIP theme');return ok(await this.r.themes.importZip(file.buffer,actor));}
 @Get('themes/:id/preview') async preview(@Param('id') id:string,@Req() req:Request){return ok(await this.r.themes.preview(id,await this.r.auth.require(req)));}
 @Get('themes/:id/export') async exportTheme(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const bytes=await this.r.themes.exportZip(id,await this.r.auth.require(req));res.type('application/zip').setHeader('Content-Disposition','attachment; filename="clinic-theme.zip"');res.send(bytes);}
 @Post('themes/:id/activate') async activate(@Param('id') id:string,@Body() body:unknown,@Req() req:Request){const data=z.object({expectedPublicationId:z.string().nullable().optional()}).strict().parse(body);return ok(await this.r.themes.activate(id,await this.r.auth.require(req),data.expectedPublicationId??undefined));}
 @Post('themes/rollback') async rollback(@Body() body:unknown,@Req() req:Request){const data=z.object({expectedPublicationId:z.string().optional()}).strict().parse(body);return ok(await this.r.themes.rollback(await this.r.auth.require(req),data.expectedPublicationId));}
 @Post('ai/draft') async ai(@Body() body:unknown,@Req() req:Request){const actor=await this.r.auth.require(req);await this.r.limiter.take(`ai:${actor.id}`,10,60);const data=z.object({task:z.enum(['note','intake','chart','extract','reply','tasks']),text:z.string().max(64000),patientId:z.string().optional()}).strict().parse(body);const cfg=await this.r.integrations.config('ai',actor.organizationId);assert(cfg,'AI_NOT_CONFIGURED','Configure an AI provider first',503);return ok(await new AiDraftService(this.r.db,cfg as any).draft(data.task,{text:data.text,patientId:data.patientId},actor));}
 @Post('ai/transcribe') @SecureUpload('doctor','nurse') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:20*1024*1024,files:1,fields:0}}))
 async transcribe(@UploadedFile() file:Upload,@Req() req:Request){const actor=await this.r.auth.require(req);assert(file,'FILE','Choose an audio recording');await this.r.limiter.take(`ai:${actor.id}`,10,60);const cfg=await this.r.integrations.config('ai',actor.organizationId);assert(cfg,'AI_NOT_CONFIGURED','Configure an AI provider first',503);return ok(await new AiDraftService(this.r.db,cfg as any).transcribe(file.buffer,file.mimetype,actor));}
 @Get('documents/:id/pdf') async pdf(@Param('id') id:string,@Req() req:Request,@Res() res:Response){const doc=await this.r.clinic.get('documents',id,await this.r.auth.require(req));assert(['invoice','payslip','credit-note'].includes(String(doc.kind)),'DOCUMENT','This document has no financial PDF',400);const snapshot=doc.snapshot as any;const design=snapshot.template?.design??{};const logoDataUri=design.showLogo!==false&&snapshot.business?.logoFileId?await this.r.publicAssets.logoDataUri(String(snapshot.business.logoFileId),this.r.org):undefined;const template={accent:design.accent,font:design.font??'sans',footer:design.footer??'',terms:design.terms??'',columns:design.columns,showLogo:design.showLogo??true,...(logoDataUri?{logoDataUri}:{})};const bytes=await renderFinancialPdf({kind:doc.kind,snapshot} as any,template as any);res.type('application/pdf').setHeader('Content-Disposition','attachment; filename="clinic-document.pdf"');res.send(bytes);}
 @Get('audit') async audit(@Req() req:Request,@Query() q:Record<string,unknown>={}){const actor=await this.r.auth.require(req);assert(actor.roles.some(r=>['owner','admin'].includes(r)),'FORBIDDEN','Administrator access required',403);return ok(await this.r.db.list('audit',{eq:{organizationId:actor.organizationId},order:'desc',...pageQuery({limit:q.limit??500,after:q.after})}));}
 @Get('jobs') async jobs(@Req() req:Request,@Query() q:Record<string,unknown>={}){const actor=await this.r.auth.require(req);assert(actor.roles.some(r=>['owner','admin'].includes(r)),'FORBIDDEN','Administrator access required',403);assert(q.status===undefined||['pending','processing','completed','failed'].includes(String(q.status)),'QUERY','Invalid job status');const rows=await this.r.db.list('outbox',{eq:{organizationId:actor.organizationId,...(q.status?{status:String(q.status)}:{})},order:'desc',...pageQuery({limit:q.limit??500,after:q.after})});return ok(rows.map(publicJob));}
 /** Email whose SMTP acceptance is unknown is retried only after an administrator confirms it was not delivered, so a retry cannot silently send it twice. */
 @Post('jobs/:id/retry') async retry(@Param('id') id:string,@Req() req:Request,@Body() body:unknown={}){const actor=await this.r.auth.require(req);assert(actor.roles.some(r=>['owner','admin'].includes(r)),'FORBIDDEN','Administrator access required',403);const {confirmNotDelivered}=z.object({confirmNotDelivered:z.literal(true).optional()}).strict().parse(body??{});
  return ok(await this.r.db.transaction([`outbox:${id}`],async tx=>{const row=await tx.get('outbox',id);assert(row&&row.organizationId===actor.organizationId&&row.status==='failed','JOB','Retry a failed job only',409);const now=new Date().toISOString();
   const delivery=row.type==='email.send'?await tx.get('mailDeliveries',`mail-${row.id}`):null;const uncertain=!!delivery&&['acceptance-unknown','sending'].includes(String(delivery.status));
   assert(!uncertain||confirmNotDelivered,'MAIL_DELIVERY_UNCERTAIN','The mail server may already have accepted this email. Confirm it was not delivered before retrying.',409);
   if(uncertain&&delivery)await tx.put('mailDeliveries',{...delivery,status:'failed-before-send',resetFrom:delivery.status,resetBy:actor.id,resetAt:now,version:delivery.version+1,updatedAt:now},delivery.version);
   const updated=await tx.put('outbox',{...row,status:'pending',nextAttemptAt:now,version:row.version+1,updatedAt:now},row.version);await tx.put('audit',{...entity(actor.organizationId),actorId:actor.id,action:uncertain?'outbox.retry.confirmed-not-delivered':'outbox.retry',resourceId:row.id});return publicJob(updated);}));
 }
}

@Controller('api/v1/public')
export class PublicController {
 constructor(@Inject(Runtime) private r:Runtime){}
 @Get('assets/:id') async publicAsset(@Param('id') id:string,@Res() res:Response){const asset=await this.r.publicAssets.read(id,this.r.org);res.removeHeader('X-Robots-Tag');res.type(asset.mime).setHeader('Cache-Control','public, max-age=31536000, immutable');res.setHeader('ETag',`"${asset.sha256}"`);res.setHeader('Content-Disposition','inline');res.send(asset.bytes);}
 private async published():Promise<Record<string,any>[]>{const publication=await this.r.themes.publicSite(this.r.org);if(publication.pages!==null)return publication.pages.map(p=>({...p,status:'published'}));const pages=await this.r.db.list('pages',{eq:{organizationId:this.r.org}});return pages.filter(p=>p.publishedSnapshot).map(p=>({...p.publishedSnapshot as Record<string,unknown>,status:'published'}));}
 @Get('site') async site(){
  const b=await this.r.db.get('settings','business'),theme=await this.r.themes.publicSite(this.r.org);
  const business=(theme.settings?.business??b?.value??{}) as any;
  const rawWebsite=(theme.settings?.website??{}) as Record<string,any>;
  // Draft website settings never become public, including before the first publication.
  const website=Object.fromEntries(['siteName','origin','description','locale','socialImage','socialImageAlt','socialHandles','searchConsoleVerification','navigation','homepage','branding','locations','header','footer'].filter(key=>rawWebsite[key]!==undefined).map(key=>[key,rawWebsite[key]]));
  const locations=Array.isArray(website.locations)?website.locations:[],primaryLocation=locations.find(location=>location.primary)??locations[0];
  const availability=await this.r.db.list('availability',{eq:{organizationId:this.r.org,public:true}}),profiles=await this.r.db.list('employees',{eq:{organizationId:this.r.org,publicProfile:true}}),doctors=[];
  for(const id of new Set(availability.map(a=>String(a.doctorId)))){const u=await this.r.db.get('users',id),profile=profiles.find(p=>p.userId===id&&p.active!==false);if(u&&profile&&u.organizationId===this.r.org&&u.status==='active'&&(u.roles as string[])?.includes('doctor'))doctors.push({id:u.id,name:profile.name,branchIds:[...new Set(availability.filter(a=>a.doctorId===u.id).map(a=>String(a.branchId)))].filter(branchId=>Array.isArray(u.branchIds)&&u.branchIds.includes(branchId)),jobTitle:profile.jobTitle,specialty:profile.specialty??'',registrationNumber:profile.registrationNumber??''});}
  const logoId=website.branding?.logo?.assetId??business.logoFileId;
  return ok({audience:process.env.INSTALLATION_AUDIENCE==='business'?'business':'patient',name:website.siteName??business.clinicName??'Your clinic',description:website.description??'Personal care, thoughtfully organized.',url:publicOrigin(),locale:website.locale??business.locale??'en',currency:business.currency??'USD',timezone:primaryLocation?.timezone??business.timezone??'UTC',address:primaryLocation?.address??business.address??'',email:primaryLocation?.email??business.email??'',phone:primaryLocation?.phone??business.phone??'',displayPhone:primaryLocation?.displayPhone??primaryLocation?.phone??business.phone??'',logo:logoId?`/api/v1/public/assets/${encodeURIComponent(logoId)}`:null,socialImage:website.socialImage,socialImageAlt:website.socialImageAlt,socialHandle:website.socialHandles?.x,socialProfiles:Object.values(website.socialHandles??{}).filter(value=>typeof value==='string'&&/^https:\/\//.test(value)),searchConsoleVerification:website.searchConsoleVerification,navigation:website.navigation,homepage:website.homepage,branding:website.branding,header:website.header,footer:website.footer,locations,website,doctors,services:await this.publicServices(),theme:{manifest:theme.manifest,publicationId:theme.publicationId,themeId:'themeId' in theme?theme.themeId:undefined},pages:await this.published()});
 }
 private async publicServices(){const rows=await this.r.db.list('services',{eq:{organizationId:this.r.org,public:true}});return rows.map(r=>({id:r.id,branchId:r.branchId,name:r.name,description:r.description,price:r.price,currency:r.currency,durationMinutes:r.durationMinutes}));}
 @Get('services') async services(){return ok(await this.publicServices());}
 @Get('pages') async pages(){return ok(await this.published());}
 @Get('pages/:slug') async page(@Param('slug') slug:string,@Query('locale') locale:string){const pages=await this.published();const page=pages.find(p=>p.slug===slug&&(!locale||p.locale===locale));if(page)return ok(page);const routes=await this.r.db.list('pageRoutes',{eq:{organizationId:this.r.org,slug,...(locale?{locale}:{})}});const route=routes.find(r=>r.status==='redirect');assert(route,'NOT_FOUND','Page not found',404);return ok({redirect:route.redirectSlug,statusCode:308});}
 private async bookingBranch(requested?:string):Promise<string>{
  const site=await this.r.themes.publicSite(this.r.org),locations=(site.settings?.website?.locations??[]) as {branchId:string;primary?:boolean}[];
  const branchId=requested??locations.find(location=>location.primary)?.branchId??locations[0]?.branchId??'main';
  z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).parse(branchId);
  assert(locations.length?locations.some(location=>location.branchId===branchId):branchId==='main','BOOKING_BRANCH','Choose a published clinic location',400);
  return branchId;
 }
 @Get('availability') async availability(@Query('doctorId') doctorId:string,@Query('date') date:string,@Query('branchId') branchId:string,@Req() req:Request){
  await this.r.limiter.take(`availability:${req.ip}`,10,60);z.string().min(1).max(128).parse(doctorId);const publicProfiles=await this.r.db.list('employees',{eq:{organizationId:this.r.org,userId:doctorId,publicProfile:true}});assert(publicProfiles.some(p=>p.active!==false),'NOT_FOUND','Practitioner availability is not public',404);z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(date);const center=Date.parse(date+'T00:00:00Z');assert(Number.isFinite(center)&&center>Date.now()-86400000&&center<Date.now()+366*86400000,'DATE','Choose a date within the next year');
  const chosenBranch=branchId?await this.bookingBranch(branchId):undefined;
  const rules=await this.r.db.list('availability',{eq:{organizationId:this.r.org,doctorId,public:true,...(chosenBranch?{branchId:chosenBranch}:{})},limit:21});assert(rules.length<=20,'AVAILABILITY_CONFIG','Contact the clinic to confirm availability',503);
  const windowStart=center-86400000,windowEnd=center+2*86400000,near=(row:Entity)=>Date.parse(String(row.startsAt))<windowEnd&&Date.parse(String(row.endsAt))>windowStart;
  const bookings=(await listAll(this.r.db,'appointments',{organizationId:this.r.org,doctorId})).filter(b=>!['cancelled','no-show'].includes(String(b.status))&&near(b));const leave:Entity[]=[];
  for(const employee of await listAll(this.r.db,'employees',{organizationId:this.r.org,userId:doctorId}))leave.push(...(await listAll(this.r.db,'leave',{organizationId:this.r.org,status:'approved',employeeId:employee.id})).filter(near));
  const blocked=[...bookings,...leave].map(row=>[Date.parse(String(row.startsAt)),Date.parse(String(row.endsAt))]);
  return ok(availableSlots(rules,date,Date.now(),(start,end)=>blocked.some(([s,e])=>s<end&&e>start)));
 }
 @Post('booking') async booking(@Body() body:unknown,@Req() req:Request){
  assertOrigin(req);await this.r.limiter.take(`booking:${req.ip}`,5,3600);
  const data=z.object({name:z.string().min(2).max(120),phone:z.string().min(5).max(50),email:z.email().optional(),branchId:z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/).optional(),serviceId:z.string().max(128).optional(),doctorId:z.string().max(128).optional(),date:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),startsAt:z.iso.datetime().optional(),endsAt:z.iso.datetime().optional(),reason:z.string().max(1000).optional(),contactConsent:z.literal(true)}).strict().parse(body);
  const branchId=await this.bookingBranch(data.branchId);
  if(data.serviceId){const service=await this.r.db.get('services',data.serviceId);assert(service&&service.organizationId===this.r.org&&service.public===true&&service.branchId===branchId,'BOOKING_SERVICE','Choose a public service at this clinic location',400);}
  if(data.doctorId){
   const doctor=await this.r.db.get('users',data.doctorId),profiles=await this.r.db.list('employees',{eq:{organizationId:this.r.org,userId:data.doctorId,publicProfile:true}}),rules=await this.r.db.list('availability',{eq:{organizationId:this.r.org,doctorId:data.doctorId,branchId,public:true}});
   assert(doctor&&doctor.organizationId===this.r.org&&doctor.status==='active'&&Array.isArray(doctor.roles)&&doctor.roles.includes('doctor')&&Array.isArray(doctor.branchIds)&&doctor.branchIds.includes(branchId)&&profiles.some(profile=>profile.active!==false)&&rules.length>0,'BOOKING_DOCTOR','Choose a public clinician at this clinic location',400);
  }
  await this.r.db.transaction([`booking-inquiry:${digest(data.phone)}`],async tx=>{const lead={...entity(this.r.org),name:data.name,phone:data.phone,...(data.email?{email:data.email}:{}),source:'appointment-request',interest:data.reason??'Appointment request',branchId,marketingConsent:false,contactConsentAt:new Date().toISOString(),requestedAppointment:{...data,branchId},stage:'new',contactAttempts:[]};await tx.put('leads',lead);await tx.put('outbox',{...entity(this.r.org),type:'lead.created',status:'pending',payload:{leadId:lead.id},attempts:0,nextAttemptAt:new Date().toISOString()});});return ok({received:true,reserved:false,branchId});
 }
 @Post('leads') async lead(@Body() body:unknown,@Req() req:Request){assertOrigin(req);await this.r.limiter.take(`lead:${req.ip}`,5,3600);const data=z.object({name:z.string().min(2).max(120),email:z.email(),phone:z.string().max(50).optional(),interest:z.string().max(1000).optional(),source:z.string().max(100).default('website'),marketingConsent:z.boolean().default(false),branchId:z.string().max(100).default('main'),attribution:z.object({utmSource:z.string().max(100).optional(),utmMedium:z.string().max(100).optional(),utmCampaign:z.string().max(100).optional(),referrer:z.string().max(200).optional()}).strict().optional()}).strict().parse(body);await this.r.db.transaction([`lead:${digest(data.email)}`],async tx=>{const lead={...entity(this.r.org),...data,...anonymousConsent(data.marketingConsent),stage:'new',contactAttempts:[]};await tx.put('leads',lead);await tx.put('outbox',{...entity(this.r.org),type:'lead.created',status:'pending',payload:{leadId:lead.id},attempts:0,nextAttemptAt:new Date().toISOString()});});return ok({received:true,message:'The clinic will contact you.'});}
 @Get('tools') tools(){const audience=process.env.INSTALLATION_AUDIENCE==='business'?'business':'patient';return ok(PUBLIC_TOOLS.filter(t=>t.audience===audience));}
 @Post('tools/:tool') async tool(@Param('tool') tool:string,@Body() body:unknown,@Req() req:Request){assertOrigin(req);await this.r.limiter.take(`tool:${req.ip}`,20,3600);const data=z.object({input:z.record(z.string(),z.unknown()),email:z.email().optional(),marketingConsent:z.boolean().default(false)}).strict().parse(body);const audience=process.env.INSTALLATION_AUDIENCE==='business'?'business':'patient';assert(tool!=='website-analyzer'||audience==='business','NOT_FOUND','Tool not available',404);const business=(await this.r.db.get('settings','business'))?.value as any;const services=await this.publicServices();const analysis=tool==='website-analyzer'?await analyzePublicWebsite(z.object({url:z.url().max(2048)}).strict().parse(data.input).url):null;const result=analysis?{summary:'Your booking website overview',items:[String(analysis.scope)],values:{score:analysis.score},...analysis}:runPublicTool(tool,data.input,{audience,currency:business?.currency,serviceFees:Object.fromEntries(services.map(s=>[s.id,Number(s.price)]))});if(data.email){await this.r.limiter.take(`tool-report-recipient:${data.email.toLowerCase()}`,3,86400);await this.r.db.transaction([`tool-report:${digest(data.email)}`],async tx=>{await tx.put('outbox',{...entity(this.r.org),type:'email.send',status:'pending',payload:{to:data.email,template:'tool.report',data:{summary:result.summary,items:result.items,values:result.values}},attempts:0,nextAttemptAt:new Date().toISOString()});await tx.put('leads',{...entity(this.r.org),name:data.email,email:data.email,source:`tool:${tool}`,...anonymousConsent(data.marketingConsent),contactPurpose:'requested-tool-report',consentAt:new Date().toISOString(),stage:'new',branchId:'main',contactAttempts:[]});});}return ok(audience==='business'&&!data.email?{summary:result.summary,items:[],values:{},detailedReportRequiresEmail:true}:result);}
 @Get('themes/:id/assets/*path') async asset(@Param('id') id:string,@Param('path') path:string|string[],@Req() req:Request,@Res() res:Response){const data=await this.r.themes.asset(id,Array.isArray(path)?path.join('/'):path,this.r.org);res.type(data.mime).send(data.bytes);}
}
