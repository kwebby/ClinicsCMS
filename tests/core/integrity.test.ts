/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { ClinicService } from '../../packages/core/src/index.js';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import type { Actor, Entity } from '../../packages/contracts/src/index.js';

const makeActor=(id:string,roles:Actor['roles'],branchIds=['main'],patientIds:string[]=[]):Actor=>({id,organizationId:'clinic',name:id,email:`${id}@example.test`,roles,branchIds,patientIds});
const owner=makeActor('owner',['owner']),doctor=makeActor('doctor',['doctor']),doctor2=makeActor('doctor2',['doctor']),nurse=makeActor('nurse',['nurse']),reception=makeActor('reception',['receptionist']);
const hr=makeActor('hr',['hr']),hr2=makeActor('hr2',['hr']),manager=makeActor('manager',['manager']),accountant=makeActor('accountant',['accountant']),editor=makeActor('editor',['editor']);
const content=[{id:'p1',type:'paragraph',props:{},content:[{type:'text',text:'Synthetic note',styles:{}}],children:[]}];
const legacyHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let db:MemoryDatabase,core:ClinicService,patientRow:Entity,otherPatient:Entity,patient:Actor;
async function raw(collection:string,id:string,data:Record<string,unknown>){const stamp=new Date().toISOString();return db.put(collection,{...data,id,organizationId:'clinic',version:1,createdAt:stamp,updatedAt:stamp});}
async function users(...actors:Actor[]){for(const actor of actors)await raw('users',actor.id,{...actor,status:'active'});}
async function issued(){const draft=await core.create('invoices',{branchId:'main',patientId:patientRow.id,currency:'USD',lines:[{description:'Visit',quantity:'1',unitPrice:'99.00'}]},accountant);return core.execute('invoices.issue',{id:draft.id,expectedVersion:1},accountant);}

// Monday 2026-10-05 08:00 UTC; only Date is faked so promises and timers behave normally.
beforeEach(()=>{vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(new Date('2026-10-05T08:00:00Z'));});
afterEach(()=>{vi.useRealTimers();vi.restoreAllMocks();});
beforeEach(async()=>{
 db=new MemoryDatabase();core=new ClinicService(db);
 await users(owner,doctor,doctor2,nurse,reception,hr,hr2,manager,accountant,editor);
 patientRow=await core.create('patients',{branchId:'main',name:'Alex Patient',phone:'5550100',email:'alex@example.test'},reception);
 otherPatient=await core.create('patients',{branchId:'main',name:'Robin Other'},reception);
 patient=makeActor('patient',['patient'],[],[patientRow.id]);await raw('users',patient.id,{...patient,status:'active'});
 await core.create('settings',{key:'business',value:{clinicName:'Example Clinic',country:'US',currency:'USD',timezone:'UTC',locale:'en-US',address:'1 Street',email:'clinic@example.test',phone:'12345'}},owner);
 for(const id of ['doctor','doctor2'])await core.create('availability',{branchId:'main',doctorId:id,weekday:1,startTime:'09:00',endTime:'17:00',timezone:'UTC',slotMinutes:30},owner);
});

describe('narrow transaction locks',()=>{
 test('writes lock the record, its referenced users and only the scopes an invariant needs',async()=>{
  const spy=vi.spyOn(db,'transaction');const keys=()=>spy.mock.calls.at(-1)![0];
  const task=await core.create('tasks',{branchId:'main',title:'Call back',assignedTo:'nurse'},reception);
  expect(keys()).toEqual(['user:nurse']);
  await core.update('tasks',task.id,{expectedVersion:1,assignedTo:'reception'},manager);
  expect(keys()).toEqual([`clinic:tasks:${task.id}`,'user:reception']);
  await core.create('appointments',{branchId:'main',patientId:patientRow.id,doctorId:'doctor',startsAt:'2026-10-05T10:00:00Z',endsAt:'2026-10-05T10:30:00Z'},reception);
  expect(new Set(keys())).toEqual(new Set(['clinic:schedule:doctor',`clinic:schedule:patient:${patientRow.id}`,'user:doctor']));
  await core.create('pages',{title:'About',slug:'about',kind:'about',locale:'en',content},editor);
  expect(keys()).toEqual(['clinic:pages','clinic:settings']);
  const invoice=await issued();expect(keys()).toEqual(['clinic:invoice-counter:main',`clinic:invoice:${invoice.id}`]);
  for(const [lockKeys] of spy.mock.calls)expect(lockKeys.filter((key:string)=>['clinic:users','clinic:tasks','clinic:invoices','clinic:appointments'].includes(key))).toEqual([]);
 });
});

