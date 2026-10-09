/* Author: ramanpal singh | URL: https://kwebby.com */
import { createCipheriv,createDecipheriv,createHash,randomBytes } from 'node:crypto';
import { createReadStream,createWriteStream,constants,rmSync } from 'node:fs';
import { appendFile,lstat,mkdir,mkdtemp,open,readdir,rename,rm,rmdir,stat,writeFile } from 'node:fs/promises';
import { dirname,join,resolve,sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createGzip,createGunzip } from 'node:zlib';
import { Readable,Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createInterface } from 'node:readline';
import { validateRecordSize } from './memory.js';
import { assert,canonicalJson,DomainError,type Database,type Entity } from '../../contracts/src/index.js';

type Item={collection:string;record:Entity};
interface TransferDatabase extends Database {listCollections():Promise<string[]>;restoreEmpty(records:AsyncIterable<Item>|Iterable<Item>):Promise<void>;}
/** `scratchDir` holds decrypted working files (default: the directory containing `storageRoot`, never the shared system
 * temp directory). `maxExpandedBytes` caps the decompressed stream (default: 32x the archive size, at least 2 GiB). */
export interface TransferOptions {database:Database;storageRoot:string;file:string;transferKey:string;appEncryptionKey:string;maintenance:boolean;outboundEnabled:boolean;maxExpandedBytes?:number;scratchDir?:string;}
const MAGIC=Buffer.from('CLINIC01');
const transient=new Set(['sessions','authTokens','invitations','mfaEnrollments','restoreMetadata']);
const digest=(value:Buffer|string)=>createHash('sha256').update(value).digest('hex');
const canonical=canonicalJson;
const GiB=1024**3;
/** Default decompression ceiling: generous for real archives (records compress well, blobs barely), bounded for bombs. */
export const defaultExpandedLimit=(archiveBytes:number)=>Math.max(2*GiB,32*archiveBytes);
const scratchName=/^\.clinic-(?:import|restore)-(\d+)-[A-Za-z0-9]{6}$/,legacyStage=/^\.clinic-restore-[A-Za-z0-9]{6}$/,legacyTemp=/^clinic-restore-[A-Za-z0-9]{6}$/;
function alive(pid:number){if(pid===process.pid)return true;try{process.kill(pid,0);return true;}catch(error:any){return error.code==='EPERM';}}
/** Removes decrypted working directories left by imports that crashed or were killed before their own cleanup ran. */
export async function removeStaleScratch(directory:string,pattern:RegExp=scratchName):Promise<string[]>{
 let entries;try{entries=await readdir(directory,{withFileTypes:true});}catch(error:any){if(error.code==='ENOENT')return [];throw error;}const removed:string[]=[];
 for(const entry of entries){if(!entry.isDirectory())continue;const match=pattern.exec(entry.name);if(!match||(match[1]&&alive(Number(match[1]))))continue;const path=join(directory,entry.name);if(pattern===legacyTemp&&(await lstat(path)).uid!==process.getuid?.())continue;await rm(path,{recursive:true,force:true});removed.push(path);}
 return removed;
}
function key(value:string,name:string):Buffer{const bytes=Buffer.from(value,'base64');assert(bytes.length===32,'TRANSFER_KEY',`${name} requires 32 random bytes encoded as base64`);return bytes;}
function safePath(value:string):string {assert(value.length>0&&value.length<2048&&!value.includes('\\')&&!value.startsWith('/')&&value.split('/').every(p=>p&&p!=='.'&&p!=='..'&&!p.includes('\0')),'TRANSFER_PATH','Unsafe archive path');return value;}
function adapter(options:TransferOptions):TransferDatabase{assert(options.maintenance&&!options.outboundEnabled,'MAINTENANCE_REQUIRED','Maintenance mode and disabled outbound workers are required',409);const db=options.database as TransferDatabase;assert(typeof db.listCollections==='function'&&typeof db.restoreEmpty==='function','TRANSFER_DRIVER','Database does not support offline transfer');return db;}
async function emptyDirectory(path:string){try{const info=await lstat(path);assert(info.isDirectory()&&!info.isSymbolicLink()&&(await readdir(path)).length===0,'RESTORE_FILES_NOT_EMPTY','The restore storage directory must be empty',409);}catch(error:any){if(error.code!=='ENOENT')throw error;}}
async function* files(root:string,relative=''):AsyncGenerator<string>{const path=join(root,relative);let entries;try{entries=await readdir(path,{withFileTypes:true});}catch(error:any){if(error.code==='ENOENT')return;throw error;}for(const entry of entries.sort((a,b)=>a.name.localeCompare(b.name))){assert(!entry.isSymbolicLink(),'TRANSFER_SYMLINK','Storage must not contain symbolic links');if(entry.name.startsWith('.quarantine-'))continue;const rel=relative?`${relative}/${entry.name}`:entry.name;if(entry.isDirectory())yield*files(root,rel);else{assert(entry.isFile(),'TRANSFER_FILE','Storage contains a non-regular file');yield safePath(rel);}}}
function validateRecord(value:any):asserts value is Item {assert(value&&typeof value==='object'&&typeof value.collection==='string'&&/^[A-Za-z][A-Za-z0-9_-]{0,79}$/.test(value.collection),'TRANSFER_RECORD','Invalid collection');const r=value.record;assert(r&&typeof r==='object'&&typeof r.id==='string'&&r.id.length>0&&r.id.length<=128&&!r.id.includes('/')&&typeof r.organizationId==='string'&&r.organizationId.length>0&&Number.isInteger(r.version)&&r.version>0&&typeof r.createdAt==='string'&&typeof r.updatedAt==='string','TRANSFER_RECORD','Invalid record metadata');validateRecordSize(r);}
export async function exportInstallation(options:TransferOptions){
 const db=adapter(options),transferKey=key(options.transferKey,'DATA_TRANSFER_KEY'),appKey=key(options.appEncryptionKey,'APP_ENCRYPTION_KEY');const root=resolve(options.storageRoot),destination=resolve(options.file);assert(!destination.startsWith(root+sep)&&destination!==root,'TRANSFER_PATH','Write the export outside private storage');
 try{await stat(join(root,'.restore-incomplete'));assert(false,'RESTORE_INCOMPLETE','Cannot export an incomplete restoration');}catch(error:any){if(error.code!=='ENOENT')throw error;}
 const recordHash=createHash('sha256');const counts:Record<string,number>={},blobs:{path:string;size:number;sha256:string}[]=[];let exported=0;
 async function* payload(){
  yield JSON.stringify({kind:'header',schemaVersion:1,sourceDriver:db.driver,createdAt:new Date().toISOString(),appKeyFingerprint:digest(appKey),transientCollectionsOmitted:[...transient]})+'\n';
  for(const collection of await db.listCollections()){
   if(transient.has(collection))continue;let after:string|undefined;counts[collection]=0;
   for(;;){const rows=await db.list(collection,{limit:10000,...(after?{after}:{})});for(const record of rows){const item={collection,record};validateRecord(item);const encoded=JSON.stringify(item);recordHash.update(encoded+'\n');counts[collection]++;exported++;yield JSON.stringify({kind:'record',...item})+'\n';}if(rows.length<10000)break;const next=rows[rows.length-1].id;assert(next!==after,'TRANSFER_PAGINATION','Export pagination did not advance');after=next;}
  }
  for await(const path of files(root)){
   const full=join(root,path),handle=await open(full,constants.O_RDONLY|constants.O_NOFOLLOW);const info=await handle.stat();assert(info.isFile(),'TRANSFER_FILE','Storage changed during export');const hash=createHash('sha256');let size=0;
   try{yield JSON.stringify({kind:'blob-start',path,size:info.size})+'\n';for await(const chunk of handle.createReadStream({highWaterMark:49152,autoClose:false})){hash.update(chunk);size+=chunk.length;yield JSON.stringify({kind:'blob-chunk',data:chunk.toString('base64')})+'\n';}}finally{await handle.close();}
   assert(size===info.size,'TRANSFER_FILE_CHANGED','File size changed during maintenance export');const item={path,size,sha256:hash.digest('hex')};blobs.push(item);yield JSON.stringify({kind:'blob-end',...item})+'\n';
  }
  yield JSON.stringify({kind:'manifest',records:exported,counts,recordsHash:recordHash.digest('hex'),files:blobs})+'\n';
 }
 await mkdir(dirname(destination),{recursive:true,mode:0o700});const iv=randomBytes(12);await writeFile(destination,Buffer.concat([MAGIC,iv]),{flag:'wx',mode:0o600});
 try{const cipher=createCipheriv('aes-256-gcm',transferKey,iv,{authTagLength:16});cipher.setAAD(MAGIC);await pipeline(Readable.from(payload()),createGzip(),cipher,createWriteStream(destination,{flags:'a',mode:0o600}));await appendFile(destination,cipher.getAuthTag());return {file:destination,records:exported,collections:Object.keys(counts).length,files:blobs.length,counts};}
 catch(error){await rm(destination,{force:true});throw error;}
}
export async function importInstallation(options:TransferOptions){
 const db=adapter(options),transferKey=key(options.transferKey,'DATA_TRANSFER_KEY'),appKey=key(options.appEncryptionKey,'APP_ENCRYPTION_KEY');const root=resolve(options.storageRoot),source=resolve(options.file);assert(!source.startsWith(root+sep)&&source!==root,'TRANSFER_PATH','Import file must be outside private storage');await emptyDirectory(root);
 for(const collection of await db.listCollections())assert((await db.list(collection,{limit:1})).length===0,'RESTORE_TARGET_NOT_EMPTY','Restore requires an empty target database',409);
 // Decrypted records and files are PHI: keep them in a private (0700) directory next to private storage, never the shared
 // temp directory, and remove leftovers from interrupted runs before writing anything new.
 const scratchBase=resolve(options.scratchDir??dirname(root));assert(!scratchBase.startsWith(root+sep)&&scratchBase!==root,'TRANSFER_PATH','The transfer scratch directory must be outside private storage');
 await mkdir(scratchBase,{recursive:true,mode:0o700});await mkdir(dirname(root),{recursive:true,mode:0o700});
 for(const directory of new Set([scratchBase,dirname(root)])){await removeStaleScratch(directory);await removeStaleScratch(directory,legacyStage);}await removeStaleScratch(tmpdir(),legacyTemp);
 const scratch=await mkdtemp(join(scratchBase,`.clinic-import-${process.pid}-`));let stage:string|undefined;let fileHandle:Awaited<ReturnType<typeof open>>|undefined;
 // Synchronous cleanup also runs on termination signals and process exit, where the finally block below never executes.
 const cleanup=()=>{for(const path of [scratch,stage])if(path)try{rmSync(path,{recursive:true,force:true});}catch{}};
 const signals=['SIGINT','SIGTERM','SIGHUP'] as const;
 const detach=()=>{for(const signal of signals)process.off(signal,onSignal);process.off('exit',cleanup);};
 const onSignal=(signal:NodeJS.Signals)=>{cleanup();detach();if(process.listenerCount(signal)===0)process.kill(process.pid,signal);};
 for(const signal of signals)process.once(signal,onSignal);process.once('exit',cleanup);
 try{
  const info=await stat(source);assert(info.size>36,'TRANSFER_FORMAT','Encrypted transfer file is too short');const input=await open(source,constants.O_RDONLY|constants.O_NOFOLLOW);const header=Buffer.alloc(20),tag=Buffer.alloc(16);try{await input.read(header,0,20,0);await input.read(tag,0,16,info.size-16);}finally{await input.close();}assert(header.subarray(0,8).equals(MAGIC),'TRANSFER_FORMAT','Unknown transfer format');
  const decipher=createDecipheriv('aes-256-gcm',transferKey,header.subarray(8),{authTagLength:16});decipher.setAAD(MAGIC);decipher.setAuthTag(tag);let expanded=0;const limit=options.maxExpandedBytes??defaultExpandedLimit(info.size);const limiter=new Transform({transform(chunk,_encoding,callback){expanded+=chunk.length;if(expanded>limit)callback(new DomainError('TRANSFER_TOO_LARGE',`The archive expands beyond ${limit} bytes. If it is trusted, raise TRANSFER_MAX_EXPANDED_BYTES.`,413));else callback(null,chunk);}});const plain=join(scratch,'payload.jsonl');
  await pipeline(createReadStream(source,{start:20,end:info.size-17}),decipher,createGunzip(),limiter,createWriteStream(plain,{flags:'wx',mode:0o600}));
  stage=await mkdtemp(join(dirname(root),`.clinic-restore-${process.pid}-`));const recordFile=join(scratch,'records.jsonl');const output=await open(recordFile,'wx',0o600);const hashes=createHash('sha256');const counts:Record<string,number>={},blobs:{path:string;size:number;sha256:string}[]=[];const ids=new Set<string>(),paths=new Set<string>();let headerSeen=false,manifest:any,active:{path:string;expectedSize:number;size:number;hash:ReturnType<typeof createHash>}|undefined;let total=0;
  try{for await(const line of createInterface({input:createReadStream(plain),crlfDelay:Infinity})){
   assert(line.length<=4*1024*1024,'TRANSFER_FORMAT','Transfer entry exceeds 4 MiB');let entry:any;try{entry=JSON.parse(line);}catch{throw new Error('Transfer contains invalid JSON');}assert(!manifest,'TRANSFER_FORMAT','Data follows final manifest');
   if(entry.kind==='header'){assert(!headerSeen&&total===0&&!active,'TRANSFER_FORMAT','Invalid header order');assert(entry.schemaVersion===1&&entry.appKeyFingerprint===digest(appKey),'APP_KEY_MISMATCH','Restore requires the same APP_ENCRYPTION_KEY as the source installation');headerSeen=true;continue;}
   assert(headerSeen,'TRANSFER_FORMAT','Transfer header is missing');
   if(entry.kind==='record'){assert(!active,'TRANSFER_FORMAT','Record interrupts a file');validateRecord(entry);assert(!transient.has(entry.collection),'TRANSFER_RECORD','Archive includes transient authentication data');const identity=`${entry.collection}/${entry.record.id}`;assert(!ids.has(identity),'TRANSFER_DUPLICATE','Duplicate record in transfer');ids.add(identity);const encoded=JSON.stringify({collection:entry.collection,record:entry.record});hashes.update(encoded+'\n');await output.write(encoded+'\n');counts[entry.collection]=(counts[entry.collection]??0)+1;total++;}
   else if(entry.kind==='blob-start'){assert(!active,'TRANSFER_FORMAT','Overlapping files');const path=safePath(entry.path);assert(!paths.has(path)&&Number.isSafeInteger(entry.size)&&entry.size>=0,'TRANSFER_FORMAT','Invalid or duplicate file');paths.add(path);await mkdir(dirname(join(stage,path)),{recursive:true,mode:0o700});fileHandle=await open(join(stage,path),'wx',0o600);active={path,expectedSize:entry.size,size:0,hash:createHash('sha256')};}
   else if(entry.kind==='blob-chunk'){assert(active&&fileHandle&&typeof entry.data==='string'&&/^[A-Za-z0-9+/]*={0,2}$/.test(entry.data),'TRANSFER_FORMAT','Unexpected file chunk');const bytes=Buffer.from(entry.data,'base64');assert(bytes.length<=49152&&bytes.toString('base64')===entry.data,'TRANSFER_FORMAT','Malformed binary chunk');active.size+=bytes.length;assert(active.size<=active.expectedSize,'TRANSFER_FORMAT','File exceeds declared size');active.hash.update(bytes);await fileHandle.write(bytes);}
   else if(entry.kind==='blob-end'){assert(active&&fileHandle,'TRANSFER_FORMAT','Unexpected file end');await fileHandle.sync();await fileHandle.close();fileHandle=undefined;const sha256=active.hash.digest('hex');assert(entry.path===active.path&&entry.size===active.size&&active.size===active.expectedSize&&entry.sha256===sha256,'TRANSFER_CHECKSUM','File checksum mismatch');blobs.push({path:active.path,size:active.size,sha256});active=undefined;}
   else if(entry.kind==='manifest'){assert(!active,'TRANSFER_FORMAT','File is incomplete');manifest=entry;}
   else assert(false,'TRANSFER_FORMAT','Unknown transfer entry');
  }}finally{await output.close();}
  assert(manifest&&manifest.records===total&&manifest.recordsHash===hashes.digest('hex'),'TRANSFER_CHECKSUM','Record count or checksum mismatch');const normalizedCounts=Object.fromEntries(Object.entries(manifest.counts??{}).filter(([,value])=>value!==0));assert(JSON.stringify(normalizedCounts)===JSON.stringify(counts)&&JSON.stringify(manifest.files)===JSON.stringify(blobs),'TRANSFER_CHECKSUM','Collection or file manifest mismatch');
  // Validate every private-file reference before changing the target database.
  const fileMap=new Map(blobs.map(f=>[f.path,f]));for await(const line of createInterface({input:createReadStream(recordFile),crlfDelay:Infinity})){const item=JSON.parse(line) as Item;if(item.collection==='files'){const path=`files/${item.record.organizationId}/${item.record.id}`,blob=fileMap.get(path);assert(blob&&blob.sha256===item.record.sha256&&blob.size===item.record.size,'TRANSFER_REFERENCE','A private-file reference is missing or corrupted');}}
  await writeFile(join(stage,'.restore-incomplete'),JSON.stringify({startedAt:new Date().toISOString(),records:total}),{flag:'wx',mode:0o600});try{await rmdir(root);}catch(error:any){if(error.code!=='ENOENT')throw error;}await rename(stage,root);stage=undefined;
  const restoredHashes=new Map<string,string>();
  async function* restored():AsyncGenerator<Item>{for await(const line of createInterface({input:createReadStream(recordFile),crlfDelay:Infinity})){const item=JSON.parse(line) as Item;if(item.collection==='users')item.record={...item.record,sessionVersion:Number(item.record.sessionVersion??0)+1,lastMfaStep:Math.floor(Date.now()/30000)};restoredHashes.set(`${item.collection}/${item.record.id}`,digest(canonical(item.record)));yield item;}}
  await db.restoreEmpty(restored());const verifiedCounts:Record<string,number>={};for(const collection of await db.listCollections()){if(transient.has(collection))continue;let after:string|undefined;let count=0;for(;;){const page=await db.list(collection,{limit:10000,...(after?{after}:{})});count+=page.length;for(const record of page)assert(restoredHashes.get(`${collection}/${record.id}`)===digest(canonical(record)),'RESTORE_VERIFY','Restored record checksum differs from archive');if(page.length<10000)break;after=page[page.length-1].id;}if(count)verifiedCounts[collection]=count;}assert(JSON.stringify(Object.entries(verifiedCounts).sort())===JSON.stringify(Object.entries(counts).sort()),'RESTORE_VERIFY','Restored record counts differ from manifest');
  await rm(join(root,'.restore-incomplete'));return {records:total,collections:Object.keys(counts).length,files:blobs.length,sessionsInvalidated:true,outboundReviewRequired:true};
 }finally{detach();if(fileHandle)await fileHandle.close().catch(()=>{});if(stage)await rm(stage,{recursive:true,force:true});await rm(scratch,{recursive:true,force:true});}
}
