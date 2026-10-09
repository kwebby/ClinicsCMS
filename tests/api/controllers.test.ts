/* Author: ramanpal singh | URL: https://kwebby.com */
import { describe,expect,it,vi } from 'vitest';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import { ClinicController,PublicController,availableSlots } from '../../apps/api/src/controllers.js';
import { entity } from '../../apps/api/src/auth.js';
import { newId } from '../../packages/core/src/index.js';
import type { Actor,Entity } from '../../packages/contracts/src/index.js';

const owner:Actor={id:'owner',organizationId:'clinic',roles:['owner'],branchIds:['main'],patientIds:[],name:'Owner',email:'owner@example.test'};
const controller=(db:MemoryDatabase,clinic:Record<string,unknown>={})=>new ClinicController({db,clinic,auth:{require:async()=>owner}} as any);

describe('record routes',()=>{
 it('returns the caller\'s saved notification preferences',async()=>{
  const notificationPreferences=vi.fn(async()=>({email:false}));const c=controller(new MemoryDatabase(),{notificationPreferences});
  expect(await c.notificationPreferences({} as any)).toEqual({data:{email:false}});expect(notificationPreferences).toHaveBeenCalledWith(owner);
 });
 it('passes search and order through, keeps them out of field filters, and validates them',async()=>{
  const listPage=vi.fn(async()=>({data:[],next:'cursor-1'}));const c=controller(new MemoryDatabase(),{listPage});
  expect(await c.list('patients',{q:'  Ann  ',order:'desc',limit:'20',after:'x',branchId:'main',active:'true'},{} as any)).toEqual({data:[],next:'cursor-1'});
  expect(listPage).toHaveBeenCalledWith('patients',owner,{limit:20,after:'x',eq:{branchId:'main',active:true},q:'Ann',order:'desc'});
  await expect(c.list('patients',{q:'x'.repeat(101)},{} as any)).rejects.toMatchObject({code:'QUERY'});await expect(c.list('patients',{order:'sideways'},{} as any)).rejects.toMatchObject({code:'QUERY'});
  await expect(c.list('patients',{branchId:['a','b'] as any},{} as any)).rejects.toMatchObject({code:'QUERY'});
 });
 it('keeps null values in PATCH bodies so optional fields can be cleared',async()=>{
  const update=vi.fn(async()=>({}));await controller(new MemoryDatabase(),{update}).update('patients','p1',{expectedVersion:3,phone:null,name:'Ann'},{} as any);
  expect(update).toHaveBeenCalledWith('patients','p1',{phone:null,name:'Ann',expectedVersion:3},owner);
 });
});

describe('administrator views',()=>{
 it('return audit and job rows newest first with a cursor and bounded limit',async()=>{
  const db=new MemoryDatabase();const base=Date.parse('2026-10-01T00:00:00Z');
  for(let i=0;i<5;i++){await db.put('audit',{...entity('clinic',newId(base+i*60000)),action:`step-${i}`});await db.put('outbox',{...entity('clinic',newId(base+i*60000)),type:'lead.created',status:i%2?'failed':'completed',payload:{},attempts:1,nextAttemptAt:'2026-10-01T00:00:00Z'});}
  const c=controller(db);const first=(await c.audit({} as any,{limit:'2'})).data as Entity[];expect(first.map(r=>r.action)).toEqual(['step-4','step-3']);
  const next=(await c.audit({} as any,{limit:'2',after:first[1].id})).data as Entity[];expect(next.map(r=>r.action)).toEqual(['step-2','step-1']);
  expect(((await c.audit({} as any)).data as Entity[])).toHaveLength(5);await expect(c.audit({} as any,{limit:'501'})).rejects.toMatchObject({code:'QUERY'});
  const failed=(await c.jobs({} as any,{status:'failed'})).data as Entity[];expect(failed).toHaveLength(2);expect(failed[0].id>failed[1].id).toBe(true);expect(failed[0]).not.toHaveProperty('payload');
 });
 it('lists payment activity for every visible invoice, newest first',async()=>{
  const db=new MemoryDatabase();for(let i=0;i<3;i++){await db.put('invoices',{...entity('clinic',`inv-${i}`),branchId:'main',patientId:'p'});await db.put('paymentAttempts',{...entity('clinic',`checkout-${i}`),invoiceId:`inv-${i}`,provider:'stripe',amount:'1.00',currency:'USD',status:'ready',createdAt:`2026-10-0${i+1}T00:00:00.000Z`});}
  const c=controller(db);const page=(await c.paymentActivity({} as any,{limit:'2'})).data as any;expect(page.attempts.map((a:any)=>a.id)).toEqual(['checkout-2','checkout-1']);
  expect(((await c.paymentActivity({} as any,{limit:'2',attemptsAfter:'checkout-1'})).data as any).attempts.map((a:any)=>a.id)).toEqual(['checkout-0']);
 });
 it('retries email with uncertain SMTP acceptance only after an explicit, audited confirmation',async()=>{
  const db=new MemoryDatabase();await db.put('outbox',{...entity('clinic','job'),type:'email.send',status:'failed',attempts:5,payload:{to:'patient@example.test',template:'verify-email',data:{}}});await db.put('mailDeliveries',{...entity('clinic','mail-job'),outboxId:'job',status:'acceptance-unknown'});
  const c=controller(db);await expect(c.retry('job',{} as any,{})).rejects.toMatchObject({code:'MAIL_DELIVERY_UNCERTAIN',status:409});expect((await db.get('outbox','job'))?.status).toBe('failed');
  await expect(c.retry('job',{} as any,{confirmNotDelivered:false})).rejects.toBeTruthy();
  expect(((await c.retry('job',{} as any,{confirmNotDelivered:true})).data as Entity).status).toBe('pending');
  expect(await db.get('mailDeliveries','mail-job')).toMatchObject({status:'failed-before-send',resetFrom:'acceptance-unknown',resetBy:'owner'});expect((await db.list('audit')).map(a=>a.action)).toContain('outbox.retry.confirmed-not-delivered');
 });
});