describe('bounded list scans',()=>{
 test('a sparse scan stops at the budget and hands back a cursor that continues it',async()=>{
  const stamp=new Date().toISOString();const north=makeActor('north-desk',['receptionist'],['north']);
  for(let index=0;index<6000;index++)await db.put('patients',{id:`bulk-${String(index).padStart(5,'0')}`,organizationId:'clinic',version:1,createdAt:stamp,updatedAt:stamp,branchId:'other',name:'Hidden'});
  for(let index=0;index<3;index++)await db.put('patients',{id:`bulk-9${index}`,organizationId:'clinic',version:1,createdAt:stamp,updatedAt:stamp,branchId:'north',name:'Visible'});
  const list=vi.spyOn(db,'list');const first=await core.listPage('patients',north,{limit:10});
  expect(first.data).toEqual([]);expect(first.next).toBeTruthy();expect(list.mock.calls.length).toBeLessThanOrEqual(10);expect(list.mock.calls.every(([,query])=>(query?.limit??0)<=500)).toBe(true);
  const second=await core.listPage('patients',north,{limit:10,after:first.next});
  expect(second.data.map(row=>row.id)).toEqual(['bulk-90','bulk-91','bulk-92']);expect(second.next).toBeUndefined();
  expect(await core.list('patients',north,{limit:10})).toEqual([]);
 });
 test('patient-only reads are pushed down to their linked patient and conversations',async()=>{
  await core.create('appointments',{branchId:'main',patientId:patientRow.id,doctorId:'doctor',startsAt:'2026-10-05T10:00:00Z',endsAt:'2026-10-05T10:30:00Z'},reception);
  await core.create('appointments',{branchId:'main',patientId:otherPatient.id,doctorId:'doctor',startsAt:'2026-10-05T11:00:00Z',endsAt:'2026-10-05T11:30:00Z'},reception);
  const thread=await core.create('conversations',{branchId:'main',title:'Service',kind:'patient-service',patientId:patientRow.id,participantIds:['reception','patient']},reception);
  await core.execute('conversations.send',{conversationId:thread.id,body:'Hello',idempotencyKey:'message-key-0001'},patient);
  const list=vi.spyOn(db,'list');
  expect((await core.list('appointments',patient)).map(r=>r.patientId)).toEqual([patientRow.id]);
  expect(list.mock.calls.every(([,query])=>query?.eq?.patientId===patientRow.id)).toBe(true);
  list.mockClear();expect(await core.list('messages',patient)).toHaveLength(1);expect(list.mock.calls.filter(([c])=>c==='messages').every(([,query])=>query?.eq?.conversationId===thread.id)).toBe(true);
  list.mockClear();expect(await core.list('tasks',patient)).toEqual([]);expect(list).not.toHaveBeenCalled();
  const dashboard=await core.dashboard(patient);expect(Object.keys(dashboard).sort()).toEqual(['appointments','counts','metricsAreCappedAt','notifications','tasks']);expect(dashboard.counts.appointments).toBe(1);
 });
 test('message visibility looks each conversation up once per page',async()=>{
  const thread=await core.create('conversations',{branchId:'main',title:'Desk',kind:'staff',participantIds:['reception','owner']},reception);
  for(let index=0;index<3;index++)await core.execute('conversations.send',{conversationId:thread.id,body:`Message ${index}`,idempotencyKey:`message-key-000${index}`},reception);
  const get=vi.spyOn(db,'get');expect(await core.list('messages',owner)).toHaveLength(3);expect(get.mock.calls.filter(([c])=>c==='conversations')).toHaveLength(1);
 });
});

