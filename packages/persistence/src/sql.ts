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
export class SqlDatabase implements Database {
 readonly connection:Kysely<Schema>;
 constructor(public driver:'postgres'|'mysql'|'supabase', url:string) {
  if(!url) throw new Error('DATABASE_URL is required');
  const dialect=driver==='mysql'?new MysqlDialect({pool:mysql.createPool({uri:url,connectionLimit:10,decimalNumbers:false})}):new PostgresDialect({pool:new pg.Pool({connectionString:url,max:10})});
  this.connection=new Kysely<Schema>({dialect});
 }
 async initialize() {
  await this.connection.schema.createTable('clinic_records').ifNotExists().addColumn('collection','varchar(80)',c=>c.notNull()).addColumn('id','varchar(128)',c=>c.notNull()).addColumn('organization_id','varchar(128)',c=>c.notNull()).addColumn('version','integer',c=>c.notNull()).addColumn('payload',this.driver==='mysql'?'json':'jsonb',c=>c.notNull()).addPrimaryKeyConstraint('clinic_records_pk',['collection','id']).execute();
  await this.connection.schema.createTable('clinic_locks').ifNotExists().addColumn('id','varchar(240)',c=>c.primaryKey()).addColumn('value','integer',c=>c.notNull().defaultTo(0)).execute();
  if(this.driver!=='mysql') await this.connection.schema.createIndex('clinic_records_organization').ifNotExists().on('clinic_records').columns(['organization_id','collection']).execute();
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
     else { const expression=this.driver==='mysql'?sql<string>`JSON_UNQUOTE(JSON_EXTRACT(payload, ${'$.'+field}))`:sql<string>`payload ->> ${field}`;if(value===null)stmt=this.driver==='mysql'?stmt.where(sql<string>`JSON_TYPE(JSON_EXTRACT(payload, ${'$.'+field}))`,'=','NULL'):stmt.where(sql<string>`jsonb_typeof(payload -> ${field})`,'=','null');else stmt=stmt.where(expression,'=',String(value)); }
    }
    if(q.after)stmt=stmt.where('id','>',q.after);
    const rows=await stmt.orderBy('id','asc').limit(Math.min(q.limit??10000,10000)).execute();return rows.map(r=>decode(r) as T);
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
    for(const key of [...new Set(keys)].sort()) {
     const id=key.length<=230?key:(await import('node:crypto')).createHash('sha256').update(key).digest('hex');
     if(this.driver==='mysql') await tx.insertInto('clinic_locks').values({id,value:0}).ignore().execute();
     else await tx.insertInto('clinic_locks').values({id,value:0}).onConflict(oc=>oc.column('id').doNothing()).execute();
     await tx.selectFrom('clinic_locks').selectAll().where('id','=',id).forUpdate().execute();
    }
    return fn(this.repository(tx));
   });}catch(error:any){
    const retryable=['ER_LOCK_DEADLOCK','ER_LOCK_WAIT_TIMEOUT','40001','40P01'].includes(String(error.code))||[1213,1205].includes(error.errno)||error.sqlState==='40001';
    if(!retryable||attempt>=7)throw error;
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
