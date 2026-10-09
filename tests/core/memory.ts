/* Author: ramanpal singh | URL: https://kwebby.com */
import type { Database, Entity, Query, Repository } from '../../packages/contracts/src/index.js';
import { DomainError } from '../../packages/contracts/src/index.js';
export class MemoryDatabase implements Database {
 driver='test-memory'; data=new Map<string,Entity>(); private tail:Promise<void>=Promise.resolve();
 async initialize(){} async close(){}
 async get<T extends Entity=Entity>(collection:string,id:string):Promise<T|null>{const v=this.data.get(`${collection}/${id}`);return v?structuredClone(v) as T:null;}
 async list<T extends Entity=Entity>(collection:string,query:Query={}):Promise<T[]>{return [...this.data.entries()].filter(([key])=>key.startsWith(collection+'/')).map(([,v])=>structuredClone(v) as T).filter(v=>Object.entries(query.eq||{}).every(([k,val])=>v[k]===val)).filter(v=>!query.after||v.id>query.after).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,query.limit??10000);}
 async put<T extends Entity=Entity>(collection:string,value:T,expectedVersion?:number):Promise<T>{const existing=await this.get(collection,value.id);if(expectedVersion===undefined?!!existing:!existing||existing.version!==expectedVersion||value.version!==expectedVersion+1)throw new DomainError('CONFLICT','Version conflict',409);this.data.set(`${collection}/${value.id}`,structuredClone(value));return structuredClone(value);}
 async remove(collection:string,id:string,expectedVersion?:number){const existing=await this.get(collection,id);if(!existing||expectedVersion!==undefined&&existing.version!==expectedVersion)throw new DomainError('CONFLICT','Version conflict',409);this.data.delete(`${collection}/${id}`);}
 async transaction<T>(_keys:string[],fn:(tx:Repository)=>Promise<T>):Promise<T>{let release!:()=>void;const wait=this.tail;this.tail=new Promise<void>(r=>release=r);await wait;const snapshot=structuredClone(this.data);try{return await fn(this);}catch(error){this.data=snapshot;throw error;}finally{release();}}
}
