/* Author: ramanpal singh | URL: https://kwebby.com */
import { z } from 'zod';
import { createHmac,createHash,randomUUID } from 'node:crypto';
import Stripe from 'stripe';
import nodemailer,{ type Transporter } from 'nodemailer';
import { Decimal } from 'decimal.js';
import type { Actor,Database,Entity,Repository } from '../../../packages/contracts/src/index.js';
import { assert,DomainError } from '../../../packages/contracts/src/index.js';
import { Secrets,equal,publicOrigin,organizationId } from './security.js';
import { entity } from './auth.js';

const secretFields=['password','secretKey','webhookSecret','keySecret','apiKey'];
const configSchemas={
 smtp:z.object({host:z.string().min(1).max(253),port:z.number().int().min(1).max(65535),secure:z.boolean(),user:z.string().max(300).default(''),password:z.string().max(1000).optional(),from:z.email(),replyTo:z.email().optional()}).strict(),
 stripe:z.object({secretKey:z.string().min(12).max(500).optional(),webhookSecret:z.string().min(12).max(500).optional()}).strict(),
 razorpay:z.object({keyId:z.string().min(4).max(300),keySecret:z.string().min(12).max(500).optional(),webhookSecret:z.string().min(12).max(500).optional()}).strict(),
 ai:z.object({apiKey:z.string().max(1000).optional(),baseUrl:z.url().default('https://api.openai.com/v1'),model:z.string().min(1).max(100),transcriptionModel:z.string().max(100).optional(),allowedClinicalData:z.boolean().default(false),monthlyTokenLimit:z.number().int().positive().max(100000000).default(100000)}).strict()
};
export type IntegrationName=keyof typeof configSchemas;
/** A stored secret stays valid only while the fields that decide where (and as whom) it is sent are unchanged. */
const secretBindings:Partial<Record<IntegrationName,Record<string,string[]>>>={smtp:{password:['host','port','user']},ai:{apiKey:['baseUrl']},razorpay:{keySecret:['keyId']}};
export type MailOutcome='failed-before-send'|'smtp-rejected'|'acceptance-unknown';
/** Mail that may be retried: the server never received the message data, or definitively refused it. */
export const RETRIABLE_MAIL=['failed-before-send','smtp-rejected'];
/** Outcome of a failed SMTP send. Before the server's go-ahead for DATA no message bytes are sent, so it cannot have been accepted. */
export function smtpFailureOutcome(error:unknown,dataStarted:boolean):MailOutcome{
 if(!dataStarted)return 'failed-before-send';
 const e=error as {code?:string;responseCode?:number};
 return e?.code==='EMESSAGE'&&typeof e.responseCode==='number'&&e.responseCode>=400&&e.responseCode<600?'smtp-rejected':'acceptance-unknown';
}
export class MailDeliveryError extends DomainError {
 constructor(readonly outcome:MailOutcome,readonly smtpCode?:string){super('SMTP_SEND_FAILED',outcome==='acceptance-unknown'?'The mail server connection failed after the message was sent; delivery is unknown.':'The mail server did not accept the message.',502);this.name='MailDeliveryError';}
}
type MailTransportFactory=(options:Record<string,any>)=>Pick<Transporter,'sendMail'|'close'>;
export class IntegrationService {
 constructor(private db:Database,private secrets:Secrets,private transportFactory:MailTransportFactory=options=>nodemailer.createTransport(options)){}
 private admin(a:Actor){assert(a.roles.some(r=>['owner','admin'].includes(r)),'FORBIDDEN','Administrator access required',403);}
 async config(name:IntegrationName,org:string):Promise<Record<string,any>|null>{const row=await this.db.get('integrations',`${org}-${name}`);if(!row)return null;const config={...(row.config as Record<string,any>)};for(const k of secretFields)if(config[k])config[k]=this.secrets.decrypt(config[k]);return config;}
 async get(name:string,actor:Actor){this.admin(actor);assert(name in configSchemas,'INTEGRATION','Unknown integration',404);const config=await this.config(name as IntegrationName,actor.organizationId);if(!config)return {name,configured:false};for(const k of secretFields)if(config[k]){config[`${k}Configured`]=true;delete config[k];}return {name,configured:true,...config};}
 async list(actor:Actor){return Promise.all(Object.keys(configSchemas).map(name=>this.get(name,actor)));}
 async save(name:string,input:unknown,actor:Actor){this.admin(actor);assert(name in configSchemas,'INTEGRATION','Unknown integration',404);const data=configSchemas[name as IntegrationName].parse(input) as Record<string,any>;
  if(name==='ai'){const u=new URL(data.baseUrl);assert(u.protocol==='https:'&&!u.username&&!u.password,'AI_URL','Cloud AI endpoints require HTTPS without URL credentials');assert((process.env.AI_ALLOWED_HOSTS??'api.openai.com').split(',').includes(u.hostname),'AI_HOST','The operator must allow this AI host in AI_ALLOWED_HOSTS',400);}
  const id=`${actor.organizationId}-${name}`;await this.db.transaction([`integration:${id}`],async tx=>{const previous=await tx.get('integrations',id);const old=(previous?.config??{}) as Record<string,any>;const config:Record<string,any>={...old,...data};const cleared:string[]=[];
   for(const field of secretFields){if(data[field])config[field]=this.secrets.encrypt(data[field]);else if(old[field]){
    // Never send a stored secret to a new host or account: without a new secret, the old one is cleared.
    if((secretBindings[name as IntegrationName]?.[field]??[]).some(key=>String(old[key]??'')!==String(config[key]??''))){delete config[field];cleared.push(field);}else config[field]=old[field];}}
   await tx.put('integrations',{...(previous??entity(actor.organizationId,id)),name,config,version:previous?previous.version+1:1,updatedAt:new Date().toISOString()},previous?.version);await tx.put('audit',{...entity(actor.organizationId),actorId:actor.id,action:'integration.configure',targetId:name,...(cleared.length?{clearedSecrets:cleared}:{})});});return this.get(name,actor);
 }
 async testMail(input:unknown,actor:Actor){this.admin(actor);const {to}=z.object({to:z.email()}).strict().parse(input);const smtp=await this.config('smtp',actor.organizationId);assert(smtp,'SMTP_UNCONFIGURED','Configure SMTP before testing',503);const result=await this.sendMail(actor.organizationId,to,'ClinicsCMS email configuration test','Your clinic email configuration was accepted by the mail server.','test-'+randomUUID());return {accepted:result.accepted,deliveryConfirmed:false};}
 async sendMail(org:string,to:string,subject:string,text:string,id:string){
  const smtp=await this.config('smtp',org);if(!smtp)throw new MailDeliveryError('failed-before-send','SMTP_UNCONFIGURED');
  // The protocol transcript is observed only to learn whether the server accepted DATA; nothing from it is stored or logged.
  let dataCommand=false,dataStarted=false;const watch=(entry:{tnx?:string}|undefined,message:unknown)=>{const line=String(message??'');if(entry?.tnx==='client')dataCommand=/^DATA\s*$/i.test(line);else if(entry?.tnx==='server'&&dataCommand){dataStarted=/^[23]/.test(line);dataCommand=false;}};
  const logger={trace:watch,debug:watch,info:watch,warn:watch,error:watch,fatal:watch};
  const transport=this.transportFactory({host:smtp.host,port:smtp.port,secure:smtp.secure,requireTLS:true,auth:smtp.user?{user:smtp.user,pass:smtp.password}:undefined,connectionTimeout:10000,greetingTimeout:10000,socketTimeout:20000,tls:{rejectUnauthorized:true},logger,transactionLog:true});
  try{const result=await transport.sendMail({from:smtp.from,replyTo:smtp.replyTo,to,subject,text,messageId:`<${id}@${new URL(publicOrigin()).hostname}>`});return {accepted:Array.isArray(result.accepted)&&result.accepted.length>0,messageId:result.messageId};}
  catch(error){const code=(error as {code?:unknown})?.code;throw new MailDeliveryError(smtpFailureOutcome(error,dataStarted),typeof code==='string'&&/^[A-Z0-9_]{1,40}$/.test(code)?code:undefined);}
  finally{transport.close();}
 }
}

