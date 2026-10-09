/* Author: ramanpal singh | URL: https://kwebby.com */
import { createHash } from 'node:crypto';
import type { Database, Entity, FilterValue } from '../../../packages/contracts/src/index.js';
import { entity, type User } from '../../api/src/auth.js';
import { listAll } from '../../api/src/paging.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
/** Deterministic id that still sorts by time: UUIDv7 layout with `ms` as the timestamp and the remaining bits taken from `key`. */
export function keyedId(ms:number,key:string):string{
 const h=createHash('sha256').update(key).digest('hex'),t=Math.max(0,Number.isFinite(ms)?Math.floor(ms):0).toString(16).padStart(12,'0').slice(-12);
 return `${t.slice(0,8)}-${t.slice(8,12)}-7${h.slice(0,3)}-${(8|(parseInt(h[3],16)&3)).toString(16)}${h.slice(4,7)}-${h.slice(7,19)}`;
}
/** Reads a filtered collection in bounded slices. The cursor carries over between calls, so a large backlog is covered over several calls instead of failing. */
export class CursorScan {
 private cursors=new Map<string,string>();
 constructor(private readonly db:Database,private readonly budget=2000,private readonly page=500){}
 async next<T extends Entity=Entity>(collection:string,eq:Record<string,FilterValue>):Promise<T[]>{
  const key=`${collection}:${JSON.stringify(eq)}`,rows:T[]=[];let after=this.cursors.get(key);
  while(rows.length<this.budget){const size=Math.min(this.page,this.budget-rows.length),batch=await this.db.list<T>(collection,{eq,limit:size,...(after?{after}:{})});rows.push(...batch);if(batch.length<size){this.cursors.delete(key);return rows;}after=batch[batch.length-1].id;}
  this.cursors.set(key,after!);return rows;
 }
}
const openTaskStatuses=['open','in-progress','blocked'];
/** Together these cover every outstanding result (see outstandingResult): review precedes communication, so unreviewed results still have contactState pending. */
const outstandingResultFilters:Record<string,string>[]=[{contactState:'pending'},{contactState:'attempted'},{actionState:'required'}];
/** Every matching row, paged; never silently capped. */
export async function allRecords<T extends Entity=Entity>(db:Database,collection:string,eq:Record<string,string|boolean>):Promise<T[]> {return listAll<T>(db,collection,eq);}
export async function hasReminderConsent(db:Database,organizationId:string,patientId:string):Promise<boolean>{
 const rows=await allRecords(db,'consents',{organizationId,patientId,purpose:'reminders'});
 const latest=rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)||b.updatedAt.localeCompare(a.updatedAt)||Number(a.granted)-Number(b.granted))[0];return latest?.granted===true;
}
export function outstandingResult(row:Entity):boolean{return row.reviewState!=='reviewed'||row.contactState!=='communicated'||!['completed','not-required'].includes(String(row.actionState));}
export async function notificationConditionApplies(db:Database,user:User,condition:unknown):Promise<boolean>{
 if(!condition)return true;
 const value=condition as Record<string,unknown>;
 if(value.kind==='reminder'){
  const appointment=await db.get('appointments',String(value.id));return !!appointment&&appointment.organizationId===user.organizationId&&appointment.status==='booked'&&appointment.startsAt===value.startsAt&&Date.parse(String(appointment.startsAt))>Date.now()&&user.patientIds.includes(String(appointment.patientId))&&await hasReminderConsent(db,user.organizationId,String(appointment.patientId));
 }
 if(value.kind==='overdue-task'){
  const task=await db.get('tasks',String(value.id));return !!task&&task.organizationId===user.organizationId&&task.status!=='completed'&&task.dueAt===value.dueAt&&Date.parse(String(task.dueAt))<=Date.now();
 }
 if(value.kind==='overdue-result'){
  const result=await db.get('results',String(value.id));return !!result&&result.organizationId===user.organizationId&&outstandingResult(result)&&result.dueAt===value.dueAt&&Date.parse(String(result.dueAt))<=Date.now();
 }
 return false;
}
export class ClinicScheduler {
 private readonly scan:CursorScan;
 constructor(private readonly db:Database,private readonly organizationId:string,budget=2000){this.scan=new CursorScan(db,budget);}
 private async queue(at:number,keyParts:unknown[],userId:string,category:string,title:string,resourceId:string,nextAttempt:Date,condition:Record<string,unknown>){
  // Rows written before time-ordered ids keep deduplicating under their original id.
  const legacy=`scheduled-${hash([this.organizationId,...keyParts,userId])}`,id=keyedId(at,legacy);
  if(await this.db.get('outbox',id)||await this.db.get('outbox',legacy))return false;
  return this.db.transaction([`scheduled:${legacy}`],async tx=>{if(await tx.get('outbox',id)||await tx.get('outbox',legacy))return false;await tx.put('outbox',{...entity(this.organizationId,id),type:'notification.requested',status:'pending',payload:{userId,category,title,resourceId,condition},attempts:0,nextAttemptAt:nextAttempt.toISOString()});return true;});
 }
 /** One bounded slice per collection per tick; only booked appointments, open tasks and outstanding results are read. */
 async tick(now=new Date()):Promise<{reminders:number;escalations:number}>{
  if(process.env.OUTBOUND_WORKERS_ENABLED!=='true')return {reminders:0,escalations:0};
  const org=this.organizationId,unique=<T extends Entity>(lists:T[][])=>[...new Map(lists.flat().map(row=>[row.id,row])).values()];
  const appointments=await this.scan.next('appointments',{organizationId:org,status:'booked'});
  const tasks=unique(await Promise.all(openTaskStatuses.map(status=>this.scan.next('tasks',{organizationId:org,status}))));
  const results=unique(await Promise.all(outstandingResultFilters.map(filter=>this.scan.next('results',{organizationId:org,...filter}))));
  let users:User[]|undefined;const activeUsers=async()=>users??=await allRecords<User>(this.db,'users',{organizationId:org,status:'active'});
  const configuration=(await this.db.get('settings','notifications'))?.value as {escalationMinutes?:number}|undefined;
  const escalation=Math.min(10080,Math.max(5,Number(configuration?.escalationMinutes??60)))*60000;
  let reminders=0,escalations=0;
  for(const appointment of appointments){
   const start=Date.parse(String(appointment.startsAt)),until=start-now.getTime();if(until<=5*60000||until>25*3600000||!await hasReminderConsent(this.db,org,String(appointment.patientId)))continue;
   const recipients=(await activeUsers()).filter(user=>user.roles.every(role=>role==='patient')&&user.emailVerified&&user.patientIds.includes(String(appointment.patientId)));
   const offsets=until>2*3600000+5*60000?[24,2]:[2];
   for(const hours of offsets)for(const user of recipients){if(await this.queue(start-25*3600000,['reminder',appointment.id,appointment.startsAt,hours],user.id,'appointments','You have an upcoming appointment',appointment.id,new Date(Math.max(now.getTime(),start-hours*3600000)),{kind:'reminder',id:appointment.id,startsAt:appointment.startsAt}))reminders++;}
  }
  for(const task of tasks){
   const due=Date.parse(String(task.dueAt));if(!Number.isFinite(due)||due>now.getTime()||task.status==='completed')continue;
   const category=task.category==='clinical'?'clinical':task.category==='finance'?'finance':'operations';
   const recipients=new Set<string>([String(task.assignedTo)]);
   if(now.getTime()-due>=escalation)for(const user of await activeUsers())if((!task.branchId||user.branchIds.includes(String(task.branchId))||user.roles.includes('owner'))&&user.roles.some(role=>(category==='clinical'?['doctor']:category==='finance'?['owner','admin','accountant']:['owner','admin','manager']).includes(role)))recipients.add(user.id);
   for(const userId of recipients){if(await this.queue(due,['overdue-task',task.id,task.dueAt,task.assignedTo],userId,category,'An assigned task is overdue',task.id,now,{kind:'overdue-task',id:task.id,dueAt:task.dueAt}))escalations++;}
  }
  for(const result of results){
   const due=Date.parse(String(result.dueAt));if(!Number.isFinite(due)||due>now.getTime()||!outstandingResult(result))continue;
   const recipients=new Set<string>([String(result.reviewerId)]);
   if(now.getTime()-due>=escalation&&result.coveringReviewerId)recipients.add(String(result.coveringReviewerId));
   for(const userId of recipients){if(await this.queue(due,['overdue-result',result.id,result.dueAt,result.reviewState,result.contactState,result.actionState],userId,'clinical','A result follow-up is overdue',result.id,now,{kind:'overdue-result',id:result.id,dueAt:result.dueAt}))escalations++;}
  }
  return {reminders,escalations};
 }
}
