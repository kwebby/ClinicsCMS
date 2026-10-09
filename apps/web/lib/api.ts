/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import type {RecordData} from './types';
import {collectPages,listPath,type ListPage,type ListQuery} from './records';
export class ApiError extends Error { constructor(message:string, public code:string, public status:number) { super(message); this.name='ApiError'; } }
let csrfToken = '';
export const setCsrf = (token:string) => { csrfToken=token; };
let sessionExpired:(()=>void)|null=null;
/** Called when the API reports that the signed-in session no longer exists. */
export const onSessionExpired = (handler:(()=>void)|null) => { sessionExpired=handler; };
async function request(path:string, options:{method?:string;body?:unknown;signal?:AbortSignal}={}):Promise<{data?:unknown;next?:unknown}> {
  const method = options.method || 'GET'; const multipart=options.body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, { method, credentials:'same-origin', cache:'no-store', signal:options.signal, headers:{...(multipart?{}:{'Content-Type':'application/json'}),...(method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})}, body:options.body===undefined?undefined:multipart?options.body as FormData:JSON.stringify(options.body) });
  const result=await response.json().catch(()=>({error:{message:'The server returned an unreadable response.',code:'INVALID_RESPONSE'}}));
  // Wrong passwords and MFA codes are also 401s; only a missing session means the sign-in expired.
  if(response.status===401&&result.error?.code==='UNAUTHENTICATED')sessionExpired?.();
  if(!response.ok) throw new ApiError(result.error?.message||'Request failed. Please try again.',result.error?.code||'REQUEST_FAILED',response.status);
  return result;
}
export async function api<T=unknown>(path:string, options:{method?:string;body?:unknown;signal?:AbortSignal}={}):Promise<T> { return (await request(path,options)).data as T; }
/** A list page with the server's continuation cursor when the response carries a top-level `next`. */
export async function apiPage(path:string, signal?:AbortSignal):Promise<ListPage> { const result=await request(path,{signal}); return {data:Array.isArray(result.data)?result.data as RecordData[]:[],...(typeof result.next==='string'&&result.next?{next:result.next}:{})}; }
export const action = <T=unknown>(name:string, body:unknown) => api<T>(`/actions/${encodeURIComponent(name)}`,{method:'POST',body});
/** Every matching record, 500 per request; `max` bounds the total for views that cannot page. */
export const allRecords = (collection:string,query:Omit<ListQuery,'limit'|'after'>={},signal?:AbortSignal,max?:number) => collectPages(after=>apiPage(listPath(collection,{...query,limit:500,after}),signal),500,max);
/** Display names for referenced records, one request per id (no list endpoint filters by many ids). Missing or forbidden ids are skipped. */
export async function recordNames(collection:string,ids:string[],signal?:AbortSignal):Promise<Record<string,string>> {
  const names:Record<string,string>={},queue=[...new Set(ids)];
  await Promise.all(Array.from({length:Math.min(6,queue.length)},async()=>{for(let id=queue.shift();id;id=queue.shift()){try{const row=await api<RecordData>(`/records/${encodeURIComponent(collection)}/${encodeURIComponent(id)}`,{signal});names[id]=displayName(row)}catch{if(signal?.aborted)return}}}));
  return names;
}
export const errorMessage = (e:unknown) => e instanceof Error?e.message:'Something went wrong. Try again.';
export function formatValue(value:unknown):string { if(value===undefined||value===null||value==='')return '—'; if(typeof value==='boolean')return value?'Yes':'No'; if(Array.isArray(value))return value.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(', '); if(typeof value==='object')return JSON.stringify(value); return String(value); }
export function displayName(item:Record<string,unknown>):string { return String(item.name||item.title||item.fullName||item.number||item.email||item.subject||item.id||''); }
