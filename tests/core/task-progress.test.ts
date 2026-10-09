/* Author: ramanpal singh | URL: https://kwebby.com */
import { beforeEach, describe, expect, test } from 'vitest';
import { ClinicService } from '../../packages/core/src/index.js';
import type { Actor, Entity } from '../../packages/contracts/src/index.js';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';

type TaskStatus = 'open' | 'in-progress' | 'blocked' | 'completed';
const actor = (id:string, roles:Actor['roles'], branchIds=['main']):Actor => ({id,organizationId:'clinic',name:id,email:`${id}@example.test`,roles,branchIds,patientIds:[]});
const owner=actor('owner',['owner']);
const admin=actor('admin',['admin']);
const manager=actor('manager',['manager']);
const employee=actor('employee',['employee']);
const doctor=actor('doctor',['doctor']);
const otherDoctor=actor('other-doctor',['doctor']);
const elsewhere=actor('elsewhere',['manager'],['other']);
let db:MemoryDatabase;
let core:ClinicService;
let patient:Entity;

beforeEach(async()=>{
 db=new MemoryDatabase();core=new ClinicService(db);
 const stamp=new Date().toISOString();
 for(const user of [owner,admin,manager,employee,doctor,otherDoctor,elsewhere])await db.put('users',{...user,status:'active',version:1,createdAt:stamp,updatedAt:stamp});
 patient=await core.create('patients',{branchId:'main',name:'Example patient'},owner);
});

const task=()=>core.create('tasks',{branchId:'main',title:'Call about appointment',assignedTo:employee.id,patientId:patient.id},manager);
const move=(row:Entity,status:TaskStatus,who=employee,note?:string)=>core.execute('tasks.status',{id:row.id,expectedVersion:row.version,status,...(note===undefined?{}:{note})},who);

describe('task progress lifecycle',()=>{
 test('supports every allowed Kanban transition with versioning and atomic audit',async()=>{
  const allowed:Record<TaskStatus,TaskStatus[]>={open:['in-progress','blocked','completed'],'in-progress':['open','blocked','completed'],blocked:['open','in-progress','completed'],completed:['open']};
  for(const [from,destinations] of Object.entries(allowed))for(const to of destinations){
   let row=await task();if(from!=='open')row=await move(row,from as TaskStatus);
   const next=await move(row,to,employee,'Progress recorded');
   expect(next).toMatchObject({status:to,version:row.version+1,statusNote:'Progress recorded',statusChangedBy:employee.id});
   expect(Number.isFinite(Date.parse(next.statusChangedAt))).toBe(true);
   expect((await db.list('audit')).filter(entry=>entry.resourceId===row.id&&entry.resourceVersion===next.version)).toEqual([expect.objectContaining({action:'tasks.transition',actorId:employee.id,branchId:'main'})]);
  }
 });

 test('rejects no-op moves and completed-to-active shortcuts without changing the task or audit',async()=>{
  const open=await task();await expect(move(open,'open')).rejects.toMatchObject({code:'STATE',status:409});
  const completed=await move(open,'completed');
  for(const status of ['in-progress','blocked','completed'] as const)await expect(move(completed,status)).rejects.toMatchObject({code:'STATE',status:409});
  expect((await core.get('tasks',open.id,employee)).version).toBe(2);
  expect((await db.list('audit')).filter(entry=>entry.resourceId===open.id)).toHaveLength(2);
 });

 test('records completion metadata, clears it on reopen and replaces it on a later completion',async()=>{
  const completed=await move(await task(),'completed',employee,'Called patient');
  expect(completed).toMatchObject({completedBy:employee.id,completionNote:'Called patient',completedAt:completed.statusChangedAt});
  const reopened=await move(completed,'open',manager,'Further callback needed');
  expect(reopened).toMatchObject({status:'open',statusNote:'Further callback needed',statusChangedBy:manager.id});
  for(const field of ['completionNote','completedAt','completedBy'])expect(reopened).not.toHaveProperty(field);
  const finished=await move(reopened,'completed',manager);
  expect(finished).toMatchObject({completedBy:manager.id,completionNote:'',statusNote:''});
 });

 test('keeps tasks.complete compatible from all unfinished stages and rejects repeats',async()=>{
  for(const status of ['open','in-progress','blocked'] as const){
   let row=await task();if(status!=='open')row=await move(row,status);
   const completed=await core.execute('tasks.complete',{id:row.id,expectedVersion:row.version,note:'Done'},employee);
   expect(completed).toMatchObject({status:'completed',completionNote:'Done',completedBy:employee.id,version:row.version+1});
   await expect(core.execute('tasks.complete',{id:row.id,expectedVersion:completed.version},employee)).rejects.toMatchObject({code:'STATE',status:409});
  }
 });

 test('accepts only one competing change and leaves no audit entry for the stale version',async()=>{
  const row=await task();
  const results=await Promise.allSettled([move(row,'in-progress'),move(row,'blocked')]);
  expect(results.filter(result=>result.status==='fulfilled')).toHaveLength(1);
  expect(results.find(result=>result.status==='rejected')).toMatchObject({reason:{code:'CONFLICT',status:409}});
  const updated=await core.get('tasks',row.id,employee);
  expect(updated.version).toBe(2);
  await expect(move(row,'completed')).rejects.toMatchObject({code:'CONFLICT',status:409});
  expect((await db.list('audit')).filter(entry=>entry.resourceId===row.id&&entry.action==='tasks.transition')).toHaveLength(1);
 });

 test('strictly validates status, version and allowed fields, including the compatibility action',async()=>{
  const row=await task();
  for(const patch of [{status:'queued'},{status:'completed',expectedVersion:0},{status:'completed',completedBy:manager.id},{status:'completed',note:5}]){
   await expect(core.execute('tasks.status',{id:row.id,expectedVersion:row.version,...patch},employee)).rejects.toMatchObject({code:'VALIDATION',status:400});
  }
  await expect(core.execute('tasks.complete',{id:row.id,expectedVersion:row.version,status:'completed'},employee)).rejects.toMatchObject({code:'VALIDATION'});
  await expect(core.update('tasks',row.id,{expectedVersion:row.version,status:'completed'},manager)).rejects.toMatchObject({code:'VALIDATION'});
 });
});

