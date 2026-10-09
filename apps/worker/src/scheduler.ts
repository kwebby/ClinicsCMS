/* Author: ramanpal singh | URL: https://kwebby.com */
import { createHash } from 'node:crypto';
import type { Database, Entity } from '../../../packages/contracts/src/index.js';
import { entity, type User } from '../../api/src/auth.js';

const hash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
export async function allRecords<T extends Entity=Entity>(db:Database,collection:string,eq:Record<string,string|boolean>):Promise<T[]> {
 const result:T[]=[];let after:string|undefined;
 for(let batch=0;batch<100;batch++){const rows=await db.list<T>(collection,{eq,limit:1000,after});result.push(...rows);if(rows.length<1000)return result;after=rows[rows.length-1].id;}
 throw new Error('Scheduler collection exceeds its supported scanning budget');
}
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
 constructor(private readonly db:Database,private readonly organizationId:string){}
 private async queue(keyParts:unknown[],userId:string,category:string,title:string,resourceId:string,nextAttempt:Date,condition:Record<string,unknown>){
  const id=`scheduled-${hash([this.organizationId,...keyParts,userId])}`;
  return this.db.transaction([`scheduled:${id}`],async tx=>{if(await tx.get('outbox',id))return false;await tx.put('outbox',{...entity(this.organizationId,id),type:'notification.requested',status:'pending',payload:{userId,category,title,resourceId,condition},attempts:0,nextAttemptAt:nextAttempt.toISOString()});return true;});
 }
 async tick(now=new Date()):Promise<{reminders:number;escalations:number}>{
  if(process.env.OUTBOUND_WORKERS_ENABLED!=='true')return {reminders:0,escalations:0};
  const users=await allRecords<User>(this.db,'users',{organizationId:this.organizationId,status:'active'});
  const [appointments,tasks,results]=await Promise.all([allRecords(this.db,'appointments',{organizationId:this.organizationId,status:'booked'}),allRecords(this.db,'tasks',{organizationId:this.organizationId}),allRecords(this.db,'results',{organizationId:this.organizationId})]);
  const configuration=(await this.db.get('settings','notifications'))?.value as {escalationMinutes?:number}|undefined;
  const escalation=Math.min(10080,Math.max(5,Number(configuration?.escalationMinutes??60)))*60000;
  let reminders=0,escalations=0;
  for(const appointment of appointments){
   const start=Date.parse(String(appointment.startsAt)),until=start-now.getTime();if(until<=5*60000||until>25*3600000||!await hasReminderConsent(this.db,this.organizationId,String(appointment.patientId)))continue;
   const recipients=users.filter(user=>user.roles.every(role=>role==='patient')&&user.emailVerified&&user.patientIds.includes(String(appointment.patientId)));
   const offsets=until>2*3600000+5*60000?[24,2]:[2];
   for(const hours of offsets)for(const user of recipients){if(await this.queue(['reminder',appointment.id,appointment.startsAt,hours],user.id,'appointments','You have an upcoming appointment',appointment.id,new Date(Math.max(now.getTime(),start-hours*3600000)),{kind:'reminder',id:appointment.id,startsAt:appointment.startsAt}))reminders++;}
  }
  for(const task of tasks){
   const due=Date.parse(String(task.dueAt));if(!Number.isFinite(due)||due>now.getTime()||task.status==='completed')continue;
   const category=task.category==='clinical'?'clinical':task.category==='finance'?'finance':'operations';
   const recipients=new Set<string>([String(task.assignedTo)]);
   if(now.getTime()-due>=escalation)for(const user of users)if((!task.branchId||user.branchIds.includes(String(task.branchId))||user.roles.includes('owner'))&&user.roles.some(role=>(category==='clinical'?['doctor']:category==='finance'?['owner','admin','accountant']:['owner','admin','manager']).includes(role)))recipients.add(user.id);
   for(const userId of recipients){if(await this.queue(['overdue-task',task.id,task.dueAt,task.assignedTo],userId,category,'An assigned task is overdue',task.id,now,{kind:'overdue-task',id:task.id,dueAt:task.dueAt}))escalations++;}
  }
  for(const result of results){
   const due=Date.parse(String(result.dueAt));if(!Number.isFinite(due)||due>now.getTime()||!outstandingResult(result))continue;
   const recipients=new Set<string>([String(result.reviewerId)]);
   if(now.getTime()-due>=escalation&&result.coveringReviewerId)recipients.add(String(result.coveringReviewerId));
   for(const userId of recipients){if(await this.queue(['overdue-result',result.id,result.dueAt,result.reviewState,result.contactState,result.actionState],userId,'clinical','A result follow-up is overdue',result.id,now,{kind:'overdue-result',id:result.id,dueAt:result.dueAt}))escalations++;}
  }
  return {reminders,escalations};
 }
}
