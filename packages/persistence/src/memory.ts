/* Author: ramanpal singh | URL: https://kwebby.com */
import { DomainError, type Database, type Entity, type Query, type Repository } from '../../contracts/src/index.js';

export const copy = <T>(value: T): T => structuredClone(value);
// JSON encodes U+0000 as \u0000; an odd run of backslashes before "u0000" is that escape, not literal text.
const encodedNul=/(?:^|[^\\])(?:\\\\)*\\u0000/;
export function validateRecordSize(value:Entity){
 const json=JSON.stringify(value);const bytes=Buffer.byteLength(json,'utf8');
 // PostgreSQL JSONB rejects NUL; reject it on every adapter so behavior and restores stay portable.
 if(encodedNul.test(json))throw new DomainError('VALIDATION','Text must not contain NUL characters',400);
 const projection=Object.fromEntries(Object.entries(value).filter(([,entry])=>entry===null||['string','number','boolean'].includes(typeof entry)));
 const firestoreBytes=Buffer.byteLength(JSON.stringify({...projection,_payload:json}),'utf8');
 if(bytes>750*1024||firestoreBytes>950*1024)throw new DomainError('RECORD_TOO_LARGE','This record exceeds the portable storage limit. Split large documents or create a separate record.',413);
}
export function validateWrite(previous: Entity | null, value: Entity, expected?: number) {
 validateRecordSize(value);
 if (expected === undefined) {
  if (previous) throw new DomainError('CONFLICT', 'Record already exists', 409);
  if (value.version !== 1) throw new DomainError('VERSION', 'New records require version 1');
 } else if (!previous || previous.version !== expected || value.version !== expected + 1) {
  throw new DomainError('CONFLICT', 'The record changed. Refresh before saving.', 409);
 }
}
/** Typed equality (no string coercion), identical to the SQL and Firestore filters. */
export function matches(value: Entity, query: Query = {}) {
 return Object.entries(query.eq ?? {}).every(([key, expected]) => value[key] === expected);
}
/** Code-unit id order, which equals the byte order used by the SQL adapters (COLLATE "C"/binary) for ASCII ids, and by Firestore. */
export const compareIds = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0;
/** Applies Query.after/order: ascending by default; with `desc`, `after` is an exclusive upper bound. */
export function afterCursor(id: string, query: Query = {}) { return !query.after || (query.order === 'desc' ? id < query.after : id > query.after); }
export function sortById<T extends Entity>(rows: T[], order: Query['order']): T[] { return rows.sort((a, b) => order === 'desc' ? compareIds(b.id, a.id) : compareIds(a.id, b.id)); }
export class MemoryDatabase implements Database {
 driver = 'memory'; private values = new Map<string, Entity>(); private tail: Promise<unknown> = Promise.resolve();
 async initialize() {} async close() {}
 private key(c: string, id: string) { return `${c}/${id}`; }
 async get<T extends Entity>(c: string, id: string): Promise<T | null> { return copy(this.values.get(this.key(c,id)) as T ?? null); }
 async list<T extends Entity>(c: string, q: Query = {}): Promise<T[]> {
  return sortById([...this.values.entries()].filter(([k,v])=>k.startsWith(`${c}/`) && matches(v,q) && afterCursor(v.id,q)).map(([,v])=>copy(v) as T),q.order).slice(0,Math.min(q.limit ?? 10000,10000));
 }
 async put<T extends Entity>(c:string,v:T,e?:number):Promise<T> { validateWrite(await this.get(c,v.id),v,e); this.values.set(this.key(c,v.id),copy(v)); return copy(v); }
 async remove(c:string,id:string,e?:number) { const v=await this.get(c,id); if(!v || (e!==undefined && v.version!==e)) throw new DomainError('CONFLICT','Record changed',409); this.values.delete(this.key(c,id)); }
 async listCollections():Promise<string[]>{return [...new Set([...this.values.keys()].map(k=>k.split('/')[0]))].sort();}
 async restoreEmpty(records:AsyncIterable<{collection:string;record:Entity}>|Iterable<{collection:string;record:Entity}>):Promise<void>{
  if(this.values.size)throw new DomainError('RESTORE_TARGET_NOT_EMPTY','Restore requires an empty database',409);const next=new Map<string,Entity>();
  for await(const item of records){validateRecordSize(item.record);const key=this.key(item.collection,item.record.id);if(next.has(key))throw new DomainError('RESTORE_DUPLICATE','Duplicate restore record');next.set(key,copy(item.record));}this.values=next;
 }
 async transaction<T>(_keys:string[],fn:(tx:Repository)=>Promise<T>):Promise<T> {
  const task=this.tail.then(async()=>{ const original=this.values; this.values=new Map([...original].map(([k,v])=>[k,copy(v)])); try { return await fn(this); } catch(error) { this.values=original; throw error; } });
  this.tail=task.catch(()=>{}); return task;
 }
}