describe('task progress authorization',()=>{
 test('permits assignees and visible-task administrators but prevents other staff from changing progress',async()=>{
  const row=await task();
  await expect(move(row,'in-progress',doctor)).rejects.toMatchObject({code:'FORBIDDEN',status:403});
  for(const who of [owner,admin,manager,employee]){
   const own=await task();expect(await move(own,'blocked',who)).toMatchObject({status:'blocked',statusChangedBy:who.id});
  }
 });

 test('does not disclose or mutate tasks in an unauthorized branch or organization',async()=>{
  const row=await task();
  await expect(move(row,'blocked',elsewhere)).rejects.toMatchObject({code:'NOT_FOUND',status:404});
  await expect(move(row,'blocked',{...employee,branchIds:['other']})).rejects.toMatchObject({code:'NOT_FOUND',status:404});
  await expect(move(row,'blocked',{...owner,organizationId:'other-clinic'})).rejects.toMatchObject({code:'NOT_FOUND',status:404});
  expect((await core.get('tasks',row.id,employee)).version).toBe(1);
 });

 test('retains clinical task visibility and excludes patient accounts even when explicitly linked',async()=>{
  const row=await core.create('tasks',{branchId:'main',title:'Clinical follow-up',assignedTo:doctor.id,patientId:patient.id,category:'clinical'},doctor);
  for(const who of [owner,admin,manager])await expect(move(row,'completed',who)).rejects.toMatchObject({code:'NOT_FOUND',status:404});
  await expect(move(row,'completed',otherDoctor)).rejects.toMatchObject({code:'FORBIDDEN',status:403});
  const patientActor={...actor('patient',['patient'],[]),patientIds:[patient.id]};
  await expect(move(row,'completed',patientActor)).rejects.toMatchObject({code:'FORBIDDEN',status:403});
  expect(await core.list('tasks',patientActor)).toEqual([]);
  expect(await move(row,'in-progress',doctor)).toMatchObject({status:'in-progress'});
 });
});