describe('ordering, search and typed filters',()=>{
 test('descending order treats after as an exclusive upper bound',async()=>{
  const ids=(await core.list('patients',reception)).map(r=>r.id);expect(ids).toEqual([...ids].sort());
  expect((await core.list('patients',reception,{order:'desc'})).map(r=>r.id)).toEqual([...ids].reverse());
  expect((await core.list('patients',reception,{order:'desc',after:ids[1]})).map(r=>r.id)).toEqual([ids[0]]);
 });
 test('the memory adapter sorts by code unit like the databases, not by locale',async()=>{
  for(const id of ['b','B','a','_'])await raw('probe',id,{});
  expect((await db.list('probe')).map(r=>r.id)).toEqual(['B','_','a','b']);
  expect((await db.list('probe',{order:'desc',after:'a'})).map(r=>r.id)).toEqual(['_','B']);
 });
 test('q searches display fields case-insensitively within the actor scope',async()=>{
  await core.create('patients',{branchId:'branch-2',name:'Alex Elsewhere'},owner);
  expect((await core.list('patients',reception,{q:'ALEX'})).map(r=>r.name)).toEqual(['Alex Patient']);
  expect((await core.list('patients',owner,{q:'alex'})).map(r=>r.name).sort()).toEqual(['Alex Elsewhere','Alex Patient']);
  expect((await core.list('patients',reception,{q:'5550100'})).map(r=>r.id)).toEqual([patientRow.id]);
  expect(await core.list('patients',patient,{q:'robin'})).toEqual([]);
  await expect(core.list('patients',reception,{q:'x'.repeat(101)})).rejects.toMatchObject({code:'VALIDATION'});
 });
 test('query-string filters are coerced to the schema type before reaching the adapter',async()=>{
  expect(await db.list('availability',{eq:{weekday:'1'}})).toEqual([]);
  expect(await core.list('availability',reception,{eq:{weekday:'1',doctorId:'doctor'}})).toHaveLength(1);
  expect(await core.list('availability',reception,{eq:{weekday:'2'}})).toEqual([]);
  expect(await core.list('availability',reception,{eq:{public:'true'}})).toHaveLength(2);
 });
});

describe('mixed staff and patient accounts',()=>{
 test('patient membership never unlocks the staff branch path for clinical records',async()=>{
  const mixed=makeActor('front-desk-parent',['receptionist','patient'],['main'],[patientRow.id]);
  const own=await core.create('encounters',{branchId:'main',patientId:patientRow.id,doctorId:'doctor',content},doctor);await core.execute('encounters.sign',{id:own.id,expectedVersion:1},doctor);
  const other=await core.create('encounters',{branchId:'main',patientId:otherPatient.id,doctorId:'doctor',content},doctor);await core.execute('encounters.sign',{id:other.id,expectedVersion:1},doctor);
  await expect(core.get('encounters',other.id,mixed)).rejects.toMatchObject({status:404});
  expect((await core.list('encounters',mixed)).map(r=>r.id)).toEqual([own.id]);
  expect((await core.list('patients',mixed)).map(r=>r.id).sort()).toEqual([patientRow.id,otherPatient.id].sort());
  const clinicalParent=makeActor('doctor-parent',['doctor','patient'],['main'],[patientRow.id]);expect(await core.list('encounters',clinicalParent)).toHaveLength(2);
 });
});

