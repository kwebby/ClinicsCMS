/* Author: ramanpal singh | URL: https://kwebby.com */
import { assert,type Entity,type FilterValue,type Repository } from '../../../packages/contracts/src/index.js';

/** Yields every matching row in id-ordered pages instead of relying on an adapter's silent row cap. */
export async function* pages<T extends Entity=Entity>(db:Pick<Repository,'list'>,collection:string,eq:Record<string,FilterValue>,size=1000):AsyncGenerator<T[]>{
 let after:string|undefined;
 for(;;){const batch=await db.list<T>(collection,{eq,limit:size,...(after?{after}:{})});if(batch.length)yield batch;if(batch.length<size)return;const next=batch[batch.length-1].id;if(next===after)throw new Error('Pagination did not advance');after=next;}
}
export async function listAll<T extends Entity=Entity>(db:Pick<Repository,'list'>,collection:string,eq:Record<string,FilterValue>,size=1000):Promise<T[]>{const rows:T[]=[];for await(const batch of pages<T>(db,collection,eq,size))rows.push(...batch);return rows;}
/** Validated `limit` (1-500, default 100) and `after` for admin list endpoints. */
export function pageQuery(query:Record<string,unknown>={}):{limit:number;after?:string}{
 const limit=query.limit===undefined?100:Number(query.limit);const after=query.after;
 assert(Number.isInteger(limit)&&limit>=1&&limit<=500,'QUERY','limit must be between 1 and 500');
 assert(after===undefined||(typeof after==='string'&&after.length>0&&after.length<=200),'QUERY','Invalid page cursor');
 return {limit,...(after?{after}:{})};
}
