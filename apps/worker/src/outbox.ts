/* Author: ramanpal singh | URL: https://kwebby.com */
import { DomainError,type Database,type Entity } from '../../../packages/contracts/src/index.js';
import { CursorScan,outstandingResult } from './scheduler.js';

/** Error name and code only. Messages can carry addresses or record content, so they are never logged or stored. */
export function failureInfo(error:unknown):{errorType:string;failureCode?:string}{
 const e=error as {smtpCode?:unknown;code?:unknown}|null;const code=[e?.smtpCode,e?.code].find((v):v is string=>typeof v==='string'&&/^[A-Za-z0-9_.-]{1,64}$/.test(v));
 return {errorType:error instanceof Error?error.name:'unknown',...(code?{failureCode:code}:{})};
}
/** Days completed and permanently failed outbox rows stay visible in the admin jobs view (OUTBOX_RETENTION_DAYS, default 14). */
export function retentionDays(value=process.env.OUTBOX_RETENTION_DAYS):number{const days=Number(value);return value&&Number.isFinite(days)&&days>=1?Math.min(days,3650):14;}

export class OutboxDispatcher {
 private due:CursorScan;private terminal:CursorScan;private retention:number;
 constructor(private db:Database,private organizationId:string,private enqueue:(id:string)=>Promise<unknown>,options:{batch?:number;pruneBatch?:number;retentionDays?:number}={}){
  const batch=options.batch??500,prune=options.pruneBatch??200;this.due=new CursorScan(db,batch,batch);this.terminal=new CursorScan(db,prune,prune);this.retention=options.retentionDays??retentionDays();
 }
 /** Enqueues due pending rows and processing rows whose lease expired. Each call reads at most one batch per status and continues from there next time. */
 async dispatch(now=Date.now()):Promise<number>{
  let queued=0;
  for(const row of await this.due.next('outbox',{organizationId:this.organizationId,status:'pending'}))if(Date.parse(String(row.nextAttemptAt))<=now){await this.enqueue(row.id);queued++;}
  for(const row of await this.due.next('outbox',{organizationId:this.organizationId,status:'processing'}))if(Date.parse(String(row.leaseUntil))<now){await this.enqueue(row.id);queued++;}
  return queued;
 }
 /** Deletes a small batch of completed and failed rows older than the retention period, with their mail delivery records. */
 async prune(now=Date.now()):Promise<number>{
  const cutoff=now-this.retention*86400000;let removed=0;
  for(const status of ['completed','failed'])for(const row of await this.terminal.next('outbox',{organizationId:this.organizationId,status})){
   if(!(Date.parse(String(row.completedAt??row.updatedAt))<cutoff)||await this.stillDeduplicating(row,now))continue;
   try{
    // The outbox row goes first (version-checked, so a concurrent admin retry wins); its delivery record must never disappear while it can still be retried.
    await this.db.remove('outbox',row.id,row.version);removed++;
    const delivery=row.type==='email.send'?await this.db.get('mailDeliveries',`mail-${row.id}`):null;if(delivery)await this.db.remove('mailDeliveries',delivery.id,delivery.version);
   }catch(error){if(!(error instanceof DomainError&&error.code==='CONFLICT'))throw error;}
  }
  return removed;
 }
 /** Scheduler rows deduplicate by id, so they stay while their condition holds; otherwise the next tick would notify again. */
 private async stillDeduplicating(row:Entity,now:number):Promise<boolean>{
  const condition=(row.payload as {condition?:{kind?:string;id?:string;startsAt?:string;dueAt?:string}}|undefined)?.condition;if(row.type!=='notification.requested'||!condition)return false;
  if(condition.kind==='reminder'){const a=await this.db.get('appointments',String(condition.id));return !!a&&a.status==='booked'&&a.startsAt===condition.startsAt&&Date.parse(String(a.startsAt))>now;}
  if(condition.kind==='overdue-task'){const t=await this.db.get('tasks',String(condition.id));return !!t&&t.status!=='completed'&&t.dueAt===condition.dueAt;}
  if(condition.kind==='overdue-result'){const r=await this.db.get('results',String(condition.id));return !!r&&outstandingResult(r)&&r.dueAt===condition.dueAt;}
  return false;
 }
}