describe('separation of duties',()=>{
 test('HR cannot create or edit their own employee record',async()=>{
  await expect(core.create('employees',{branchId:'main',userId:'hr',name:'HR',email:'hr@example.test',jobTitle:'HR',salary:{currency:'USD',base:'1000'}},hr)).rejects.toMatchObject({code:'SEPARATION_OF_DUTIES',status:403});
  const record=await core.create('employees',{branchId:'main',userId:'hr',name:'HR',email:'hr@example.test',jobTitle:'HR',salary:{currency:'USD',base:'1000'}},hr2);
  await expect(core.update('employees',record.id,{expectedVersion:1,salary:{currency:'USD',base:'9000'}},hr)).rejects.toMatchObject({code:'SEPARATION_OF_DUTIES'});
  expect((await core.update('employees',record.id,{expectedVersion:1,jobTitle:'People lead'},hr2)).jobTitle).toBe('People lead');
 });
 test('a pay run is approved by someone other than its creator',async()=>{
  const employee=await core.create('employees',{branchId:'main',userId:'doctor',name:'Doctor',email:'d@example.test',jobTitle:'Doctor',salary:{currency:'USD',base:'1000'}},hr);
  const run=await core.create('payroll',{branchId:'main',period:'2026-10',employeeIds:[employee.id]},hr);expect(run.createdBy).toBe('hr');
  await expect(core.execute('payroll.approve',{id:run.id,expectedVersion:1},hr)).rejects.toMatchObject({code:'SEPARATION_OF_DUTIES'});
  expect((await core.execute('payroll.approve',{id:run.id,expectedVersion:1},hr2)).approvedBy).toBe('hr2');
  const legacy=await raw('payroll','legacy-run',{branchId:'main',period:'2026-11',employeeIds:[employee.id],adjustments:[],status:'draft',slips:run.slips});await raw('audit','legacy-audit',{actorId:'hr',action:'payroll.created',resourceId:legacy.id});
  await expect(core.execute('payroll.approve',{id:legacy.id,expectedVersion:1},hr)).rejects.toMatchObject({code:'SEPARATION_OF_DUTIES'});
 });
 test('owners are exempt only while nobody else could approve',async()=>{
  const employee=await core.create('employees',{branchId:'main',name:'Contractor',email:'c@example.test',jobTitle:'Clinic aide',salary:{currency:'USD',base:'500'}},owner);
  const run=await core.create('payroll',{branchId:'main',period:'2026-10',employeeIds:[employee.id]},owner);
  await expect(core.execute('payroll.approve',{id:run.id,expectedVersion:1},owner)).rejects.toMatchObject({code:'SEPARATION_OF_DUTIES'});
  const solo=new MemoryDatabase(),soloCore=new ClinicService(solo),stamp=new Date().toISOString();
  for(const actor of [owner,doctor])await solo.put('users',{...actor,status:'active',version:1,createdAt:stamp,updatedAt:stamp});
  await solo.put('users',{...hr,status:'disabled',version:1,createdAt:stamp,updatedAt:stamp});
  await soloCore.create('settings',{key:'business',value:{clinicName:'Solo',country:'US',currency:'USD',timezone:'UTC',locale:'en-US',address:'1 Street',email:'solo@example.test',phone:'1'}},owner);
  const mine=await soloCore.create('employees',{branchId:'main',userId:'owner',name:'Owner',email:'o@example.test',jobTitle:'Principal',salary:{currency:'USD',base:'500'}},owner);
  const soloRun=await soloCore.create('payroll',{branchId:'main',period:'2026-10',employeeIds:[mine.id]},owner);
  expect((await soloCore.execute('payroll.approve',{id:soloRun.id,expectedVersion:1},owner)).status).toBe('approved');
 });
 test('managers cannot approve their own leave',async()=>{
  const employee=await core.create('employees',{branchId:'main',userId:'manager',name:'Manager',email:'m@example.test',jobTitle:'Manager',salary:{currency:'USD',base:'1000'}},hr);
  const leave=await core.create('leave',{branchId:'main',employeeId:employee.id,startsAt:'2026-10-20T09:00:00Z',endsAt:'2026-10-21T17:00:00Z'},manager);
  await expect(core.execute('leave.approve',{id:leave.id,expectedVersion:1,approved:true},manager)).rejects.toMatchObject({code:'SEPARATION_OF_DUTIES'});
  expect((await core.execute('leave.approve',{id:leave.id,expectedVersion:1,approved:true},hr)).decidedBy).toBe('hr');
 });
});

