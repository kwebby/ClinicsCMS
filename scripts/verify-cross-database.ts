/* Author: ramanpal singh | URL: https://kwebby.com */
import { randomBytes,createHash,randomUUID } from 'node:crypto';
import { mkdir,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { join,resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { deepStrictEqual, ok } from 'node:assert';
import pg from 'pg';
import mysql from 'mysql2/promise';
import { SqlDatabase } from '../packages/persistence/src/index.js';
import { exportInstallation,importInstallation } from '../packages/persistence/src/transfer.js';
import { ClinicService } from '../packages/core/src/index.js';
import type { Actor,Entity } from '../packages/contracts/src/index.js';
import { serverVersion } from '../tests/persistence/profiles.js';

if(process.env.CROSS_DATABASE_CONFIRM!=='disposable')throw new Error('Set CROSS_DATABASE_CONFIRM=disposable to use local clinic_transfer_cert databases.');
if(!process.version.startsWith('v24.'))throw new Error('Run this verification with the project Node.js 24 runtime.');
const user=process.env.USER??'ramanpalsingh',databaseName='clinic_transfer_cert';
for(const port of [55433,55434]){const admin=new pg.Client({host:'127.0.0.1',port,database:'postgres',user});try{await admin.connect();const existing=await admin.query('SELECT 1 FROM pg_database WHERE datname=$1',[databaseName]);if(!existing.rowCount)await admin.query(`CREATE DATABASE ${databaseName}`);}finally{await admin.end();}}
const admin=await mysql.createConnection({host:'127.0.0.1',port:53306,user:'root'});try{await admin.query(`CREATE DATABASE IF NOT EXISTS ${databaseName} CHARACTER SET utf8mb4 COLLATE utf8mb4_bin`);}finally{await admin.end();}
const dbs=[new SqlDatabase('postgres',`postgresql://${encodeURIComponent(user)}@127.0.0.1:55433/${databaseName}`),new SqlDatabase('mysql',`mysql://root@127.0.0.1:53306/${databaseName}`),new SqlDatabase('postgres',`postgresql://${encodeURIComponent(user)}@127.0.0.1:55434/${databaseName}`)];
const scratch=await mkdtemp(join(tmpdir(),'clinic-cross-database-')),organizationId=`transfer-${randomUUID()}`;
const actor:Actor={id:'transfer-doctor',organizationId,roles:['owner','doctor'],branchIds:['main'],patientIds:[],name:'Synthetic transfer doctor',email:'transfer@example.test'};
const row=(id:string,data:Record<string,unknown>={}):Entity=>({id,organizationId,version:1,createdAt:new Date().toISOString(),updatedAt:new Date().toISOString(),...data});
const appEncryptionKey=randomBytes(32).toString('base64'),transferKey=randomBytes(32).toString('base64');
const report:Record<string,unknown>={generatedAt:new Date().toISOString(),runtime:process.version,status:'failed',path:['PostgreSQL 17','MySQL 8.4','PostgreSQL 18'],releaseStatus:'NOT_APPROVED_FOR_CLINIC_PILOT',steps:[]};
async function inventory(db:SqlDatabase){const records:Record<string,Entity>={};for(const collection of await db.listCollections()){if(['authTokens','sessions','invitations'].includes(collection))continue;for(const record of await db.list(collection,{limit:10000}))records[`${collection}/${record.id}`]=record;}return records;}
try{
 for(const db of dbs){await db.initialize();for(const collection of await db.listCollections())if((await db.list(collection,{limit:1})).length)throw new Error('A local transfer test database is not empty; refusing to replace its contents.');}
 report.versions=await Promise.all(dbs.map(db=>serverVersion(db)));
 const core=new ClinicService(dbs[0]);await dbs[0].put('users',row(actor.id,{...actor,status:'active',sessionVersion:7}));
 await core.create('settings',{key:'business',value:{clinicName:'Synthetic transfer clinic',country:'US',currency:'USD',timezone:'UTC',locale:'en-US',address:'Synthetic address',email:'transfer@example.test',phone:'000000',businessIds:{test:'Synthetic identifier'}}},actor);
 const patient=await core.create('patients',{branchId:'main',name:'Synthetic transfer patient'},actor);
 const privateBytes=randomBytes(96000),sha256=createHash('sha256').update(privateBytes).digest('hex');const sourceRoot=join(scratch,'postgres17-files');await mkdir(join(sourceRoot,'files',organizationId),{recursive:true});await writeFile(join(sourceRoot,'files',organizationId,'fixture-file'),privateBytes);
 await dbs[0].put('files',row('fixture-file',{scope:'clinical',patientId:patient.id,ownerId:actor.id,storageKey:`${organizationId}/fixture-file`,sha256,size:privateBytes.length,scanStatus:'clean',mime:'application/octet-stream',visibility:'private'}));
 const content=[{type:'paragraph',content:[{type:'text',text:'Synthetic signed clinical record.',styles:{}}],props:{},children:[]},{type:'file',props:{url:'/api/v1/files/fixture-file',name:'Synthetic transport fixture'},content:[],children:[]}];
 const encounter=await core.create('encounters',{branchId:'main',patientId:patient.id,doctorId:actor.id,content},actor);await core.execute('encounters.sign',{id:encounter.id,expectedVersion:1},actor);await core.execute('encounters.amend',{id:encounter.id,expectedVersion:2,reason:'Synthetic amendment',content},actor);
 const template=await core.create('templates',{name:'Transfer invoice',kind:'invoice',design:{accent:'#126b5e',font:'system',showLogo:false,columns:['description','quantity','unitPrice','tax','total']}},actor);await core.execute('templates.publish',{id:template.id,expectedVersion:1},actor);
 const draft=await core.create('invoices',{branchId:'main',patientId:patient.id,currency:'USD',templateId:template.id,lines:[{description:'Synthetic service',quantity:'2',unitPrice:'37.15',discount:'1.05',taxRate:'8.25'}]},actor);const issued=await core.execute('invoices.issue',{id:draft.id,expectedVersion:1},actor);const payment=await core.execute('payments.record',{invoiceId:issued.id,amount:'20.00',method:'bank',reference:'Synthetic transfer receipt',idempotencyKey:'cross-transfer-payment'},actor);await core.execute('refunds.record',{paymentId:payment.id,amount:'1.23',reason:'Synthetic refund',idempotencyKey:'cross-transfer-refund'},actor);await core.execute('invoices.credit',{invoiceId:issued.id,amount:'3.21',reason:'Synthetic credit',idempotencyKey:'cross-transfer-credit'},actor);
 const employee=await core.create('employees',{branchId:'main',userId:actor.id,name:'Synthetic employee',email:'employee@example.test',jobTitle:'Synthetic clinician',salary:{currency:'KWD',base:'123.450',earnings:[{label:'Synthetic allowance',amount:'2.100'}],deductions:[{label:'Synthetic deduction',amount:'1.010'}]}},actor);const payroll=await core.create('payroll',{branchId:'main',period:'2026-10',employeeIds:[employee.id]},actor);await core.execute('payroll.approve',{id:payroll.id,expectedVersion:1},actor);
 await dbs[0].put('futureModule',row('nested-json',{table:[[{text:'nested'}],[{value:'123.456'}]],money:'999.999'}));const nested=await dbs[0].get('futureModule','nested-json');ok(nested);await dbs[0].put('futureModule',{...nested,version:2},1);await dbs[0].put('authTokens',row('omitted-token',{purpose:'reset-password',opaque:'synthetic-invalid-token'}));
 const before=await inventory(dbs[0]);const baseOptions={transferKey,appEncryptionKey,maintenance:true,outboundEnabled:false};const archive1=join(scratch,'postgres17.backup');const exported1=await exportInstallation({...baseOptions,database:dbs[0],storageRoot:sourceRoot,file:archive1});const mysqlRoot=join(scratch,'mysql-files');const imported1=await importInstallation({...baseOptions,database:dbs[1],storageRoot:mysqlRoot,file:archive1});
 const archive2=join(scratch,'mysql.backup');const exported2=await exportInstallation({...baseOptions,database:dbs[1],storageRoot:mysqlRoot,file:archive2});const targetRoot=join(scratch,'postgres18-files');const imported2=await importInstallation({...baseOptions,database:dbs[2],storageRoot:targetRoot,file:archive2});const after=await inventory(dbs[2]);
 deepStrictEqual(Object.keys(before).sort(),Object.keys(after).sort());for(const [identity,record]of Object.entries(before)){if(identity.startsWith('users/')){const actual={...after[identity]};const expected={...record,sessionVersion:Number(record.sessionVersion??0)+2,lastMfaStep:actual.lastMfaStep};deepStrictEqual(actual,expected);}else deepStrictEqual(after[identity],record);}
 deepStrictEqual(await readFile(join(mysqlRoot,'files',organizationId,'fixture-file')),privateBytes);deepStrictEqual(await readFile(join(targetRoot,'files',organizationId,'fixture-file')),privateBytes);
 report.status='passed';report.records=Object.keys(after).length;report.collections=(await dbs[2].listCollections()).length;report.files=1;report.assertions={everyDurableRecordDeepEqual:true,clinicalSignaturesAndAmendmentsPreserved:true,invoiceAndCreditSnapshotsPreserved:true,payslipThreeDecimalAmountsPreserved:true,idsAndVersionsPreserved:true,nestedArraysPreserved:true,privateBlobSha256Preserved:sha256,sessionsInvalidatedAtEachImport:true,transientAuthTokensOmitted:(await dbs[2].get('authTokens','omitted-token'))===null};report.steps=[{source:'PostgreSQL 17',target:'MySQL 8.4',exportedRecords:exported1.records,importedRecords:imported1.records},{source:'MySQL 8.4',target:'PostgreSQL 18',exportedRecords:exported2.records,importedRecords:imported2.records}];
}catch(error){report.error=error instanceof Error?error.message:'Verification failed';process.exitCode=1;}finally{
 await mkdir('artifacts/verification',{recursive:true});await writeFile('artifacts/verification/cross-database-transfer.json',JSON.stringify(report,null,2)+'\n',{mode:0o600});
 for(const db of dbs){try{for(const collection of await db.listCollections())for(const record of await db.list(collection,{eq:{organizationId},limit:10000}))await db.remove(collection,record.id,record.version);}finally{await db.close();}}
 await rm(scratch,{recursive:true,force:true});console.log(`Cross-database transfer: ${report.status}. Evidence: artifacts/verification/cross-database-transfer.json`);
}
