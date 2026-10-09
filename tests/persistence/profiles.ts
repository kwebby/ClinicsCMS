/* Author: ramanpal singh | URL: https://kwebby.com */
import { createDatabase, MemoryDatabase, SqlDatabase } from '../../packages/persistence/src/index.js';
import type { Database } from '../../packages/contracts/src/index.js';
export interface CertificationProfile {name:string;driver:string;emulated:boolean;target:string;expectedMajor?:string;create:()=>Database;}
/** Explicit test targets only: production DATABASE_URL/FIREBASE_PROJECT_ID are never read. */
export function certificationProfiles(env:NodeJS.ProcessEnv=process.env):CertificationProfile[]{
 const profiles:CertificationProfile[]=[{name:'memory-contract',driver:'memory',emulated:true,target:'ephemeral memory',create:()=>new MemoryDatabase()}];
 if(env.DATABASE_TEST_URL||env.DATABASE_TEST_DRIVER){
  if(!env.DATABASE_TEST_URL||!['postgres','mysql','supabase'].includes(env.DATABASE_TEST_DRIVER??''))throw new Error('Both DATABASE_TEST_URL and DATABASE_TEST_DRIVER=postgres|mysql|supabase are required.');
  if(env.DATABASE_TEST_CONFIRM!=='disposable')throw new Error('Set DATABASE_TEST_CONFIRM=disposable for a dedicated disposable test database.');
  const url=new URL(env.DATABASE_TEST_URL);const database=decodeURIComponent(url.pathname.replace(/^\//,''));
  if(!/(^|[_-])(test|cert|certification)([_-]|$)/i.test(database))throw new Error('The test database name must contain a separate test, cert, or certification segment.');
  const driver=env.DATABASE_TEST_DRIVER as 'postgres'|'mysql'|'supabase';
  if(driver==='mysql'&&!['mysql:','mysql2:'].includes(url.protocol)||driver!=='mysql'&&!['postgres:','postgresql:'].includes(url.protocol))throw new Error('Test URL protocol does not match its database driver.');
  profiles.push({name:`${driver}-${env.DATABASE_TEST_EXPECTED_MAJOR??'configured'}`,driver,emulated:false,target:`${url.hostname}:${url.port|| (driver==='mysql'?'3306':'5432')}/${database}`,expectedMajor:env.DATABASE_TEST_EXPECTED_MAJOR,create:()=>createDatabase({...env,DATABASE_DRIVER:driver,DATABASE_URL:env.DATABASE_TEST_URL})});
 }
 if(env.FIREBASE_TEST_PROJECT_ID){
  if(env.FIREBASE_TEST_CONFIRM!=='disposable')throw new Error('Set FIREBASE_TEST_CONFIRM=disposable for the dedicated test project.');
  const allowlist=(env.FIREBASE_TEST_PROJECT_ALLOWLIST??'').split(',').map(v=>v.trim()).filter(Boolean);
  if(!allowlist.includes(env.FIREBASE_TEST_PROJECT_ID))throw new Error('FIREBASE_TEST_PROJECT_ID must exactly match FIREBASE_TEST_PROJECT_ALLOWLIST.');
  profiles.push({name:env.FIRESTORE_EMULATOR_HOST?'firestore-emulator':'firestore-real',driver:'firestore',emulated:!!env.FIRESTORE_EMULATOR_HOST,target:`${env.FIREBASE_TEST_PROJECT_ID}/${env.FIREBASE_TEST_DATABASE_ID??'(default)'}`,create:()=>createDatabase({...env,DATABASE_DRIVER:'firestore',FIREBASE_PROJECT_ID:env.FIREBASE_TEST_PROJECT_ID,FIREBASE_DATABASE_ID:env.FIREBASE_TEST_DATABASE_ID??'(default)'})});
 }
 const selected=env.CERTIFICATION_PROFILE;
 if(selected){const found=profiles.filter(p=>p.name===selected);if(found.length!==1)throw new Error(`Unknown certification profile: ${selected}`);return found;}
 return profiles;
}
export const parityCollections=['patients','appointments','encounters','prescriptions','results','referrals','tasks','leads','employees','invoices','payments','refunds','payroll','documents','pages','templates','themes','publications','conversations','messages','notifications','consents','settings','availability','leave','services','users','userEmails','sessions','invitations','authTokens','files','audit','outbox','integrations','preferences','revisions','pageRoutes','counters','creditNotes','paymentAttempts','refundRequests','webhookEvents','certificationProbe','publicAssets','aiDrafts','aiUsage','notificationDeliveries','mailDeliveries'] as const;
export async function serverVersion(db:Database):Promise<string>{
 if(db instanceof SqlDatabase){const {sql}=await import('kysely');const result=await sql<{version:string}>`select version() as version`.execute(db.connection);return String(result.rows[0]?.version??'unknown');}
 return db.driver==='firestore'?(process.env.FIRESTORE_EMULATOR_HOST?'Firestore emulator':'Cloud Firestore native client'):'in-memory contract runner';
}