describe('pay run size',()=>{
 test('pay runs are capped so approval fits every database transaction',async()=>{
  await expect(core.create('payroll',{branchId:'main',period:'2026-10',employeeIds:Array.from({length:201},(_,i)=>`employee-${i}`)},hr)).rejects.toMatchObject({code:'VALIDATION',message:expect.stringContaining('Split pay runs larger than 200')});
  const oversized=await raw('payroll','oversized-run',{branchId:'main',period:'2026-12',employeeIds:Array.from({length:201},(_,i)=>`employee-${i}`),adjustments:[],status:'draft',slips:[],createdBy:'hr'});
  await expect(core.execute('payroll.approve',{id:oversized.id,expectedVersion:1},owner)).rejects.toMatchObject({code:'VALIDATION'});
 });
});

describe('pages',()=>{
 test('restoring a revision re-runs relation checks',async()=>{
  await raw('publicAssets','asset-1',{status:'published',mime:'image/png'});
  const page=await core.create('pages',{title:'Gallery',slug:'gallery',kind:'about',locale:'en',content:[{type:'image',props:{url:'/api/v1/public/assets/asset-1'},children:[]}]},editor);
  await core.update('pages',page.id,{expectedVersion:1,content},editor);
  const asset=(await db.get('publicAssets','asset-1'))!;await db.put('publicAssets',{...asset,status:'withdrawn',version:2},1);
  const first=(await core.execute('pages.revisions',{id:page.id},editor)).find((r:Entity)=>r.recordVersion===1);
  await expect(core.execute('pages.restore',{id:page.id,expectedVersion:2,revisionId:first.id},editor)).rejects.toMatchObject({code:'VALIDATION'});
  await db.put('publicAssets',{...asset,version:3},2);
  const restored=await core.execute('pages.restore',{id:page.id,expectedVersion:2,revisionId:first.id},editor);expect(restored.content[0].type).toBe('image');expect(restored.status).toBe('draft');
 });
 test('changing the assigned reviewer voids the recorded review',async()=>{
  const page=await core.create('pages',{title:'Medical advice',slug:'advice',kind:'medical',locale:'en',content,reviewedBy:'doctor'},editor);
  await core.execute('pages.review',{id:page.id,expectedVersion:1},doctor);
  const reassigned=await core.update('pages',page.id,{expectedVersion:2,reviewedBy:'doctor2'},editor);
  for(const field of ['reviewerName','reviewedAt','reviewedContentHash'])expect(reassigned).not.toHaveProperty(field);
  await expect(core.execute('pages.publish',{id:page.id,expectedVersion:3},editor)).rejects.toMatchObject({code:'VALIDATION'});
  await core.execute('pages.review',{id:page.id,expectedVersion:3},doctor2);
  const cleared=await core.update('pages',page.id,{expectedVersion:4,reviewedBy:null},editor);expect(cleared).not.toHaveProperty('reviewedBy');expect(cleared).not.toHaveProperty('reviewerName');
 });
 test('review hashes are canonical and earlier hashes still verify',async()=>{
  const page=await core.create('pages',{title:'Advice',slug:'advice',kind:'medical',locale:'en',content},editor);
  const reviewed=await core.execute('pages.review',{id:page.id,expectedVersion:1},doctor);
  // Simulate JSONB/MySQL key reordering of the stored content.
  const reversed=JSON.parse(JSON.stringify(reviewed.content,(_key,value)=>value&&typeof value==='object'&&!Array.isArray(value)?Object.fromEntries(Object.entries(value).reverse()):value));
  await db.put('pages',{...reviewed,content:reversed,version:3},2);
  expect((await core.execute('pages.publish',{id:page.id,expectedVersion:3},editor)).publishedSnapshot.reviewer).toEqual({name:'doctor'});
  const legacy=await core.create('pages',{title:'Legacy',slug:'legacy',kind:'medical',locale:'en',content},editor);const row=(await db.get('pages',legacy.id))!;
  await db.put('pages',{...row,reviewedBy:'doctor',reviewerName:'doctor',reviewedAt:new Date().toISOString(),reviewedContentHash:legacyHash({title:row.title,content:row.content,citations:[]}),version:2},1);
  expect((await core.execute('pages.publish',{id:legacy.id,expectedVersion:2},editor)).status).toBe('published');
 });
 test('page slugs cannot claim application routes',async()=>{
  for(const slug of ['api','workspace/patients','tools','booking','portal/x','sitemaps','fonts','opengraph-image'])await expect(core.create('pages',{title:'Clash',slug,kind:'about',locale:'en',content},editor),slug).rejects.toMatchObject({code:'VALIDATION'});
  await expect(core.create('pages',{title:'Clash',slug:'ok',kind:'about',locale:'en',content,seo:{translations:[{locale:'hi',slug:'login'}]}},editor)).rejects.toMatchObject({code:'VALIDATION'});
  expect((await core.create('pages',{title:'Services',slug:'services/apis',kind:'service',locale:'en',content},editor)).slug).toBe('services/apis');
 });
});

