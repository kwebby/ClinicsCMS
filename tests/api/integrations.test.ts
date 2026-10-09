/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { createHmac,randomBytes } from 'node:crypto';
import net from 'node:net';
import nodemailer from 'nodemailer';
import Stripe from 'stripe';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import { IntegrationService,PaymentService,smtpFailureOutcome,MailDeliveryError } from '../../apps/api/src/integrations.js';
import { Secrets } from '../../apps/api/src/security.js';
import type { Actor,Entity } from '../../packages/contracts/src/index.js';

const owner:Actor={id:'owner',organizationId:'clinic',roles:['owner'],branchIds:['main'],patientIds:[],name:'Owner',email:'owner@example.test'};
const row=(id:string,extra:Record<string,unknown>):Entity=>({id,organizationId:'clinic',version:1,createdAt:'2026-10-09T00:00:00.000Z',updatedAt:'2026-10-09T00:00:00.000Z',...extra});
beforeEach(()=>{vi.stubEnv('ORGANIZATION_ID','clinic');vi.stubEnv('AI_ALLOWED_HOSTS','api.openai.com,ai.example.test');});
afterEach(()=>{vi.unstubAllEnvs();});

describe('stored integration secrets',()=>{
 const smtp={host:'smtp.example.test',port:587,secure:false,user:'mailer',from:'clinic@example.test'};
 it('clears a stored SMTP password when host, port or user changes without a new password',async()=>{
  const db=new MemoryDatabase(),service=new IntegrationService(db,new Secrets(randomBytes(32).toString('base64')));
  await service.save('smtp',{...smtp,password:'original secret'},owner);expect(await service.get('smtp',owner)).toMatchObject({passwordConfigured:true});
  await service.save('smtp',smtp,owner);expect((await service.config('smtp','clinic'))?.password).toBe('original secret');
  await service.save('smtp',{...smtp,host:'attacker.example.test'},owner);expect(await service.get('smtp',owner)).not.toHaveProperty('passwordConfigured');expect((await service.config('smtp','clinic'))?.password).toBeUndefined();
  expect((await db.list('audit')).some(a=>Array.isArray(a.clearedSecrets)&&a.clearedSecrets.includes('password'))).toBe(true);
  for(const change of [{port:2525},{user:'someone-else'}]){await service.save('smtp',{...smtp,password:'original secret'},owner);await service.save('smtp',{...smtp,...change},owner);expect((await service.config('smtp','clinic'))?.password).toBeUndefined();}
  await service.save('smtp',{...smtp,host:'new.example.test',password:'new secret'},owner);expect((await service.config('smtp','clinic'))?.password).toBe('new secret');
 });
 it('applies the same rule to the AI endpoint key and the Razorpay key pair',async()=>{
  const db=new MemoryDatabase(),service=new IntegrationService(db,new Secrets(randomBytes(32).toString('base64')));
  await service.save('ai',{apiKey:'ai-secret',model:'draft-model'},owner);await service.save('ai',{model:'other-model'},owner);expect((await service.config('ai','clinic'))?.apiKey).toBe('ai-secret');
  await service.save('ai',{model:'draft-model',baseUrl:'https://ai.example.test/v1'},owner);expect((await service.config('ai','clinic'))?.apiKey).toBeUndefined();
  await service.save('razorpay',{keyId:'rzp_first',keySecret:'razorpay-secret-1',webhookSecret:'webhook-secret-1'},owner);await service.save('razorpay',{keyId:'rzp_second'},owner);
  expect(await service.config('razorpay','clinic')).toMatchObject({keyId:'rzp_second',webhookSecret:'webhook-secret-1'});expect((await service.config('razorpay','clinic'))?.keySecret).toBeUndefined();
 });
});