/** The previous minute-by-minute implementation, kept as the reference for slot equivalence. */
function referenceSlots(rules:Entity[],date:string,now:number){
 const center=Date.parse(date+'T00:00:00Z'),slots:{startsAt:string;endsAt:string}[]=[];
 for(const rule of rules){const format=new Intl.DateTimeFormat('en-CA',{timeZone:String(rule.timezone),year:'numeric',month:'2-digit',day:'2-digit',weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});for(let t=center-86400000;t<center+2*86400000;t+=60000){if(t<=now)continue;const p=Object.fromEntries(format.formatToParts(t).map(v=>[v.type,v.value]));if(`${p.year}-${p.month}-${p.day}`!==date||['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)!==rule.weekday)continue;const minutes=Number(p.hour)*60+Number(p.minute),[h,m]=String(rule.startTime).split(':').map(Number),[eh,em]=String(rule.endTime).split(':').map(Number),duration=Number(rule.slotMinutes);if(minutes<h*60+m||(minutes-h*60-m)%duration||minutes+duration>eh*60+em)continue;slots.push({startsAt:new Date(t).toISOString(),endsAt:new Date(t+duration*60000).toISOString()});}}
 return [...new Map(slots.map(slot=>[slot.startsAt,slot])).values()].sort((a,b)=>a.startsAt.localeCompare(b.startsAt));
}
describe('public availability',()=>{
 it('matches the minute-by-minute result across time zones and daylight-saving changes',()=>{
  const cases:[string,string][]=[['America/New_York','2026-03-08'],['America/New_York','2026-11-01'],['Europe/London','2026-03-29'],['Europe/London','2026-10-25'],['Asia/Kolkata','2026-10-20'],['Australia/Lord_Howe','2026-10-04'],['Pacific/Chatham','2026-09-27'],['UTC','2026-12-31']];
  for(const [timezone,date] of cases){const weekday=new Date(date+'T00:00:00Z').getUTCDay();const rules=[{startTime:'00:00',endTime:'23:59',slotMinutes:15},{startTime:'01:10',endTime:'03:40',slotMinutes:20},{startTime:'09:00',endTime:'17:00',slotMinutes:45}].map((r,i)=>({...entity('clinic',`r${i}`),...r,weekday,timezone}));
   expect(availableSlots(rules,date,0,()=>false)).toEqual(referenceSlots(rules,date,0));}
 });
 it('excludes busy and past slots and stays cheap for the largest allowed configuration',()=>{
  const date='2026-10-20',weekday=new Date(date+'T00:00:00Z').getUTCDay(),rules=Array.from({length:20},(_,i)=>({...entity('clinic',`r${i}`),weekday,timezone:i%2?'America/New_York':'Asia/Kolkata',startTime:'00:00',endTime:'23:59',slotMinutes:5}));
  const busyStart=Date.parse('2026-10-20T10:00:00Z');const started=performance.now();const slots=availableSlots(rules,date,Date.parse('2026-10-20T06:00:00Z'),(s,e)=>s<busyStart+3600000&&e>busyStart);expect(performance.now()-started).toBeLessThan(1000);
  expect(slots.length).toBeGreaterThan(0);expect(slots.every(s=>Date.parse(s.startsAt)>Date.parse('2026-10-20T06:00:00Z'))).toBe(true);expect(slots.some(s=>Date.parse(s.startsAt)>=busyStart&&Date.parse(s.startsAt)<busyStart+3600000)).toBe(false);
 });
});

describe('public tools',()=>{
 function publicController(){
  const db=new MemoryDatabase(),counts=new Map<string,number>();
  const limiter={take:async(key:string,limit:number)=>{const n=(counts.get(key)??0)+1;counts.set(key,n);if(n>limit)throw Object.assign(new Error('limited'),{status:429,code:'RATE_LIMIT'});}};
  return {db,controller:new PublicController({db,org:'clinic',limiter} as any)};
 }
 const req=(ip:string)=>({ip,get:(name:string)=>name==='origin'?'http://localhost:3000':undefined}) as any;
 it('stores anonymous marketing consent as unconfirmed and limits reports per recipient address',async()=>{
  vi.stubEnv('PUBLIC_URL','http://localhost:3000');vi.stubEnv('INSTALLATION_AUDIENCE','patient');
  try{
   const {db,controller}=publicController();const body={input:{},email:'Target@Example.test',marketingConsent:true};
   for(let i=0;i<3;i++)await controller.tool('visit-preparation',body,req(`203.0.113.${i}`));
   await expect(controller.tool('visit-preparation',{...body,email:'target@example.test'},req('203.0.113.99'))).rejects.toMatchObject({status:429});
   const leads=await db.list('leads');expect(leads).toHaveLength(3);expect(leads.every(l=>l.marketingConsent===false&&l.marketingConsentStatus==='unconfirmed')).toBe(true);
   expect((await db.list('outbox')).filter(r=>r.type==='email.send')).toHaveLength(3);
   await controller.lead({name:'Visitor',email:'visitor@example.test',marketingConsent:true},req('203.0.113.50'));expect((await db.list('leads')).find(l=>l.email==='visitor@example.test')).toMatchObject({marketingConsent:false,marketingConsentStatus:'unconfirmed'});
  }finally{vi.unstubAllEnvs();}
 });
});
