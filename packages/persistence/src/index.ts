/* Author: ramanpal singh | URL: https://kwebby.com */
import type { Database } from '../../contracts/src/index.js';
import { SqlDatabase } from './sql.js';
import { FirestoreDatabase } from './firestore.js';
import { MemoryDatabase } from './memory.js';
export { SqlDatabase, FirestoreDatabase, MemoryDatabase };
export function createDatabase(env:NodeJS.ProcessEnv=process.env):Database {
 const driver=env.DATABASE_DRIVER??'postgres';
 if(['postgres','mysql','supabase'].includes(driver))return new SqlDatabase(driver as 'postgres'|'mysql'|'supabase',env.DATABASE_URL??'');
 if(driver==='firestore')return new FirestoreDatabase(env.FIREBASE_PROJECT_ID??'',env.FIREBASE_DATABASE_ID);
 if(driver==='memory' && env.NODE_ENV==='test')return new MemoryDatabase();
 throw new Error('Select DATABASE_DRIVER=postgres|mysql|supabase|firestore. Memory is test-only.');
}
