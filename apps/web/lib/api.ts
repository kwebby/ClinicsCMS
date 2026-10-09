/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
export class ApiError extends Error { constructor(message:string, public code:string, public status:number) { super(message); this.name='ApiError'; } }
let csrfToken = '';
export const setCsrf = (token:string) => { csrfToken=token; };
export async function api<T=unknown>(path:string, options:{method?:string;body?:unknown;signal?:AbortSignal}={}):Promise<T> {
  const method = options.method || 'GET'; const multipart=options.body instanceof FormData;
  const response = await fetch(`/api/v1${path}`, { method, credentials:'same-origin', cache:'no-store', signal:options.signal, headers:{...(multipart?{}:{'Content-Type':'application/json'}),...(method!=='GET'&&csrfToken?{'X-CSRF-Token':csrfToken}:{})}, body:options.body===undefined?undefined:multipart?options.body as FormData:JSON.stringify(options.body) });
  const result=await response.json().catch(()=>({error:{message:'The server returned an unreadable response.',code:'INVALID_RESPONSE'}}));
  if(!response.ok) throw new ApiError(result.error?.message||'Request failed. Please try again.',result.error?.code||'REQUEST_FAILED',response.status);
  return result.data as T;
}
export const action = <T=unknown>(name:string, body:unknown) => api<T>(`/actions/${encodeURIComponent(name)}`,{method:'POST',body});
export const errorMessage = (e:unknown) => e instanceof Error?e.message:'Something went wrong. Try again.';
export function formatValue(value:unknown):string { if(value===undefined||value===null||value==='')return '—'; if(typeof value==='boolean')return value?'Yes':'No'; if(Array.isArray(value))return value.map(x=>typeof x==='object'?JSON.stringify(x):String(x)).join(', '); if(typeof value==='object')return JSON.stringify(value); return String(value); }
export function displayName(item:Record<string,unknown>):string { return String(item.name||item.title||item.fullName||item.number||item.email||item.subject||item.id||''); }
