/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import { OutboxProcessor } from '../../apps/worker/src/processor.js';
import { ClinicScheduler,hasReminderConsent } from '../../apps/worker/src/scheduler.js';
import { deliveryPreferences,nextDeliveryTime } from '../../apps/worker/src/preferences.js';
import { entity } from '../../packages/platform/src/common.js';
const now='2026-10-09T23:00:00.000Z';
function user(id='staff',roles=['receptionist']){return entity('clinic',{name:id,email:`${id}@example.test`,emailVerified:true,status:'active',roles,branchIds:['main'],patientIds:[],mfaEnabled:true,sessionVersion:1,passwordHash:'synthetic'},id);}
function event(id:string,type:string,payload:Record<string,unknown>,extra:Record<string,unknown>={}){return entity('clinic',{type,payload,status:'pending',attempts:0,nextAttemptAt:now,...extra},id);}
function providers(){return {config:vi.fn(async()=>({host:'smtp.example.test'})),sendMail:vi.fn(async()=>({accepted:true,messageId:'accepted'}))};}
function redis(){return {publish:vi.fn(async()=>1)};}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date(now));vi.stubEnv('OUTBOUND_WORKERS_ENABLED','true');vi.stubEnv('PUBLIC_URL','https://clinic.example');});
afterEach(()=>{vi.useRealTimers();vi.unstubAllEnvs();});
async function taskAndStaff(db:MemoryDatabase){await db.put('users',user());await db.put('tasks',entity('clinic',{assignedTo:'staff',branchId:'main',category:'administrative',status:'open',dueAt:'2026-10-09T20:00:00Z'},'task'));}

describe('outbox delivery and recovery',()=>{
 it('recovers an expired processing lease and emits one durable notice across retries',async()=>{
  const db=new MemoryDatabase();await taskAndStaff(db);await db.put('outbox',event('notification','notification.requested',{userId:'staff',category:'operations',title:'Assigned task',resourceId:'task'},{status:'processing',attempts:1,leaseUntil:'2026-10-09T22:00:00Z'}));
  const transport=redis(),worker=new OutboxProcessor(db,providers() as any,transport as any);await Promise.all([worker.process('notification'),worker.process('notification')]);await worker.process('notification');
  expect((await db.get('outbox','notification'))?.status).toBe('completed');expect(await db.list('notifications')).toHaveLength(1);expect(await db.list('notificationDeliveries')).toHaveLength(1);expect(transport.publish).toHaveBeenCalledTimes(1);
 });
 it('honors category and in-app preferences while scheduling verified-email notices',async()=>{
  const db=new MemoryDatabase();await taskAndStaff(db);await db.put('preferences',entity('clinic',{userId:'staff',value:{categories:['operations'],email:true,inApp:false,timezone:'UTC'}},'notification-staff'));
  await db.put('outbox',event('notification','notification.requested',{userId:'staff',category:'operations',title:'Assigned task',resourceId:'task'}));await db.put('outbox',event('excluded','notification.requested',{userId:'staff',category:'clinical',title:'Clinical update',resourceId:'task'}));
  const worker=new OutboxProcessor(db,providers() as any,redis() as any);await worker.process('notification');await worker.process('excluded');expect(await db.list('notifications')).toHaveLength(0);expect((await db.list('outbox')).filter(row=>row.type==='email.send')).toHaveLength(1);
 });
 it('defers quiet-hours notices without using a retry attempt and delivers after the window',async()=>{
  const db=new MemoryDatabase();await taskAndStaff(db);await db.put('preferences',entity('clinic',{value:{categories:['operations'],email:false,inApp:true,quietStart:'22:00',quietEnd:'07:00',timezone:'UTC'}},'notification-staff'));await db.put('outbox',event('quiet','notification.requested',{userId:'staff',category:'operations',title:'Task',resourceId:'task'}));
  const worker=new OutboxProcessor(db,providers() as any,redis() as any);await worker.process('quiet');expect(await db.list('notifications')).toHaveLength(0);expect((await db.get('outbox','quiet'))?.nextAttemptAt).toBe('2026-10-10T07:00:00.000Z');expect((await db.get('outbox','quiet'))?.attempts).toBe(0);
  vi.setSystemTime(new Date('2026-10-10T07:00:01Z'));await worker.process('quiet');expect(await db.list('notifications')).toHaveLength(1);
 });
 it('does not resend an email with ambiguous SMTP acceptance after a worker retry',async()=>{
  const db=new MemoryDatabase(),integration=providers();integration.sendMail.mockRejectedValue(new Error('Connection closed after DATA'));await db.put('outbox',event('email','email.send',{to:'staff@example.test',template:'verify-email',data:{url:'https://clinic.example/verify-email?token=synthetic'}}));
  const worker=new OutboxProcessor(db,integration as any,redis() as any);await expect(worker.process('email')).rejects.toThrow();expect((await db.get('mailDeliveries','mail-email'))?.status).toBe('acceptance-unknown');vi.setSystemTime(new Date('2026-10-10T00:00:00Z'));await expect(worker.process('email')).rejects.toMatchObject({code:'SMTP_UNCERTAIN'});expect(integration.sendMail).toHaveBeenCalledTimes(1);
 });
 it('keeps accepted email durable so a crash before outbox completion cannot duplicate it',async()=>{
  const db=new MemoryDatabase(),integration=providers();await db.put('outbox',event('email','email.send',{to:'staff@example.test',template:'verify-email',data:{url:'https://clinic.example/verify-email?token=synthetic'}}));await db.put('mailDeliveries',entity('clinic',{status:'smtp-accepted',outboxId:'email'},'mail-email'));await new OutboxProcessor(db,integration as any,redis() as any).process('email');expect(integration.sendMail).not.toHaveBeenCalled();expect((await db.get('outbox','email'))?.status).toBe('completed');
 });
 it('suppresses notifications after source access is revoked and all work during restore',async()=>{
  const db=new MemoryDatabase();await taskAndStaff(db);const staff=(await db.get('users','staff'))!;await db.put('users',{...staff,branchIds:['elsewhere'],version:2},1);await db.put('outbox',event('denied','notification.requested',{userId:'staff',category:'operations',title:'Private task',resourceId:'task'}));const worker=new OutboxProcessor(db,providers() as any,redis() as any);await worker.process('denied');expect(await db.list('notifications')).toHaveLength(0);vi.stubEnv('OUTBOUND_WORKERS_ENABLED','false');await db.put('outbox',event('paused','email.send',{to:'staff@example.test'}));await worker.process('paused');expect((await db.get('outbox','paused'))?.status).toBe('pending');
 });
 it('resolves overnight quiet hours in local timezone',()=>{const pref=deliveryPreferences({quietStart:'22:00',quietEnd:'07:00',timezone:'Asia/Kolkata'},{});expect(nextDeliveryTime(new Date('2026-10-09T18:00:00Z'),pref).toISOString()).toBe('2026-10-10T01:30:00.000Z');});
});

