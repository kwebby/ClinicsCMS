/* Author: ramanpal singh | URL: https://kwebby.com */
import { getApps, initializeApp, applicationDefault } from 'firebase-admin/app';
import { getFirestore, type Firestore, type Transaction, type Query as FsQuery } from 'firebase-admin/firestore';
import { createHash } from 'node:crypto';
import { DomainError, type Database, type Entity, type Query, type Repository } from '../../contracts/src/index.js';
import { validateWrite, validateRecordSize, matches, afterCursor, sortById } from './memory.js';

/** Keep canonical JSON lossless (including nested BlockNote table arrays); query only scalar projections. */
export function encodeFirestoreRecord(record:Entity):Record<string,unknown>{return {...Object.fromEntries(Object.entries(record).filter(([,value])=>value===null||['string','number','boolean'].includes(typeof value))),_payload:JSON.stringify(record)};}
export function decodeFirestoreRecord(record:Record<string,unknown>):Entity{return typeof record._payload==='string'?JSON.parse(record._payload):record as Entity;}

type Pending={collection:string;id:string;value:Entity|null;expected?:number};
export class FirestoreDatabase implements Database {
 driver='firestore'; private db:Firestore;
 constructor(projectId:string,databaseId='(default)') {
  if(!projectId)throw new Error('FIREBASE_PROJECT_ID is required');
  const app=getApps().find(a=>a.name===projectId)??initializeApp({projectId,credential:applicationDefault()},projectId);
  this.db=getFirestore(app,databaseId);this.db.settings({ignoreUndefinedProperties:true});
 }
 private collection(c:string) { if(!/^[a-zA-Z][a-zA-Z0-9_-]{0,79}$/.test(c))throw new DomainError('COLLECTION','Invalid collection');return this.db.collection(`clinic_${c}`); }
 async initialize(){const marker=await this.db.collection('clinic_restoreMetadata').doc('state').get();if(marker.data()?.status==='incomplete')throw new DomainError('RESTORE_INCOMPLETE','Offline database restore is incomplete; do not start the application',503);await this.db.collection('clinic_system').limit(1).get();}
 async listCollections():Promise<string[]>{const collections=await this.db.listCollections();return collections.map(c=>c.id).filter(id=>id.startsWith('clinic_')&&id!=='clinic_locks'&&id!=='clinic_restoreMetadata').map(id=>id.slice(7)).sort();}
 async restoreEmpty(records:AsyncIterable<{collection:string;record:Entity}>|Iterable<{collection:string;record:Entity}>):Promise<void>{
  for(const collection of await this.db.listCollections()){if(collection.id==='clinic_locks')continue;if(collection.id==='clinic_restoreMetadata'){const state=await collection.doc('state').get();if(state.data()?.status==='incomplete')throw new DomainError('RESTORE_INCOMPLETE','Previous restore is incomplete',409);continue;}const existing=await collection.limit(1).get();if(!existing.empty)throw new DomainError('RESTORE_TARGET_NOT_EMPTY','Restore requires an empty Firestore database',409);}
  const marker=this.db.collection('clinic_restoreMetadata').doc('state');await marker.set({status:'incomplete',startedAt:new Date().toISOString()});
  let batch=this.db.batch(),count=0,total=0;
  for await(const item of records){validateRecordSize(item.record);batch.create(this.collection(item.collection).doc(item.record.id),encodeFirestoreRecord(item.record));count++;total++;if(count===400){await batch.commit();batch=this.db.batch();count=0;}}
  if(count)await batch.commit();await marker.update({status:'complete',records:total,completedAt:new Date().toISOString()});
 }
 async close(){await this.db.terminate();}
 private repository(tx?:Transaction,pending:Map<string,Pending>=new Map()):Repository {
  const key=(c:string,id:string)=>`${c}/${id}`;
  const ref=(c:string,id:string)=>{if(!id || id.includes('/') || id.length>128)throw new DomainError('ID','Invalid record ID');return this.collection(c).doc(id);};
  const get=async<T extends Entity>(c:string,id:string):Promise<T|null>=>{const p=pending.get(key(c,id));if(p)return structuredClone(p.value) as T|null;const r=tx?await tx.get(ref(c,id)):await ref(c,id).get();return r.exists?decodeFirestoreRecord(r.data()!) as T:null;};
  return {
   get,
   list:async<T extends Entity>(c:string,q:Query={}):Promise<T[]>=>{
    let stmt:FsQuery=this.collection(c);
    for(const [field,value]of Object.entries(q.eq??{})){if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field))throw new DomainError('QUERY','Invalid query field');stmt=stmt.where(field,'==',value);}
    const limit=Math.min(q.limit??10000,10000),staged=[...pending.values()].filter(p=>p.collection===c);
    // Over-fetch by the staged writes so staged deletions or no-longer-matching updates cannot shorten a full page.
    stmt=stmt.orderBy('__name__',q.order==='desc'?'desc':'asc');if(q.after)stmt=stmt.startAfter(ref(c,q.after));stmt=stmt.limit(limit+staged.length);
    const snap=tx?await tx.get(stmt):await stmt.get();const values=new Map(snap.docs.map(d=>[d.id,decodeFirestoreRecord(d.data()) as T]));
    for(const p of staged){if(p.value&&matches(p.value,q)&&afterCursor(p.id,q))values.set(p.id,structuredClone(p.value) as T);else values.delete(p.id);}
    return sortById([...values.values()],q.order).slice(0,limit);
   },
   put:async<T extends Entity>(c:string,v:T,e?:number):Promise<T>=>{validateWrite(await get(c,v.id),v,e);if(tx){pending.set(key(c,v.id),{collection:c,id:v.id,value:structuredClone(v),expected:e});return structuredClone(v);}return this.transaction([key(c,v.id)],r=>r.put(c,v,e));},
   remove:async(c,id,e)=>{const v=await get(c,id);if(!v||(e!==undefined&&v.version!==e))throw new DomainError('CONFLICT','Record changed',409);if(tx)pending.set(key(c,id),{collection:c,id,value:null,expected:e});else await this.transaction([key(c,id)],r=>r.remove(c,id,e));}
  };
 }
 get<T extends Entity>(c:string,id:string){return this.repository().get<T>(c,id);}
 list<T extends Entity>(c:string,q?:Query){return this.repository().list<T>(c,q);}
 put<T extends Entity>(c:string,v:T,e?:number){return this.repository().put(c,v,e);}
 remove(c:string,id:string,e?:number){return this.repository().remove(c,id,e);}
 async transaction<T>(keys:string[],fn:(tx:Repository)=>Promise<T>):Promise<T> {
  try{return await this.db.runTransaction(async tx=>{
   const guards=[];
   for(const key of [...new Set(keys)].sort()){const ref=this.db.collection('clinic_locks').doc(createHash('sha256').update(key).digest('hex'));const row=await tx.get(ref);guards.push({ref,version:Number(row.data()?.version??0)});}
   const pending=new Map<string,Pending>();const result=await fn(this.repository(tx,pending));
   if(pending.size+guards.length>450)throw new DomainError('TRANSACTION_LIMIT','This operation exceeds the safe batch size. Split the operation.',413);
   for(const g of guards)tx.set(g.ref,{version:g.version+1});
   for(const p of pending.values()){const ref=this.collection(p.collection).doc(p.id);if(p.value)tx.set(ref,encodeFirestoreRecord(p.value));else tx.delete(ref);}
   return result;
  },{maxAttempts:5});}catch(error:any){
   // Contention that outlasts the SDK retries (ABORTED) is a retryable condition for the caller, not an internal error.
   if(!(error instanceof DomainError)&&(error?.code===10||error?.code==='aborted'||/contention/i.test(String(error?.message))))throw new DomainError('BUSY','The records involved are busy. Try again shortly.',503);
   throw error;
  }
 }
}