type Script={rcpt?:string;afterData?:'accept'|'reject'|'drop';dropAfterMail?:boolean};
/** A minimal scripted SMTP peer, enough to drive each protocol phase. */
async function smtpPeer(script:Script){
 const server=net.createServer(socket=>{
  let buffer='',data=false;socket.on('error',()=>{});socket.write('220 test ESMTP\r\n');
  socket.on('data',chunk=>{buffer+=chunk.toString('binary');for(;;){
   if(data){const end=buffer.indexOf('\r\n.\r\n');if(end<0)return;buffer=buffer.slice(end+5);data=false;if(script.afterData==='drop'){socket.destroy();return;}socket.write(script.afterData==='reject'?'554 5.7.1 Message refused\r\n':'250 2.0.0 Queued\r\n');continue;}
   const index=buffer.indexOf('\r\n');if(index<0)return;const command=buffer.slice(0,4).toUpperCase();buffer=buffer.slice(index+2);
   if(command==='EHLO'||command==='HELO')socket.write('250-test\r\n250 8BITMIME\r\n');
   else if(command==='MAIL'){if(script.dropAfterMail){socket.destroy();return;}socket.write('250 OK\r\n');}
   else if(command==='RCPT')socket.write(script.rcpt??'250 OK\r\n');
   else if(command==='DATA'){socket.write('354 Go ahead\r\n');data=true;}
   else if(command==='QUIT'){socket.end('221 Bye\r\n');return;}
   else socket.write('250 OK\r\n');
  }});
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));return {server,port:(server.address() as net.AddressInfo).port};
}
async function mailer(port:number){
 const db=new MemoryDatabase(),service=new IntegrationService(db,new Secrets(randomBytes(32).toString('base64')),options=>nodemailer.createTransport({...options,requireTLS:false,ignoreTLS:true,connectionTimeout:2000,greetingTimeout:2000,socketTimeout:2000} as any));
 await service.save('smtp',{host:'127.0.0.1',port,secure:false,from:'clinic@example.test'},owner);return service;
}
describe('SMTP failure classification',()=>{
 it('treats failures before the server accepted DATA as retriable and only post-DATA losses as uncertain',async()=>{
  const cases:[Script|'refused',string|null][]=[['refused','failed-before-send'],[{dropAfterMail:true},'failed-before-send'],[{rcpt:'550 5.1.1 No such user\r\n'},'failed-before-send'],[{rcpt:'451 4.3.0 Try later\r\n'},'failed-before-send'],[{afterData:'reject'},'smtp-rejected'],[{afterData:'drop'},'acceptance-unknown'],[{afterData:'accept'},null]];
  for(const [script,expected] of cases){
   const peer=script==='refused'?await smtpPeer({}):await smtpPeer(script);const port=peer.port;if(script==='refused')await new Promise(resolve=>peer.server.close(resolve));
   const service=await mailer(port),attempt=service.sendMail('clinic','patient@example.test','Subject','Body','mail-test');
   if(expected)await expect(attempt).rejects.toMatchObject({outcome:expected});else await expect(attempt).resolves.toMatchObject({accepted:true});
   if(script!=='refused')await new Promise(resolve=>peer.server.close(resolve));
  }
 });
 it('never treats an unclassified failure after DATA as retriable',()=>{
  expect(smtpFailureOutcome({code:'ETIMEDOUT'},false)).toBe('failed-before-send');expect(smtpFailureOutcome({code:'ETIMEDOUT'},true)).toBe('acceptance-unknown');
  expect(smtpFailureOutcome({code:'EMESSAGE',responseCode:554},true)).toBe('smtp-rejected');expect(smtpFailureOutcome(new Error('unknown'),true)).toBe('acceptance-unknown');
  expect(new MailDeliveryError('failed-before-send','EAUTH')).toMatchObject({status:502,code:'SMTP_SEND_FAILED',smtpCode:'EAUTH'});
 });
});