describe('consented reminders and escalation',()=>{
 it('schedules two reminders exactly once, requires explicit consent, and cancels delivery after rescheduling',async()=>{
  const db=new MemoryDatabase();await db.put('users',{...user('patient',['patient']),patientIds:['person']});await db.put('appointments',entity('clinic',{patientId:'person',doctorId:'doctor',branchId:'main',status:'booked',startsAt:'2026-10-10T23:00:00.000Z',endsAt:'2026-10-10T23:15:00.000Z'},'appointment'));
  const scheduler=new ClinicScheduler(db,'clinic');expect((await scheduler.tick()).reminders).toBe(0);
  await db.put('consents',entity('clinic',{patientId:'person',purpose:'reminders',granted:true},'consent'));
  expect((await scheduler.tick()).reminders).toBe(2);expect((await scheduler.tick()).reminders).toBe(0);
  const reminder=(await db.list('outbox')).find(row=>row.nextAttemptAt===now)!;
  const appointment=(await db.get('appointments','appointment'))!;await db.put('appointments',{...appointment,startsAt:'2026-10-11T23:00:00.000Z',version:2},1);
  await new OutboxProcessor(db,providers() as any,redis() as any).process(reminder.id);expect(await db.list('notifications')).toHaveLength(0);
 });
 it('rechecks consent revocation at delivery and escalates only outstanding tasks/results',async()=>{
  const db=new MemoryDatabase();await taskAndStaff(db);await db.put('users',user('reviewer',['doctor']));await db.put('users',user('cover',['doctor']));await db.put('results',entity('clinic',{patientId:'person',branchId:'main',reviewerId:'reviewer',coveringReviewerId:'cover',reviewState:'pending',contactState:'pending',actionState:'pending-review',dueAt:'2026-10-09T20:00:00Z'},'result'));
  const scheduler=new ClinicScheduler(db,'clinic');expect((await scheduler.tick()).escalations).toBe(3);expect((await scheduler.tick()).escalations).toBe(0);
  const rows=await db.list('outbox');const result=(await db.get('results','result'))!;await db.put('results',{...result,reviewState:'reviewed',contactState:'communicated',actionState:'not-required',version:2},1);
  const worker=new OutboxProcessor(db,providers() as any,redis() as any);for(const row of rows)await worker.process(row.id);expect(await db.list('notifications')).toHaveLength(1);
  await db.put('consents',entity('clinic',{patientId:'person',purpose:'reminders',granted:true},'yes'));vi.setSystemTime(new Date('2026-10-09T23:01:00Z'));await db.put('consents',entity('clinic',{patientId:'person',purpose:'reminders',granted:false},'no'));expect(await hasReminderConsent(db,'clinic','person')).toBe(false);
 });
});
