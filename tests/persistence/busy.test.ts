/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach,expect,test } from 'vitest';
import { DomainError } from '../../packages/contracts/src/index.js';
import { SqlDatabase } from '../../packages/persistence/src/sql.js';
import { FirestoreDatabase } from '../../packages/persistence/src/firestore.js';

const opened:SqlDatabase[]=[];
afterEach(async()=>{while(opened.length)await opened.pop()!.close();});
// The pool connects lazily, so replacing the transaction entry point exercises only the retry and error mapping.
function failingSql(errors:unknown[]){const db=new SqlDatabase('postgres','postgres://unused:unused@127.0.0.1:1/unused_test');opened.push(db);let calls=0;
 (db as any).connection={transaction:()=>({setIsolationLevel:()=>({execute:async()=>{calls++;throw errors[Math.min(calls,errors.length)-1];}})}),destroy:async()=>{}};return {db,calls:()=>calls};}
const sqlError=(code:string,extra:Record<string,unknown>={})=>Object.assign(new Error(code),{code,...extra});

test('SQL lock wait timeouts fail fast as BUSY instead of an internal error',async()=>{
 for(const error of [sqlError('55P03'),sqlError('ER_LOCK_WAIT_TIMEOUT',{errno:1205})]){const {db,calls}=failingSql([error]);await expect(db.transaction(['key'],async()=>1)).rejects.toMatchObject({code:'BUSY',status:503});expect(calls()).toBe(1);}
});
test('SQL deadlocks are retried, then reported as BUSY',async()=>{
 const {db,calls}=failingSql([sqlError('40P01')]);await expect(db.transaction(['key'],async()=>1)).rejects.toMatchObject({code:'BUSY',status:503});expect(calls()).toBe(8);
});
test('SQL domain and unrelated errors pass through unchanged',async()=>{
 const conflict=new DomainError('CONFLICT','Record changed',409);await expect(failingSql([conflict]).db.transaction([],async()=>1)).rejects.toBe(conflict);
 const broken=sqlError('42P01');await expect(failingSql([broken]).db.transaction([],async()=>1)).rejects.toBe(broken);
});
test('Firestore contention after SDK retries is reported as BUSY',async()=>{
 const db=new FirestoreDatabase('busy-mapping-test');const fail=(error:unknown)=>{(db as any).db={runTransaction:async()=>{throw error;}};};
 fail(Object.assign(new Error('10 ABORTED: Too much contention on these documents. Please try again.'),{code:10}));await expect(db.transaction(['key'],async()=>1)).rejects.toMatchObject({code:'BUSY',status:503});
 const limit=new DomainError('TRANSACTION_LIMIT','Too many writes',413);fail(limit);await expect(db.transaction(['key'],async()=>1)).rejects.toBe(limit);
 const denied=Object.assign(new Error('7 PERMISSION_DENIED'),{code:7});fail(denied);await expect(db.transaction(['key'],async()=>1)).rejects.toBe(denied);
});