type PaymentRow=Entity & Record<string,any>;
type PaymentProvider='stripe'|'razorpay';
type PaymentDependencies={stripeFactory?:(key:string)=>Stripe;fetch?:typeof fetch};
const paymentHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Provider events can arrive late, replayed or out of order, so statuses only move forward (a recorded success outranks a failure). */
const attemptRank:Record<string,number>={creating:0,ready:0,'needs-reconciliation':0,'awaiting-payment':1,expired:2,failed:2,settled:3};
const refundRank:Record<string,number>={creating:0,'needs-reconciliation':0,pending:1,failed:2,canceled:2,succeeded:3};
export const advances=(ranks:Record<string,number>,current:unknown,next:string)=>(ranks[next]??0)>(ranks[String(current)]??0);
/** Razorpay's event-id header is not covered by the signature, so deduplication uses only signed body fields. */
export function razorpayEventId(event:any,raw:Buffer):string{const entity=event?.payload?.refund?.entity??event?.payload?.payment?.entity??event?.payload?.order?.entity;return typeof entity?.id==='string'?`razorpay:${paymentHash([event.event,entity.id,entity.status??null,event.created_at??entity.created_at??null])}`:`razorpay-body:${createHash('sha256').update(raw).digest('hex')}`;}
const precision=(currency:string)=>new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;
const decimalAmount=z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
/** Provider minor-unit rules are deliberately separate from document currency formatting. */
export function providerMinor(amount:string,currency:string,provider:PaymentProvider):number {
 const value=new Decimal(amount);const digits=precision(currency);assert(value.eq(value.toDecimalPlaces(digits))&&value.gt(0),'AMOUNT','Amount exceeds currency precision');
 let exponent=digits;
 if(provider==='stripe'){
  assert(digits<=2,'CURRENCY_UNSUPPORTED','This Stripe adapter requires a supported currency with at most two decimal places');
  if(['ISK','UGX'].includes(currency)){assert(value.isInteger(),'AMOUNT','Whole-currency amount required');exponent=2;}
  if(currency==='MGA'){assert(value.isInteger(),'AMOUNT','Stripe MGA charges must be whole-currency amounts');exponent=0;}
 }
 const minor=value.mul(new Decimal(10).pow(exponent));assert(minor.isInteger()&&minor.lte(Number.MAX_SAFE_INTEGER),'AMOUNT','Amount cannot be represented safely');
 if(provider==='razorpay'&&digits===3)assert(minor.mod(10).isZero(),'AMOUNT','Razorpay requires the final minor-unit digit to be zero for three-decimal currencies');
 return minor.toNumber();
}
export class PaymentService {
 private stripeFactory:(key:string)=>Stripe;private fetcher:typeof fetch;
 constructor(private db:Database,private integrations:IntegrationService,dependencies:PaymentDependencies={}){this.stripeFactory=dependencies.stripeFactory??(key=>new Stripe(key));this.fetcher=dependencies.fetch??fetch;}
 private provider(value:string):PaymentProvider {assert(value==='stripe'||value==='razorpay','PROVIDER','Unsupported payment provider',404);return value;}
 private async invoice(id:string,actor:Actor,repo:Repository=this.db,allowPaid=false):Promise<PaymentRow>{
  const inv=await repo.get<PaymentRow>('invoices',id);assert(inv&&inv.organizationId===actor.organizationId,'INVOICE','Invoice not found',404);const patient=actor.roles.every(r=>r==='patient');
  const allowed=patient?actor.patientIds.includes(String(inv.patientId)):actor.roles.some(r=>['owner','admin','accountant','receptionist','manager'].includes(r))&&(actor.roles.some(r=>['owner','admin'].includes(r))||actor.branchIds.includes(String(inv.branchId)));
  assert(allowed,'FORBIDDEN','Invoice access denied',403);assert(['issued','partially-paid',...(allowPaid?['paid','credited']:[])].includes(inv.status),'INVOICE_STATE','Invoice cannot accept this operation',409);return inv;
 }
 private finance(actor:Actor){assert(actor.roles.some(r=>['owner','admin','accountant'].includes(r)),'FORBIDDEN','Finance access required',403);}
 private async update(repo:Repository,collection:string,row:PaymentRow,patch:Record<string,unknown>){return repo.put<PaymentRow>(collection,{...row,...patch,version:row.version+1,updatedAt:new Date().toISOString()},row.version);}
 private async event(repo:Repository,org:string,type:string,payload:Record<string,unknown>){await repo.put('outbox',{...entity(org),type,status:'pending',payload,attempts:0,nextAttemptAt:new Date().toISOString()});}
 private async config(provider:PaymentProvider,org:string){const c=await this.integrations.config(provider,org);assert(c&&(provider==='stripe'?c.secretKey:c.keyId&&c.keySecret),'PROVIDER_UNCONFIGURED','Configure the payment provider first',503);return c;}
 private async razor(config:Record<string,any>,path:string,options:{method?:string;body?:unknown;idempotencyKey?:string}={}):Promise<any>{
  const response=await this.fetcher(`https://api.razorpay.com/v1/${path}`,{method:options.method??'GET',headers:{Authorization:`Basic ${Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64')}`,'Content-Type':'application/json',...(options.idempotencyKey?{'X-Refund-Idempotency':options.idempotencyKey}:{})},...(options.body?{body:JSON.stringify(options.body)}:{}),signal:AbortSignal.timeout(15000)});
  assert(response.ok,'PROVIDER_ERROR','Payment provider request could not be confirmed',502);return response.json();
 }
 async checkout(providerValue:string,input:unknown,actor:Actor){
  const provider=this.provider(providerValue);const data=z.object({invoiceId:z.string().min(1).max(100),idempotencyKey:z.string().min(8).max(100)}).strict().parse(input);const config=await this.config(provider,actor.organizationId);await this.invoice(data.invoiceId,actor,this.db,true);
  const key=`checkout-${paymentHash([actor.organizationId,provider,data.idempotencyKey]).slice(0,48)}`;const requestHash=paymentHash(data);let created=false;
  let attempt=await this.db.transaction([`${actor.organizationId}:invoice:${data.invoiceId}`,`checkout:${key}`],async tx=>{
   created=false;const inv=await this.invoice(data.invoiceId,actor,tx,true);const existing=await tx.get<PaymentRow>('paymentAttempts',key);
   if(existing){assert(existing.organizationId===actor.organizationId&&existing.requestHash===requestHash,'IDEMPOTENCY','Payment key was used for a different request',409);assert(existing.status==='settled'||new Decimal(String(existing.amount)).eq(String(inv.balance)),'BALANCE_CHANGED','Invoice balance changed; reconcile the existing checkout before sharing it',409);return existing;}
   const active=await tx.list<PaymentRow>('paymentAttempts',{eq:{organizationId:actor.organizationId,invoiceId:inv.id},limit:10000});assert(!active.some(p=>['creating','ready','needs-reconciliation','awaiting-payment'].includes(p.status)),'CHECKOUT_ACTIVE','Reconcile or finish the existing payment attempt before creating another',409);
   const amount=String(inv.balance);const currency=String(inv.currency);providerMinor(amount,currency,provider);created=true;
   return tx.put<PaymentRow>('paymentAttempts',{...entity(actor.organizationId,key),invoiceId:inv.id,branchId:inv.branchId,provider,amount,currency,status:'creating',createdBy:actor.id,requestHash,leaseUntil:Date.now()+60000,receipt:paymentHash(key).slice(0,40)});
  });
  if(attempt.status==='ready')return attempt.publicResponse;
  if(attempt.status==='settled')return {provider,attemptId:attempt.id,status:'settled'};
  if(!created){
   assert(provider==='stripe'&&['creating','needs-reconciliation'].includes(attempt.status)&&Number(attempt.leaseUntil??0)<Date.now()&&Date.parse(attempt.createdAt)>Date.now()-23*3600000,'CHECKOUT_PENDING','This payment attempt requires reconciliation; it will not create another provider order',409);
   attempt=await this.db.transaction([`checkout:${key}`],async tx=>{const current=await tx.get<PaymentRow>('paymentAttempts',key);assert(current&&Number(current.leaseUntil??0)<Date.now(),'CHECKOUT_PENDING','Checkout is being created',409);return this.update(tx,'paymentAttempts',current,{status:'creating',leaseUntil:Date.now()+60000});});
  }
  const minor=providerMinor(String(attempt.amount),String(attempt.currency),provider);let response:Record<string,unknown>;
  try{
   if(provider==='stripe'){
    const session=await this.stripeFactory(config.secretKey).checkout.sessions.create({mode:'payment',client_reference_id:attempt.id,metadata:{attemptId:attempt.id,organizationId:actor.organizationId,invoiceId:String(attempt.invoiceId)},payment_intent_data:{metadata:{attemptId:attempt.id,organizationId:actor.organizationId,invoiceId:String(attempt.invoiceId)}},line_items:[{price_data:{currency:String(attempt.currency).toLowerCase(),unit_amount:minor,product_data:{name:'Clinic invoice payment'}},quantity:1}],success_url:`${publicOrigin()}/portal?payment=processing`,cancel_url:`${publicOrigin()}/portal?payment=cancelled`},{idempotencyKey:attempt.id});
    assert(session.url,'PROVIDER_ERROR','Checkout session did not return a payment URL',502);response={provider,url:session.url,sessionId:session.id,attemptId:attempt.id};
   }else{
    // Orders have no assumed idempotency contract. A failed/unknown call is reconciled, never automatically replayed.
    const order=await this.razor(config,'orders',{method:'POST',body:{amount:minor,currency:attempt.currency,receipt:attempt.receipt,partial_payment:false,notes:{attemptId:attempt.id,invoiceId:attempt.invoiceId,organizationId:actor.organizationId}}});
    assert(typeof order.id==='string'&&Number(order.amount)===minor&&String(order.currency).toUpperCase()===attempt.currency,'PROVIDER_ERROR','Provider order does not match requested amount',502);response={provider,keyId:config.keyId,orderId:order.id,amount:minor,currency:attempt.currency,attemptId:attempt.id};
   }
  }catch(error){await this.db.transaction([`checkout:${key}`],async tx=>{const current=await tx.get<PaymentRow>('paymentAttempts',key);if(current&&current.status==='creating')await this.update(tx,'paymentAttempts',current,{status:'needs-reconciliation',leaseUntil:Date.now()+60000});});throw error;}
  attempt=await this.db.transaction([`checkout:${key}`],async tx=>{const current=await tx.get<PaymentRow>('paymentAttempts',key);assert(current,'ATTEMPT','Payment attempt is missing');if(current.status==='settled')return current;return this.update(tx,'paymentAttempts',current,{status:'ready',publicResponse:response,providerReference:response.sessionId??response.orderId,leaseUntil:0});});
  return attempt.status==='settled'?{provider,attemptId:attempt.id,status:'settled'}:attempt.publicResponse;
 }
 private async settle(provider:PaymentProvider,attemptId:string,object:any,eventKey:string,eventType:string):Promise<Record<string,unknown>>{
  const org=organizationId();const initial=await this.db.get<PaymentRow>('paymentAttempts',attemptId);assert(initial&&initial.organizationId===org&&initial.provider===provider,'ATTEMPT','Unknown payment attempt',409);
  return this.db.transaction([`${org}:invoice:${initial.invoiceId}`,`checkout:${attemptId}`,`webhook:${eventKey}`],async tx=>{
   const seen=await tx.get('webhookEvents',eventKey);if(seen)return {received:true,duplicate:true};const attempt=await tx.get<PaymentRow>('paymentAttempts',attemptId);assert(attempt&&attempt.organizationId===org&&attempt.provider===provider,'ATTEMPT','Unknown payment attempt',409);
   const invoice=await tx.get<PaymentRow>('invoices',String(attempt.invoiceId));assert(invoice&&invoice.organizationId===org&&invoice.status!=='draft','INVOICE','Issued invoice is missing',409);
   const received=Number(provider==='stripe'?object.amount_total:object.amount);const currency=String(object.currency).toUpperCase();assert(Number.isSafeInteger(received)&&received===providerMinor(String(attempt.amount),String(attempt.currency),provider)&&currency===attempt.currency,'AMOUNT_MISMATCH','Provider amount or currency mismatch',409);
   const reference=String(provider==='stripe'?(typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id):object.id);assert(reference&&reference!=='undefined','PAYMENT_REFERENCE','Provider payment reference is missing',409);
   if(attempt.providerReference)assert(String(provider==='stripe'?object.id:object.order_id)===attempt.providerReference,'PAYMENT_REFERENCE','Provider order does not match the server checkout',409);
   const paymentId=`gateway-${paymentHash([provider,reference]).slice(0,48)}`;const prior=await tx.get<PaymentRow>('payments',paymentId);
   if(prior){assert(prior.invoiceId===invoice.id&&prior.organizationId===org,'PAYMENT_REFERENCE','Payment is already associated with another invoice',409);}
   else{
    const value=new Decimal(String(attempt.amount));const available=Decimal.max(new Decimal(String(invoice.balance)),0);const allocation=Decimal.min(value,available);const unallocated=value.minus(allocation);const digits=precision(currency);const paid=new Decimal(String(invoice.paidAmount||'0')).plus(allocation);const balance=available.minus(allocation);
    await tx.put('payments',{...entity(org,paymentId),branchId:invoice.branchId,patientId:invoice.patientId,invoiceId:invoice.id,attemptId,amount:value.toFixed(digits),allocatedAmount:allocation.toFixed(digits),unallocatedAmount:unallocated.toFixed(digits),refundedAmount:new Decimal(0).toFixed(digits),allocatedRefundedAmount:new Decimal(0).toFixed(digits),currency,method:provider,providerReference:reference,status:'succeeded',reconciliationState:unallocated.gt(0)?'overpayment':'matched'});
    await this.update(tx,'invoices',invoice,{paidAmount:paid.toFixed(digits),balance:balance.toFixed(digits),status:balance.isZero()?'paid':'partially-paid'});await this.event(tx,org,'payment.recorded',{invoiceId:invoice.id,paymentId});
    if(unallocated.gt(0))await this.event(tx,org,'payment.reconciliation-required',{invoiceId:invoice.id,paymentId,reason:'overpayment'});
   }
   if(attempt.status!=='settled')await this.update(tx,'paymentAttempts',attempt,{status:'settled',providerPaymentReference:reference,settledAt:new Date().toISOString()});
   await tx.put('webhookEvents',{...entity(org,eventKey),provider,eventType,processedAt:new Date().toISOString()});return {received:true,paymentId};
  });
 }
 async webhook(providerValue:string,raw:Buffer,signature:string,_unsignedEventId?:string){
  const provider=this.provider(providerValue);const org=organizationId();const config=await this.integrations.config(provider,org);assert(config?.webhookSecret,'PROVIDER_UNCONFIGURED','Webhook integration is unavailable',503);let event:any;
  if(provider==='stripe'){try{event=new Stripe(config.secretKey).webhooks.constructEvent(raw,signature,config.webhookSecret);}catch{throw new DomainError('SIGNATURE','Invalid webhook signature',400);}}
  else{const expected=createHmac('sha256',config.webhookSecret).update(raw).digest('hex');assert(equal(expected,signature),'SIGNATURE','Invalid webhook signature',400);try{event=JSON.parse(raw.toString('utf8'));}catch{throw new DomainError('EVENT','Invalid event body');}}
  const type=String(provider==='stripe'?event.type:event.event);const eventId=provider==='stripe'?event.id:razorpayEventId(event,raw);assert(typeof eventId==='string'&&eventId.length>3&&eventId.length<500,'EVENT','Missing event identifier');const eventKey=`event-${paymentHash([provider,eventId])}`;
  if(provider==='stripe'&&['refund.created','refund.updated','refund.failed'].includes(type)||provider==='razorpay'&&['refund.created','refund.processed','refund.failed'].includes(type))return this.refundEvent(provider,provider==='stripe'?event.data?.object:event.payload?.refund?.entity,eventKey,type);
  const object=provider==='stripe'?event.data?.object:event.payload?.payment?.entity;
  const paid=provider==='stripe'?['checkout.session.completed','checkout.session.async_payment_succeeded'].includes(type)&&object?.payment_status==='paid':type==='payment.captured'&&object?.status==='captured';
  let attemptId=provider==='stripe'?object?.metadata?.attemptId:object?.notes?.attemptId;
  if(!attemptId&&provider==='razorpay'&&object?.order_id){const rows=await this.db.list<PaymentRow>('paymentAttempts',{eq:{organizationId:org,provider:'razorpay',providerReference:String(object.order_id)},limit:2});attemptId=rows[0]?.id;}
  if(paid){assert(attemptId,'ATTEMPT','Unknown payment attempt',409);return this.settle(provider,String(attemptId),object,eventKey,type);}
  const failure=provider==='stripe'?['checkout.session.expired','checkout.session.async_payment_failed'].includes(type):type==='payment.failed';
  return this.db.transaction([`webhook:${eventKey}`,`checkout:${String(attemptId)}`],async tx=>{
   if(await tx.get('webhookEvents',eventKey))return {received:true,duplicate:true};
   if(attemptId){const attempt=await tx.get<PaymentRow>('paymentAttempts',String(attemptId));if(attempt&&attempt.organizationId===org&&attempt.provider===provider&&attempt.status!=='settled'){
    // A Razorpay order can have several failed payment attempts and remain payable.
    const status=failure?(provider==='razorpay'?'ready':type==='checkout.session.expired'?'expired':'failed'):'awaiting-payment';
    if((failure||type==='checkout.session.completed')&&advances(attemptRank,attempt.status,status))await this.update(tx,'paymentAttempts',attempt,{status,lastProviderEvent:type});
   }}
   await tx.put('webhookEvents',{...entity(org,eventKey),provider,eventType:type,processedAt:new Date().toISOString()});return {received:true};
  });
 }
 async reconcile(providerValue:string,input:unknown,actor:Actor){
  this.finance(actor);const provider=this.provider(providerValue);const data=z.object({attemptId:z.string().min(1).max(100),providerReference:z.string().regex(/^[A-Za-z0-9_]+$/).max(200).optional()}).strict().parse(input);const attempt=await this.db.get<PaymentRow>('paymentAttempts',data.attemptId);assert(attempt&&attempt.organizationId===actor.organizationId&&attempt.provider===provider,'ATTEMPT','Attempt not found',404);await this.invoice(String(attempt.invoiceId),actor,this.db,true);const config=await this.config(provider,actor.organizationId);const reference=String(attempt.providerReference??data.providerReference??'');assert(reference,'PROVIDER_REFERENCE_REQUIRED','Provide the existing provider order/session reference from the merchant dashboard to reconcile the unknown outcome',409);
  if(provider==='stripe'){
   const session=await this.stripeFactory(config.secretKey).checkout.sessions.retrieve(reference);assert(session.metadata?.attemptId===attempt.id&&session.metadata?.organizationId===actor.organizationId,'PAYMENT_REFERENCE','Session belongs to another attempt',409);
   assert(session.amount_total===providerMinor(String(attempt.amount),String(attempt.currency),provider)&&String(session.currency).toUpperCase()===attempt.currency,'AMOUNT_MISMATCH','Provider amount or currency mismatch',409);
   if(session.payment_status==='paid')return this.settle(provider,attempt.id,session,`reconcile-${paymentHash([provider,session.id,'paid'])}`,'reconciliation');
   const response={provider,url:session.url,sessionId:session.id,attemptId:attempt.id};await this.db.transaction([`checkout:${attempt.id}`],async tx=>{const current=await tx.get<PaymentRow>('paymentAttempts',attempt.id);assert(current,'ATTEMPT','Attempt not found');if(current.status!=='settled')await this.update(tx,'paymentAttempts',current,{providerReference:session.id,status:session.status==='expired'?'expired':'ready',publicResponse:response});});return {status:session.status,checkout:response};
  }
  const order=await this.razor(config,`orders/${reference}`);assert(order.notes?.attemptId===attempt.id&&order.notes?.organizationId===actor.organizationId&&order.receipt===attempt.receipt,'PAYMENT_REFERENCE','Order belongs to another attempt',409);assert(Number(order.amount)===providerMinor(String(attempt.amount),String(attempt.currency),provider)&&String(order.currency).toUpperCase()===attempt.currency,'AMOUNT_MISMATCH','Provider amount or currency mismatch',409);
  const response={provider,keyId:config.keyId,orderId:order.id,amount:order.amount,currency:order.currency,attemptId:attempt.id};await this.db.transaction([`checkout:${attempt.id}`],async tx=>{const current=await tx.get<PaymentRow>('paymentAttempts',attempt.id);assert(current,'ATTEMPT','Attempt not found');if(current.status!=='settled')await this.update(tx,'paymentAttempts',current,{providerReference:order.id,status:'ready',publicResponse:response});});
  const payments=await this.razor(config,`orders/${reference}/payments`);const captured=(payments.items??[]).filter((p:any)=>p.status==='captured');for(const payment of captured)await this.settle(provider,attempt.id,payment,`reconcile-${paymentHash([provider,payment.id,'captured'])}`,'reconciliation');return {status:captured.length?'settled':order.status,checkout:response};
 }
 async refund(providerValue:string,input:unknown,actor:Actor){
  this.finance(actor);const provider=this.provider(providerValue);const data=z.object({paymentId:z.string().min(1).max(100),amount:decimalAmount,reason:z.string().trim().min(1).max(500),idempotencyKey:z.string().min(8).max(100)}).strict().parse(input);const initial=await this.db.get<PaymentRow>('payments',data.paymentId);assert(initial&&initial.organizationId===actor.organizationId&&initial.method===provider,'PAYMENT','Provider payment not found',404);await this.invoice(String(initial.invoiceId),actor,this.db,true);const key=`refund-request-${paymentHash([actor.organizationId,provider,data.idempotencyKey]).slice(0,40)}`;const config=await this.config(provider,actor.organizationId);const fingerprint=paymentHash(data);
  let request=await this.db.transaction([`${actor.organizationId}:invoice:${initial.invoiceId}`,`refund:${key}`],async tx=>{
   const existing=await tx.get<PaymentRow>('refundRequests',key);if(existing){assert(existing.requestHash===fingerprint,'IDEMPOTENCY','Refund key already used for another request',409);return existing;}
   const payment=await tx.get<PaymentRow>('payments',data.paymentId);assert(payment&&payment.providerReference,'PAYMENT','Payment provider reference is missing');const amount=new Decimal(data.amount);providerMinor(data.amount,String(payment.currency),provider);
   const requests=await tx.list<PaymentRow>('refundRequests',{eq:{organizationId:actor.organizationId,paymentId:payment.id},limit:10000});const reserved=requests.filter(r=>['creating','pending','needs-reconciliation'].includes(r.status)).reduce((n,r)=>n.plus(String(r.amount)),new Decimal(0));
   assert(amount.lte(new Decimal(String(payment.amount)).minus(String(payment.refundedAmount??'0')).minus(reserved)),'OVER_REFUND','Amount exceeds unrefunded and unreserved funds',409);
   return tx.put<PaymentRow>('refundRequests',{...entity(actor.organizationId,key),paymentId:payment.id,invoiceId:payment.invoiceId,provider,paymentReference:payment.providerReference,amount:data.amount,currency:payment.currency,reason:data.reason,status:'creating',requestHash:fingerprint,requestedBy:actor.id});
  });
  if(['succeeded','failed','canceled','pending'].includes(request.status))return {id:request.id,status:request.status,providerRefundId:request.providerRefundId};
  assert(Date.parse(request.createdAt)>Date.now()-23*3600000,'REFUND_RECONCILE','Reconcile this older refund attempt before retrying provider creation',409);
  let result:any;
  try{if(provider==='stripe')result=await this.stripeFactory(config.secretKey).refunds.create({payment_intent:String(request.paymentReference),amount:providerMinor(String(request.amount),String(request.currency),provider),metadata:{requestId:request.id,organizationId:actor.organizationId}},{idempotencyKey:request.id});
   else result=await this.razor(config,`payments/${request.paymentReference}/refund`,{method:'POST',idempotencyKey:request.id,body:{amount:providerMinor(String(request.amount),String(request.currency),provider),notes:{requestId:request.id,organizationId:actor.organizationId},speed:'normal'}});
  }catch(error){await this.db.transaction([`refund:${key}`],async tx=>{const r=await tx.get<PaymentRow>('refundRequests',key);if(r&&r.status==='creating')await this.update(tx,'refundRequests',r,{status:'needs-reconciliation'});});throw error;}
  await this.refundEvent(provider,result,`refund-api-${paymentHash([provider,result.id,result.status])}`,'refund.api');request=(await this.db.get<PaymentRow>('refundRequests',key))!;return {id:request.id,status:request.status,providerRefundId:result.id};
 }
 async reconcileRefund(providerValue:string,input:unknown,actor:Actor){
  this.finance(actor);const provider=this.provider(providerValue);const data=z.object({requestId:z.string().min(1).max(100),providerRefundId:z.string().regex(/^[A-Za-z0-9_]+$/).max(200).optional()}).strict().parse(input);const request=await this.db.get<PaymentRow>('refundRequests',data.requestId);assert(request&&request.organizationId===actor.organizationId&&request.provider===provider,'REFUND','Refund request not found',404);await this.invoice(String(request.invoiceId),actor,this.db,true);const reference=String(request.providerRefundId??data.providerRefundId??'');assert(reference,'PROVIDER_REFERENCE_REQUIRED','Provide the existing provider refund reference to reconcile its outcome',409);const config=await this.config(provider,actor.organizationId);const refund=provider==='stripe'?await this.stripeFactory(config.secretKey).refunds.retrieve(reference):await this.razor(config,`refunds/${reference}`);const requestId=provider==='stripe'?refund.metadata?.requestId:refund.notes?.requestId;assert(requestId===request.id,'REFUND_EVENT','Provider refund belongs to another request',409);return this.refundEvent(provider,refund,`refund-reconcile-${paymentHash([provider,refund.id,refund.status])}`,'refund.reconciliation');
 }
 private async refundEvent(provider:PaymentProvider,object:any,eventKey:string,eventType:string):Promise<Record<string,unknown>>{
  const org=organizationId();assert(object&&typeof object.id==='string','REFUND_EVENT','Invalid refund event');const requestId=provider==='stripe'?object.metadata?.requestId:object.notes?.requestId;
  const paymentReference=String(provider==='stripe'?(typeof object.payment_intent==='string'?object.payment_intent:object.payment_intent?.id):object.payment_id);let request=requestId?await this.db.get<PaymentRow>('refundRequests',String(requestId)):null;
  const matches=await this.db.list<PaymentRow>('payments',{eq:{organizationId:org,method:provider,providerReference:paymentReference},limit:2});const initial=matches[0];
  // Merchant-dashboard refunds also reconcile, provided their verified payment is recorded locally.
  assert(initial,'PAYMENT','Refund payment has not yet been recorded; retry this event after capture',409);
  return this.db.transaction([`${org}:invoice:${initial.invoiceId}`,`refund:${request?.id??object.id}`,`webhook:${eventKey}`],async tx=>{
   if(await tx.get('webhookEvents',eventKey))return {received:true,duplicate:true};const payment=await tx.get<PaymentRow>('payments',initial.id);const invoice=await tx.get<PaymentRow>('invoices',String(initial.invoiceId));assert(payment&&invoice&&invoice.organizationId===org,'PAYMENT','Refund records missing',409);
   if(requestId){request=await tx.get<PaymentRow>('refundRequests',String(requestId));assert(request&&request.organizationId===org&&request.paymentId===payment.id&&request.provider===provider,'REFUND_EVENT','Refund request mismatch',409);assert(Number(object.amount)===providerMinor(String(request.amount),String(request.currency),provider),'AMOUNT_MISMATCH','Refund amount differs from request',409);}
   const success=provider==='stripe'?object.status==='succeeded':object.status==='processed';const failed=['failed','canceled'].includes(String(object.status));const status=success?'succeeded':failed?String(object.status):'pending';
   const currency=String(object.currency).toUpperCase();assert(currency===payment.currency&&Number.isSafeInteger(Number(object.amount))&&Number(object.amount)>0,'AMOUNT_MISMATCH','Invalid refund amount or currency',409);
   const factor=providerMinor('1',currency,provider);const value=new Decimal(String(object.amount)).div(factor);assert(value.eq(value.toDecimalPlaces(precision(currency))),'AMOUNT_MISMATCH','Refund exceeds currency precision');
   const refundId=`gateway-refund-${paymentHash([provider,object.id]).slice(0,40)}`;const existing=await tx.get<PaymentRow>('refunds',refundId);
   if(success&&!existing){
    const refunded=new Decimal(String(payment.refundedAmount??'0')).plus(value);assert(refunded.lte(String(payment.amount)),'OVER_REFUND','Provider refunds exceed payment',409);
    const unallocated=new Decimal(String(payment.unallocatedAmount??'0'));const fromUnallocated=Decimal.min(value,unallocated);const allocatedRefund=value.minus(fromUnallocated);const paid=new Decimal(String(invoice.paidAmount)).minus(allocatedRefund);assert(paid.gte(0),'RECONCILIATION','Refund allocation exceeds invoice allocation',409);
    await tx.put('refunds',{...entity(org,refundId),branchId:invoice.branchId,patientId:invoice.patientId,paymentId:payment.id,invoiceId:invoice.id,currency,amount:value.toFixed(precision(currency)),allocatedAmount:allocatedRefund.toFixed(precision(currency)),reason:request?.reason??'Merchant provider refund',method:provider,providerReference:object.id,status:'succeeded'});
    await this.update(tx,'payments',payment,{refundedAmount:refunded.toFixed(precision(currency)),allocatedRefundedAmount:new Decimal(String(payment.allocatedRefundedAmount??'0')).plus(allocatedRefund).toFixed(precision(currency)),unallocatedAmount:unallocated.minus(fromUnallocated).toFixed(precision(currency)),status:refunded.eq(String(payment.amount))?'refunded':'partially-refunded'});
    const balance=new Decimal(String(invoice.balance)).plus(allocatedRefund);await this.update(tx,'invoices',invoice,{paidAmount:paid.toFixed(precision(currency)),balance:balance.toFixed(precision(currency)),status:balance.isZero()?(new Decimal(String(invoice.creditedAmount??'0')).gt(0)?'credited':'paid'):paid.isZero()?'issued':'partially-paid'});await this.event(tx,org,'payment.refunded',{paymentId:payment.id,refundId,invoiceId:invoice.id});
   }
   if(request&&(advances(refundRank,request.status,status)||(!request.providerRefundId&&request.status===status)))await this.update(tx,'refundRequests',request,{status,providerRefundId:object.id});await tx.put('webhookEvents',{...entity(org,eventKey),provider,eventType,processedAt:new Date().toISOString()});return {received:true,status};
  });
 }
}
