/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach,beforeEach,describe,expect,test } from 'vitest';
import { createHash,randomBytes } from 'node:crypto';
import { mkdtemp,mkdir,readFile,readdir,rm,stat,writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { MemoryDatabase } from '../../packages/persistence/src/index.js';
import { exportInstallation,importInstallation,defaultExpandedLimit,type TransferOptions } from '../../packages/persistence/src/transfer.js';
import type { Entity } from '../../packages/contracts/src/index.js';
let directory:string,source:MemoryDatabase,target:MemoryDatabase,options:TransferOptions;
const entity=(id:string,extra:Record<string,unknown>={}):Entity=>({id,organizationId:'test-clinic',version:1,createdAt:'2026-10-09T10:00:00Z',updatedAt:'2026-10-09T10:00:00Z',...extra});
beforeEach(async()=>{directory=await mkdtemp(join(tmpdir(),'transfer-test-'));source=new MemoryDatabase();target=new MemoryDatabase();options={database:source,storageRoot:join(directory,'source-files'),file:join(directory,'clinic.backup'),transferKey:randomBytes(32).toString('base64'),appEncryptionKey:randomBytes(32).toString('base64'),maintenance:true,outboundEnabled:false};});
afterEach(async()=>{await rm(directory,{recursive:true,force:true});});
async function seed(){
 const bytes=randomBytes(120000);await mkdir(join(options.storageRoot,'files','test-clinic'),{recursive:true});await writeFile(join(options.storageRoot,'files','test-clinic','file-one'),bytes);
 const records=[{collection:'users',record:entity('user-one',{version:7,sessionVersion:4,name:'Example',mfaSecret:'still encrypted'})},{collection:'invoices',record:entity('invoice-one',{version:4,status:'issued',snapshot:{currency:'KWD',total:'123.456',lines:[{description:'Immutable',amount:'123.456'}]}})},{collection:'futureModule',record:entity('future-one',{version:9,extra:[1,null,false,{text:'Résumé'}]})},{collection:'files',record:entity('file-one',{sha256:createHash('sha256').update(bytes).digest('hex'),size:bytes.length,storageKey:'test-clinic/file-one'})},{collection:'outbox',record:entity('event-one',{status:'pending',type:'invoice.issued',payload:{invoiceId:'invoice-one'}})},{collection:'authTokens',record:entity('token-one',{purpose:'reset-password',token:'must-be-omitted'})}];
 await source.restoreEmpty(records);return {bytes,records};
}
describe('encrypted portable offline transfer',()=>{
 test('preserves IDs/versions/financial snapshots and local blobs, discovers future collections, invalidates sessions',async()=>{const fixture=await seed();const exported=await exportInstallation(options);expect(exported.records).toBe(5);const archive=await readFile(options.file);expect(archive.includes(Buffer.from('Immutable'))).toBe(false);const imported=await importInstallation({...options,database:target,storageRoot:join(directory,'target-files')});expect(imported).toMatchObject({records:5,files:1,sessionsInvalidated:true,outboundReviewRequired:true});expect(await target.get('invoices','invoice-one')).toEqual(fixture.records[1].record);expect(await target.get('futureModule','future-one')).toEqual(fixture.records[2].record);expect(await target.get('users','user-one')).toMatchObject({version:7,sessionVersion:5,mfaSecret:'still encrypted'});expect(await target.get('authTokens','token-one')).toBeNull();expect(await readFile(join(directory,'target-files','files','test-clinic','file-one'))).toEqual(fixture.bytes);expect(await target.get('outbox','event-one')).toMatchObject({status:'pending'});});
 test('refuses live/outbound-enabled operations and non-empty targets',async()=>{await seed();await expect(exportInstallation({...options,maintenance:false})).rejects.toMatchObject({code:'MAINTENANCE_REQUIRED'});await expect(exportInstallation({...options,outboundEnabled:true})).rejects.toMatchObject({code:'MAINTENANCE_REQUIRED'});await exportInstallation(options);await target.put('patients',entity('existing'));await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files')})).rejects.toMatchObject({code:'RESTORE_TARGET_NOT_EMPTY'});});
 test('tampered ciphertext and a wrong transfer key leave target unchanged',async()=>{await seed();await exportInstallation(options);await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files'),transferKey:randomBytes(32).toString('base64')})).rejects.toThrow();expect(await target.listCollections()).toEqual([]);const bytes=await readFile(options.file);bytes[30]^=0xff;await writeFile(options.file,bytes);await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files')})).rejects.toThrow();expect(await target.listCollections()).toEqual([]);});
 test('truncated authentication tags are rejected before target mutation',async()=>{await seed();await exportInstallation(options);const bytes=await readFile(options.file);await writeFile(options.file,bytes.subarray(0,bytes.length-4));await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files')})).rejects.toThrow();expect(await target.listCollections()).toEqual([]);});
 test('requires source encryption key so encrypted integrations remain decryptable',async()=>{await seed();await exportInstallation(options);await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files'),appEncryptionKey:randomBytes(32).toString('base64')})).rejects.toMatchObject({code:'APP_KEY_MISMATCH'});expect(await target.listCollections()).toEqual([]);});
 test('missing file references fail before modifying target database',async()=>{await source.put('files',entity('missing',{storageKey:'test-clinic/missing',sha256:'f'.repeat(64),size:10}));await exportInstallation(options);await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files')})).rejects.toMatchObject({code:'TRANSFER_REFERENCE'});expect(await target.listCollections()).toEqual([]);});
 test('interrupted low-level restore retains marker and never claims completion',async()=>{await seed();await exportInstallation(options);target.restoreEmpty=async()=>{throw new Error('Simulated disk failure');};await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files')})).rejects.toThrow('Simulated disk failure');expect(JSON.parse(await readFile(join(directory,'target-files','.restore-incomplete'),'utf8')).records).toBe(5);});
 test('decrypts only into a private scratch directory beside storage, removed after import',async()=>{
  await seed();await exportInstallation(options);const scratch=join(directory,'scratch');let seen:{mode:number;files:number[]}|undefined;const restore=target.restoreEmpty.bind(target);
  target.restoreEmpty=async records=>{const [name]=(await readdir(scratch)).filter(n=>n.startsWith(`.clinic-import-${process.pid}-`));const path=join(scratch,name);seen={mode:(await stat(path)).mode&0o777,files:await Promise.all((await readdir(path)).map(async f=>(await stat(join(path,f))).mode&0o777))};return restore(records);};
  await importInstallation({...options,database:target,storageRoot:join(directory,'target-files'),scratchDir:scratch});
  expect(seen).toEqual({mode:0o700,files:[0o600,0o600]});expect(await readdir(scratch)).toEqual([]);
  expect((await readdir(directory)).filter(n=>n.startsWith('.clinic-'))).toEqual([]);
  await expect(importInstallation({...options,database:new MemoryDatabase(),storageRoot:join(directory,'other-files'),scratchDir:join(directory,'other-files','tmp')})).rejects.toMatchObject({code:'TRANSFER_PATH'});
 });
 test('removes decrypted leftovers of crashed imports but never those of a running import',async()=>{
  await seed();await exportInstallation(options);const scratch=join(directory,'scratch');
  const crashed=join(scratch,'.clinic-import-2147483646-AbC123'),running=join(scratch,`.clinic-import-${process.pid}-XyZ789`),legacyStage=join(directory,'.clinic-restore-q1W2e3');
  for(const path of [crashed,running,legacyStage]){await mkdir(path,{recursive:true});await writeFile(join(path,'payload.jsonl'),'plaintext');}
  await importInstallation({...options,database:target,storageRoot:join(directory,'target-files'),scratchDir:scratch});
  await expect(stat(crashed)).rejects.toMatchObject({code:'ENOENT'});await expect(stat(legacyStage)).rejects.toMatchObject({code:'ENOENT'});expect((await stat(running)).isDirectory()).toBe(true);
 });
 test('termination signals remove decrypted scratch data immediately',async()=>{
  await seed();await exportInstallation(options);const scratch=join(directory,'scratch');const keepAlive=()=>{};process.on('SIGTERM',keepAlive);const before=process.listenerCount('SIGTERM');let during=0;
  try{
   target.restoreEmpty=async()=>{during=process.listenerCount('SIGTERM');process.emit('SIGTERM','SIGTERM');expect(await readdir(scratch)).toEqual([]);throw new Error('Interrupted by test signal');};
   await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files'),scratchDir:scratch})).rejects.toThrow('Interrupted by test signal');
   expect(during).toBe(before+1);expect(process.listenerCount('SIGTERM')).toBe(before);
  }finally{process.off('SIGTERM',keepAlive);}
 });
 test('decompression is capped, by default relative to the archive size',async()=>{
  expect(defaultExpandedLimit(1)).toBe(2*1024**3);expect(defaultExpandedLimit(1024**3)).toBe(32*1024**3);
  await seed();await exportInstallation(options);
  await expect(importInstallation({...options,database:target,storageRoot:join(directory,'target-files'),maxExpandedBytes:1024})).rejects.toMatchObject({code:'TRANSFER_TOO_LARGE',status:413});expect(await target.listCollections()).toEqual([]);
 });
});