describe('lifecycle guards',()=>{
 test('finished results cannot be reassigned; open ones can',async()=>{
  const result=await core.create('results',{branchId:'main',patientId:patientRow.id,title:'Lab',reviewerId:'doctor'},nurse);
  const moved=await core.execute('results.reassign',{id:result.id,expectedVersion:1,reviewerId:'doctor2'},nurse);
  await core.execute('results.review',{id:result.id,expectedVersion:moved.version,summary:'Normal',actionRequired:false},doctor2);
  await core.execute('results.release',{id:result.id,expectedVersion:moved.version+1},doctor2);
  await expect(core.execute('results.reassign',{id:result.id,expectedVersion:moved.version+2,reviewerId:'doctor'},nurse)).rejects.toMatchObject({code:'STATE'});
 });
 test('results release only clean clinical uploads for the same patient',async()=>{
  const file=(id:string,scope:string)=>raw('files',id,{storageKey:id,originalName:`${id}.pdf`,mime:'application/pdf',size:1,sha256:'0'.repeat(64),visibility:'private',scanStatus:'clean',ownerId:'nurse',patientId:patientRow.id,scope,branchId:'main'});
  await file('chat-file','conversation');await file('lab-file','clinical');
  for(const [fileId,outcome] of [['chat-file','VALIDATION'],['lab-file',undefined]] as const){
   const result=await core.create('results',{branchId:'main',patientId:patientRow.id,title:'Lab',reviewerId:'doctor',fileId},nurse);
   const reviewed=await core.execute('results.review',{id:result.id,expectedVersion:1,summary:'Normal',actionRequired:false},doctor);
   const release=core.execute('results.release',{id:result.id,expectedVersion:reviewed.version},doctor);
   if(outcome)await expect(release).rejects.toMatchObject({code:outcome});else await expect(release).resolves.toMatchObject({released:true});
  }
  expect((await db.get('files','chat-file'))?.released).toBeUndefined();expect((await db.get('files','lab-file'))?.released).toBe(true);
 });
 test('referrals release once, by the assigned clinician',async()=>{
  const referral=await core.create('referrals',{branchId:'main',patientId:patientRow.id,destination:'Specialist',reason:'Opinion',assignedTo:'doctor2'},doctor);
  await expect(core.execute('referrals.release',{id:referral.id,expectedVersion:1},doctor)).rejects.toMatchObject({code:'FORBIDDEN'});
  const released=await core.execute('referrals.release',{id:referral.id,expectedVersion:1},doctor2);
  await expect(core.execute('referrals.release',{id:referral.id,expectedVersion:released.version},doctor2)).rejects.toMatchObject({code:'STATE'});
  expect((await core.get('referrals',referral.id,doctor2)).releasedAt).toBe(released.releasedAt);
 });
 test('a template version publishes once',async()=>{
  const template=await core.create('templates',{name:'Invoice',kind:'invoice',design:{accent:'#126b5e',font:'system',showLogo:true,columns:['description','total']}},accountant);
  const published=await core.execute('templates.publish',{id:template.id,expectedVersion:1},accountant);
  await expect(core.execute('templates.publish',{id:template.id,expectedVersion:published.version},accountant)).rejects.toMatchObject({code:'STATE'});
 });
});

