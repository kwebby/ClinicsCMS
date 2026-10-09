/* Author: ramanpal singh | URL: https://kwebby.com */
import { Kysely, PostgresDialect, MysqlDialect, sql, type ColumnType } from 'kysely';
import pg from 'pg';
import mysql from 'mysql2';
import { DomainError, type Database, type Entity, type Query, type Repository } from '../../contracts/src/index.js';
import { validateWrite,validateRecordSize } from './memory.js';

interface RecordRow { collection: string; id: string; organization_id: string; version: number; payload: ColumnType<unknown,string,string>; }
interface LockRow { id:string; value:number; }
interface Schema { clinic_records:RecordRow; clinic_locks:LockRow; }
const decode=(row:{payload:unknown}):Entity=>typeof row.payload==='string'?JSON.parse(row.payload):row.payload as Entity;
/** Seconds a transaction waits for one lock row before failing with BUSY instead of holding a pooled connection indefinitely. */
const LOCK_TIMEOUT_SECONDS=10;
const busy=()=>new DomainError('BUSY','The records involved are busy. Try again shortly.',503);
export class SqlDatabase implements Database {
 readonly connection:Kysely<Schema>;
 /** MySQL only: whether clinic_records.id uses a binary collation, so the primary key already orders ids by bytes. */
 private binaryIds=false;
 constructor(public driver:'postgres'|'mysql'|'supabase', url:string) {
  if(!url) throw new Error('DATABASE_URL is required');
  const dialect=driver==='mysql'?new MysqlDialect({pool:mysql.createPool({uri:url,connectionLimit:10,decimalNumbers:false})}):new PostgresDialect({pool:new pg.Pool({connectionString:url,max:10})});
  this.connection=new Kysely<Schema>({dialect});
 }
 async initialize() {
  // New MySQL tables compare ids by code point (case-sensitive, no padding) like every other adapter.
  await this.connection.schema.createTable('clinic_records').ifNotExists().addColumn('collection','varchar(80)',c=>c.notNull()).addColumn('id',this.driver==='mysql'?sql`varchar(128) character set utf8mb4 collate utf8mb4_0900_bin`:'varchar(128)',c=>c.notNull()).addColumn('organization_id','varchar(128)',c=>c.notNull()).addColumn('version','integer',c=>c.notNull()).addColumn('payload',this.driver==='mysql'?'json':'jsonb',c=>c.notNull()).addPrimaryKeyConstraint('clinic_records_pk',['collection','id']).execute();
  await this.connection.schema.createTable('clinic_locks').ifNotExists().addColumn('id','varchar(240)',c=>c.primaryKey()).addColumn('value','integer',c=>c.notNull().defaultTo(0)).execute();
  if(this.driver!=='mysql') {
   await this.connection.schema.createIndex('clinic_records_organization').ifNotExists().on('clinic_records').columns(['organization_id','collection']).execute();
   // Cursor pagination orders ids by bytes (COLLATE "C"), independent of the database locale; this index serves that order.
   await sql`create index if not exists clinic_records_collection_id_bytes on clinic_records (collection, id collate "C")`.execute(this.connection);
  } else {
   const column=await sql<{id_collation:string|null}>`select collation_name as id_collation from information_schema.columns where table_schema = database() and table_name = 'clinic_records' and column_name = 'id'`.execute(this.connection);
   this.binaryIds=/_bin$/i.test(String(column.rows[0]?.id_collation??''));
  }
 }
 private repository(db:Kysely<Schema>):Repository {
  const get=async<T extends Entity>(c:string,id:string):Promise<T|null>=>{const row=await db.selectFrom('clinic_records').selectAll().where('collection','=',c).where('id','=',id).executeTakeFirst();return row?decode(row) as T:null;};
  return {
   get,
   list:async<T extends Entity>(c:string,q:Query={}):Promise<T[]>=>{
    let stmt=db.selectFrom('clinic_records').selectAll().where('collection','=',c);
    for(const [field,value] of Object.entries(q.eq??{})) {
     if(!/^[a-zA-Z][a-zA-Z0-9_]{0,63}$/.test(field)) throw new DomainError('QUERY','Invalid query field');
     if(field==='organizationId') stmt=stmt.where('organization_id','=',String(value));
     else if(field==='id') stmt=stmt.where('id','=',String(value));
     else if(value===null)stmt=this.driver==='mysql'?stmt.where(sql<string>`JSON_TYPE(JSON_EXTRACT(payload, ${'$.'+field}))`,'=','NULL'):stmt.where(sql<string>`jsonb_typeof(payload -> ${field})`,'=','null');
     // Typed JSON equality, as in the memory and Firestore adapters: 1, "1" and true never match each other.
     else stmt=stmt.where(this.driver==='mysql'?sql<boolean>`JSON_EXTRACT(payload, ${'$.'+field}) = CAST(${JSON.stringify(value)} AS JSON)`:sql<boolean>`payload -> ${field} = cast(${JSON.stringify(value)} as jsonb)`);
    }
    // Ids are ordered and compared as bytes, not by a locale collation (which may ignore case or punctuation), so cursors
    // match the memory and Firestore adapters. Older MySQL tables with a case-insensitive id column fall back to a cast.
    const desc=q.order==='desc',op=sql.raw(desc?'<':'>'),castIds=this.driver==='mysql'&&!this.binaryIds;
    const idBytes=this.driver!=='mysql'?sql`id collate "C"`:castIds?sql`CAST(id AS BINARY)`:sql`id`;
    if(q.after)stmt=stmt.where(castIds?sql<boolean>`CAST(id AS BINARY) ${op} CAST(${q.after} AS BINARY)`:sql<boolean>`${idBytes} ${op} ${q.after}`);
    const rows=await stmt.orderBy(idBytes,desc?'desc':'asc').limit(Math.min(q.limit??10000,10000)).execute();return rows.map(r=>decode(r) as T);
   },
   put:async<T extends Entity>(c:string,v:T,e?:number):Promise<T>=>{
    validateWrite(await get(c,v.id),v,e);
    if(e===undefined) {
     try { await db.insertInto('clinic_records').values({collection:c,id:v.id,organization_id:v.organizationId,version:v.version,payload:JSON.stringify(v)}).execute(); }
     catch(error:any) { if(['23505','ER_DUP_ENTRY'].includes(error.code))throw new DomainError('CONFLICT','Record already exists',409);throw error; }
    } else {
     const result=await db.updateTable('clinic_records').set({version:v.version,payload:JSON.stringify(v)}).where('collection','=',c).where('id','=',v.id).where('organization_id','=',v.organizationId).where('version','=',e).executeTakeFirst();
     if(Number(result.numUpdatedRows)!==1) throw new DomainError('CONFLICT','Record changed. Refresh before saving.',409);
    }
    return structuredClone(v);
   },
   remove:async(c,id,e)=>{let stmt=db.deleteFrom('clinic_records').where('collection','=',c).where('id','=',id);if(e!==undefined)stmt=stmt.where('version','=',e);const r=await stmt.executeTakeFirst();if(Number(r.numDeletedRows)!==1)throw new DomainError('CONFLICT','Record changed',409);}
  };
 }
 get<T extends Entity>(c:string,id:string) { return this.repository(this.connection).get<T>(c,id); }
 list<T extends Entity>(c:string,q?:Query) { return this.repository(this.connection).list<T>(c,q); }
 put<T extends Entity>(c:string,v:T,e?:number) { return this.repository(this.connection).put(c,v,e); }
 remove(c:string,id:string,e?:number) { return this.repository(this.connection).remove(c,id,e); }
 async transaction<T>(keys:string[],fn:(tx:Repository)=>Promise<T>):Promise<T> {
  for(let attempt=0;;attempt++){
   try{return await this.connection.transaction().setIsolationLevel('read committed').execute(async tx=>{
    if(this.driver==='mysql')await sql`SET SESSION innodb_lock_wait_timeout = ${sql.raw(String(LOCK_TIMEOUT_SECONDS))}`.execute(tx);
    else await sql`set local lock_timeout = ${sql.raw(`'${LOCK_TIMEOUT_SECONDS}s'`)}`.execute(tx);
    for(const key of [...new Set(keys)].sort()) {
     const id=key.length<=230?key:(await import('node:crypto')).createHash('sha256').update(key).digest('hex');
     if(this.driver==='mysql') await tx.insertInto('clinic_locks').values({id,value:0}).ignore().execute();
     else await tx.insertInto('clinic_locks').values({id,value:0}).onConflict(oc=>oc.column('id').doNothing()).execute();
     await tx.selectFrom('clinic_locks').selectAll().where('id','=',id).forUpdate().execute();
    }
    return fn(this.repository(tx));
   });}catch(error:any){
    if(error instanceof DomainError)throw error;
    // Deadlocks and serialization failures are retried; a lock wait timeout signals sustained contention and is not.
    const retryable=['ER_LOCK_DEADLOCK','40001','40P01'].includes(String(error.code))||error.errno===1213||error.sqlState==='40001';
    const timedOut=['ER_LOCK_WAIT_TIMEOUT','55P03'].includes(String(error.code))||error.errno===1205;
    if(timedOut||retryable&&attempt>=7)throw busy();
    if(!retryable)throw error;
    // Callbacks contain only repository reads and staged business writes. Provider work remains outside transactions.
    await new Promise(resolve=>setTimeout(resolve,Math.min(250,10*2**attempt)+Math.floor(Math.random()*20)));
   }
  }
 }
 async listCollections():Promise<string[]>{const rows=await this.connection.selectFrom('clinic_records').select('collection').distinct().execute();return rows.map(r=>r.collection).sort();}
 async restoreEmpty(records:AsyncIterable<{collection:string;record:Entity}>|Iterable<{collection:string;record:Entity}>):Promise<void>{
  await this.connection.transaction().execute(async tx=>{
   const existing=await tx.selectFrom('clinic_records').select('id').limit(1).executeTakeFirst();if(existing)throw new DomainError('RESTORE_TARGET_NOT_EMPTY','Restore requires an empty database',409);
   for await(const item of records){validateRecordSize(item.record);await tx.insertInto('clinic_records').values({collection:item.collection,id:item.record.id,organization_id:item.record.organizationId,version:item.record.version,payload:JSON.stringify(item.record)}).execute();}
  });
 }
 async close(){await this.connection.destroy();}
}