describe('payment webhooks',()=>{
 const config={stripe:{secretKey:'sk_test_fixture_only',webhookSecret:'whsec_fixture_only'},razorpay:{keyId:'rzp_test_fixture',keySecret:'fixture-secret',webhookSecret:'fixture-webhook'}};
 const stripe=new Stripe(config.stripe.secretKey);
 async function setup(){
  const db=new MemoryDatabase(),payments=new PaymentService(db,{config:async(name:keyof typeof config)=>config[name]} as unknown as IntegrationService);
  await db.put('invoices',row('invoice',{status:'issued',balance:'100.00',paidAmount:'0.00',currency:'USD',branchId:'main',patientId:'patient'}));return {db,payments};
 }
 const stripeEvent=(payments:PaymentService,id:string,type:string,object:Record<string,unknown>)=>{const raw=JSON.stringify({id,type,data:{object}});return payments.webhook('stripe',Buffer.from(raw),stripe.webhooks.generateTestHeaderString({payload:raw,secret:config.stripe.webhookSecret}));};
 const razorEvent=(payments:PaymentService,body:Record<string,unknown>,unsignedHeader:string)=>{const raw=Buffer.from(JSON.stringify(body));return payments.webhook('razorpay',raw,createHmac('sha256',config.razorpay.webhookSecret).update(raw).digest('hex'),unsignedHeader);};
 it('deduplicates Razorpay events by signed content, not the unsigned event-id header',async()=>{
  const {db,payments}=await setup();await db.put('paymentAttempts',row('attempt',{provider:'razorpay',invoiceId:'invoice',amount:'100.00',currency:'USD',status:'ready',providerReference:'order_1'}));
  const body={event:'payment.failed',created_at:1791500000,payload:{payment:{entity:{id:'pay_1',order_id:'order_1',status:'failed',amount:10000,currency:'USD',notes:{attemptId:'attempt'}}}}};
  expect(await razorEvent(payments,body,'header-one')).toEqual({received:true});expect(await razorEvent(payments,body,'header-two')).toMatchObject({duplicate:true});
  expect(await razorEvent(payments,{...body,created_at:1791500100},'header-one')).toEqual({received:true});
 });
 it('never moves a failed checkout back to awaiting payment on a late or replayed event',async()=>{
  const {db,payments}=await setup();await db.put('paymentAttempts',row('attempt',{provider:'stripe',invoiceId:'invoice',amount:'100.00',currency:'USD',status:'ready',providerReference:'cs_1'}));
  const session={id:'cs_1',metadata:{attemptId:'attempt'},currency:'usd',amount_total:10000,payment_intent:'pi_1',payment_status:'unpaid'};
  await stripeEvent(payments,'evt_failed','checkout.session.async_payment_failed',session);expect((await db.get('paymentAttempts','attempt'))?.status).toBe('failed');
  await stripeEvent(payments,'evt_late_completed','checkout.session.completed',session);expect((await db.get('paymentAttempts','attempt'))?.status).toBe('failed');
 });
 it('never moves a failed refund back to pending, which would reserve funds again',async()=>{
  const {db,payments}=await setup();const invoice=(await db.get('invoices','invoice'))!;await db.put('invoices',{...invoice,status:'paid',balance:'0.00',paidAmount:'100.00',version:2},1);await db.put('payments',row('payment',{method:'razorpay',providerReference:'pay_1',invoiceId:'invoice',amount:'100.00',allocatedAmount:'100.00',unallocatedAmount:'0.00',refundedAmount:'0.00',allocatedRefundedAmount:'0.00',currency:'USD',status:'succeeded'}));
  await db.put('refundRequests',row('request',{paymentId:'payment',invoiceId:'invoice',provider:'razorpay',paymentReference:'pay_1',amount:'20.00',currency:'USD',status:'failed',providerRefundId:'rfnd_1'}));
  const refund=(status:string,created:number)=>({event:status==='processed'?'refund.processed':'refund.created',created_at:created,payload:{refund:{entity:{id:'rfnd_1',payment_id:'pay_1',amount:2000,currency:'USD',status,notes:{requestId:'request'}}}}});
  await razorEvent(payments,refund('pending',1791500000),'h');expect((await db.get('refundRequests','request'))?.status).toBe('failed');expect(await db.list('refunds')).toHaveLength(0);
  await razorEvent(payments,refund('processed',1791500200),'h');expect((await db.get('refundRequests','request'))?.status).toBe('succeeded');
  await razorEvent(payments,refund('pending',1791500300),'h');expect((await db.get('refundRequests','request'))?.status).toBe('succeeded');expect(await db.list('refunds')).toHaveLength(1);
 });
});