describe('money',()=>{
 test('payment replay returns the original payment after the invoice is credited',async()=>{
  const invoice=await issued();const input={invoiceId:invoice.id,amount:'40.00',method:'cash',idempotencyKey:'payment-key-0001'};
  const payment=await core.execute('payments.record',input,accountant);
  await core.execute('invoices.credit',{invoiceId:invoice.id,amount:'59.00',reason:'Courtesy',idempotencyKey:'credit-key-0001'},accountant);
  expect((await core.get('invoices',invoice.id,accountant)).status).toBe('credited');
  expect((await core.execute('payments.record',input,accountant)).id).toBe(payment.id);
  await expect(core.execute('payments.record',{...input,idempotencyKey:'payment-key-0002'},accountant)).rejects.toMatchObject({code:'STATE'});
 });
 test('idempotency hashes stored before canonical serialization still match',async()=>{
  const invoice=await issued();const input={invoiceId:invoice.id,amount:'10.00',method:'cash' as const,idempotencyKey:'payment-key-0003'};
  const payment=await core.execute('payments.record',input,accountant);const stored=(await db.get('payments',payment.id))!;
  await db.put('payments',{...stored,requestHash:legacyHash(input),version:2},1);
  expect((await core.execute('payments.record',input,accountant)).id).toBe(payment.id);
 });
 test('excess precision is rejected for service prices, as for invoices',async()=>{
  const service={branchId:'main',name:'Visit',price:'10.005',currency:'USD',durationMinutes:30};
  await expect(core.create('services',service,accountant)).rejects.toMatchObject({code:'MONEY'});
  expect((await core.create('services',{...service,price:'10.5'},accountant)).price).toBe('10.50');
  await expect(core.create('services',{...service,price:'10.5',currency:'JPY'},accountant)).rejects.toMatchObject({code:'MONEY'});
 });
 test('invoice totals keep full precision beyond twenty significant digits',async()=>{
  const quantity='999999.999999',unitPrice='99999999999.99';const product=999999999999n*9999999999999n;const cents=(product+500000n)/1000000n;
  const expected=`${cents/100n}.${String(cents%100n).padStart(2,'0')}`;
  const draft=await core.create('invoices',{branchId:'main',patientId:patientRow.id,currency:'USD',lines:[{description:'Bulk',quantity,unitPrice}]},accountant);
  expect(draft.total).toBe(expected);
 });
});

describe('input safety',()=>{
 test('executable block properties are rejected in any letter case',async()=>{
  for(const key of ['onClick','ONCLICK','onmouseover','dangerouslySetInnerHTML','style','srcset','srcDoc','innerHtml'])await expect(core.create('pages',{title:'X',slug:'x',kind:'about',locale:'en',content:[{type:'paragraph',props:{[key]:'alert(1)'},content:[],children:[]}]},editor),key).rejects.toMatchObject({code:'VALIDATION'});
  expect((await core.create('pages',{title:'Styled',slug:'styled',kind:'about',locale:'en',content:[{type:'paragraph',props:{},content:[{type:'text',text:'Bold',styles:{bold:true}}],children:[]}]},editor)).slug).toBe('styled');
 });
 test('NUL characters are a validation error before storage',async()=>{
  await expect(core.create('patients',{branchId:'main',name:'Bad\u0000Name'},reception)).rejects.toMatchObject({code:'VALIDATION',status:400});
  await expect(core.create('pages',{title:'X',slug:'x',kind:'about',locale:'en',content:[{type:'paragraph',props:{'key\u0000':'v'},content:[],children:[]}]},editor)).rejects.toMatchObject({code:'VALIDATION'});
  await expect(raw('probe','nul',{nested:{text:'a\u0000'}})).rejects.toMatchObject({code:'VALIDATION'});
 });
 test('HTTPS links in domain records reject embedded credentials',async()=>{
  await expect(core.create('pages',{title:'X',slug:'x',kind:'article',locale:'en',content,citations:[{title:'Source',url:'https://user:secret@example.com/a'}]},editor)).rejects.toMatchObject({code:'VALIDATION'});
  await expect(core.create('pages',{title:'X',slug:'x',kind:'article',locale:'en',content,seo:{canonical:'https://example.com/a b'}},editor)).rejects.toMatchObject({code:'VALIDATION'});
  expect((await core.create('pages',{title:'X',slug:'x',kind:'article',locale:'en',content,citations:[{title:'Source',url:'https://example.com/a'}]},editor)).citations).toHaveLength(1);
 });
});

