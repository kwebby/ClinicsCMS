/* Author: ramanpal singh | URL: https://kwebby.com */
import { spawn } from 'node:child_process';
import { mkdir,mkdtemp,readFile,writeFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { certificationProfiles,serverVersion } from '../tests/persistence/profiles.js';

const profiles=certificationProfiles();
const output=resolve(process.env.CERTIFICATION_REPORT??`artifacts/certification/report-${new Date().toISOString().replaceAll(':','-')}.json`);
const temporary=await mkdtemp(join(tmpdir(),'clinic-certification-'));
const runs:Record<string,unknown>[]=[];
try{
 for(const profile of profiles){
  let version='unavailable',versionError:string|undefined;
  const db=profile.create();try{await db.initialize();version=await serverVersion(db);}catch(error){versionError=error instanceof Error?error.message:'Connection failed';}finally{await db.close().catch(()=>{});}
  const resultPath=join(temporary,`${profile.name}.json`);const startedAt=new Date().toISOString();
  const exitCode=await new Promise<number>(resolveExit=>{
   const child=spawn(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','tests/persistence/contract.test.ts','--reporter=json',`--outputFile=${resultPath}`],{cwd:process.cwd(),env:{...process.env,CERTIFICATION_PROFILE:profile.name},stdio:['ignore','inherit','inherit']});child.on('error',()=>resolveExit(1));child.on('close',code=>resolveExit(code??1));
  });
  let results:any={};try{results=JSON.parse(await readFile(resultPath,'utf8'));}catch{}
  runs.push({profile:profile.name,driver:profile.driver,target:profile.target,emulated:profile.emulated,serverVersion:version,...(versionError?{connectionError:versionError}:{}),startedAt,finishedAt:new Date().toISOString(),status:exitCode===0&&results.success?'passed':'failed',tests:results.numTotalTests??0,passed:results.numPassedTests??0,failed:results.numFailedTests??0,scenarios:results.testResults?.flatMap((r:any)=>r.assertionResults?.map((a:any)=>({name:a.fullName,status:a.status,failureMessages:a.failureMessages})))??[]});
 }
 const passed=(driver:string,major?:string)=>runs.some(r=>r.driver===driver&&!r.emulated&&r.status==='passed'&&(!major||new RegExp(`(?:PostgreSQL )?${major.replace('.','\\.')}[.\\s-]`).test(String(r.serverVersion))));
 const gates=[
  {gate:'PostgreSQL 17 domain and persistence contract',status:passed('postgres','17')?'passed':'pending'},
  {gate:'PostgreSQL 18 domain and persistence contract',status:passed('postgres','18')?'passed':'pending'},
  {gate:'MySQL 8.4 domain and persistence contract',status:passed('mysql','8.4')?'passed':'pending'},
  {gate:'Supabase target domain and persistence contract',status:passed('supabase')?'passed':'pending'},
  {gate:'Real Cloud Firestore domain and persistence contract',status:passed('firestore')?'passed':'pending'},
  {gate:'Nginx and Apache production HTTPS/WebSocket deployment matrix',status:'pending'},
  {gate:'Paired database/file total-server recovery exercise and <=1h measured recovery point',status:'pending'},
  {gate:'Independent penetration test and remediation retest',status:'pending'},
  {gate:'Clinical workflow sign-off and localized regulatory profile',status:'pending'},
  {gate:'Payment merchant sandbox and live-webhook provider certification',status:'pending'},
 ];
 const report={schemaVersion:1,generatedAt:new Date().toISOString(),runtime:process.version,releaseStatus:'NOT_APPROVED_FOR_CLINIC_PILOT',note:'Passing adapter contracts is evidence for these scenarios only. In-memory or emulator runs do not certify production backends. External release gates remain pending until evidence from the actual deployment is recorded.',runs,gates};
 await mkdir(resolve(output,'..'),{recursive:true});await writeFile(output,JSON.stringify(report,null,2)+'\n',{mode:0o600});console.log(`Certification evidence written to ${output}`);console.log('Clinic pilot approval remains blocked by pending external release gates.');if(runs.some(r=>r.status==='failed'))process.exitCode=1;
}finally{await rm(temporary,{recursive:true,force:true});}