describe('booking integrity',()=>{
 const slot=(startsAt:string,endsAt:string,doctorId='doctor',kind?:string)=>({branchId:'main',patientId:patientRow.id,doctorId,startsAt,endsAt,...(kind?{kind}:{})});
 test('starts in the past are rejected except recently started staff walk-ins',async()=>{
  vi.setSystemTime(new Date('2026-10-05T10:30:00Z'));
  await expect(core.create('appointments',slot('2026-10-05T10:00:00Z','2026-10-05T10:20:00Z'),reception)).rejects.toMatchObject({code:'START_IN_PAST'});
  await expect(core.create('appointments',slot('2026-10-05T10:00:00Z','2026-10-05T10:20:00Z','doctor','walk-in'),patient)).rejects.toMatchObject({code:'START_IN_PAST'});
  expect((await core.create('appointments',slot('2026-10-05T10:00:00Z','2026-10-05T10:20:00Z','doctor','walk-in'),reception)).status).toBe('booked');
  await expect(core.create('appointments',slot('2026-10-05T09:00:00Z','2026-10-05T09:20:00Z','doctor2','walk-in'),reception)).rejects.toMatchObject({code:'START_IN_PAST'});
  expect((await core.create('appointments',slot('2026-10-05T10:32:00Z','2026-10-05T10:50:00Z','doctor2'),patient)).status).toBe('booked');
 });
 test('a patient cannot hold overlapping appointments with different doctors',async()=>{
  const first=await core.create('appointments',slot('2026-10-05T11:00:00Z','2026-10-05T11:30:00Z'),reception);
  await expect(core.create('appointments',slot('2026-10-05T11:15:00Z','2026-10-05T11:45:00Z','doctor2'),reception)).rejects.toMatchObject({code:'PATIENT_BOOKED',status:409});
  await core.create('appointments',slot('2026-10-05T11:30:00Z','2026-10-05T12:00:00Z','doctor2'),reception);
  await core.execute('appointments.status',{id:first.id,expectedVersion:1,status:'cancelled'},reception);
  expect((await core.create('appointments',slot('2026-10-05T11:00:00Z','2026-10-05T11:15:00Z','doctor2'),reception)).status).toBe('booked');
 });
});

describe('null clears optional fields on update',()=>{
 test('null removes optional fields, restores defaults and fails for required fields',async()=>{
  const updated=await core.update('patients',patientRow.id,{expectedVersion:1,email:null,allergies:null},reception);
  expect(updated).not.toHaveProperty('email');expect(updated.allergies).toEqual([]);expect((await db.get('patients',patientRow.id))).not.toHaveProperty('email');
  await expect(core.update('patients',patientRow.id,{expectedVersion:2,name:null},reception)).rejects.toMatchObject({code:'VALIDATION'});
  await expect(core.update('patients',patientRow.id,{expectedVersion:2,unknownField:null},reception)).rejects.toMatchObject({code:'VALIDATION'});
  const task=await core.create('tasks',{branchId:'main',title:'Follow up',assignedTo:'nurse'},reception);
  expect(await core.update('tasks',task.id,{expectedVersion:1,patientId:null,dueAt:null},manager)).not.toHaveProperty('patientId');
  const linked=await core.create('tasks',{branchId:'main',title:'Linked',assignedTo:'nurse',patientId:patientRow.id},reception);
  await expect(core.update('tasks',linked.id,{expectedVersion:1,patientId:null},manager)).rejects.toMatchObject({code:'IMMUTABLE'});
 });
});

describe('notification preferences',()=>{
 test('are read back only by their owner',async()=>{
  expect(await core.notificationPreferences(nurse)).toBeNull();
  const saved={categories:['clinical','messages'],email:false,inApp:true,quietStart:'21:00',quietEnd:'07:00',timezone:'Europe/London'};
  await core.execute('notifications.preferences',saved,nurse);
  expect(await core.notificationPreferences(nurse)).toEqual(saved);
  expect(await core.notificationPreferences(doctor)).toBeNull();
 });
});
