/* Author: ramanpal singh | URL: https://kwebby.com */
import type {RecordData} from './types.js';

export interface ListQuery {limit?:number;after?:string;order?:'asc'|'desc';q?:string;eq?:Record<string,string|number|boolean|null|undefined>}
/** Build a bounded record list URL. `after` is the last id of the previous page in the same order. */
export function listPath(collection:string,query:ListQuery={}):string {
  const params=new URLSearchParams();
  for(const [key,value] of Object.entries(query.eq||{}))if(value!==undefined&&value!==null&&value!=='')params.set(key,String(value));
  const q=(query.q||'').trim().slice(0,100);if(q)params.set('q',q);
  if(query.order)params.set('order',query.order);
  if(query.limit)params.set('limit',String(Math.max(1,Math.min(500,Math.floor(query.limit)))));
  if(query.after)params.set('after',query.after);
  const text=params.toString();return `/records/${encodeURIComponent(collection)}${text?`?${text}`:''}`;
}
export interface ListPage {data:RecordData[];next?:string}
/** The cursor for the following page: the server's `next` when it sends one (a page may be short while more records follow), otherwise the last id of a full page. Empty means the end. */
export function nextCursor(page:ListPage,limit:number):string {return page.next??(page.data.length>=limit?page.data[page.data.length-1].id:'');}
/** Follow cursors to the end, or stop at `max` rows and report that more may exist. */
export async function collectPages(fetchPage:(after:string)=>Promise<ListPage>,pageSize=500,max=Infinity):Promise<{rows:RecordData[];complete:boolean}> {
  const rows:RecordData[]=[];let after='';
  for(;;){
    const page=await fetchPage(after);rows.push(...page.data);const next=nextCursor(page,pageSize);
    if(!next)return {rows,complete:true};
    if(rows.length>=max)return {rows,complete:false};
    if(next===after)throw new Error('The server could not continue the record list.');after=next;
  }
}
const time=(value:unknown)=>{const parsed=Date.parse(String(value??''));return Number.isFinite(parsed)?parsed:0};
const byId=(a:RecordData,b:RecordData)=>a.id<b.id?-1:a.id>b.id?1:0;
/** Creation order with an id tie-break. Older rows may carry random ids, so id order alone is not chronological. */
export const compareCreated=(a:RecordData,b:RecordData)=>time(a.createdAt)-time(b.createdAt)||byId(a,b);
export const sortCreated=(rows:RecordData[],newestFirst=false)=>[...rows].sort((a,b)=>newestFirst?compareCreated(b,a):compareCreated(a,b));
/** Most recent activity first; read receipts change `updatedAt`, so only a new message moves a conversation up. */
export function sortByActivity(rows:RecordData[]):RecordData[] {const at=(row:RecordData)=>time(row.lastMessageAt)||time(row.createdAt);return [...rows].sort((a,b)=>at(b)-at(a)||byId(b,a));}
/** Add a further page, replacing refreshed copies in place. */
export function mergeRecords(current:RecordData[],incoming:RecordData[]):RecordData[] {const rows=new Map(current.map(row=>[row.id,row]));for(const row of incoming)rows.set(row.id,row);return [...rows.values()];}
export const uniqueIds=(values:unknown[])=>[...new Set(values.filter((value):value is string=>typeof value==='string'&&value!==''))];

const blank=(value:unknown)=>value===''||value===undefined||value===null;
/** Create payloads omit empty fields. */
export function cleanValues(values:Record<string,unknown>):Record<string,unknown> {return Object.fromEntries(Object.entries(values).filter(([,value])=>value!==''&&value!==undefined));}
/** Edit payloads send null for a field that had a value and was emptied, which clears it on the server. */
export function updateValues(values:Record<string,unknown>,original:Record<string,unknown>):Record<string,unknown> {
  const result:Record<string,unknown>={};
  for(const [key,value] of Object.entries(values)){if(!blank(value))result[key]=value;else if(!blank(original[key]))result[key]=null;}
  return result;
}

/** Same-origin relative paths only: no scheme, protocol-relative, backslash or control-character tricks. */
export function safeNextPath(value:unknown):string|undefined {
  if(typeof value!=='string'||value.length>2048||!value.startsWith('/')||value.startsWith('//')||value.includes('\\')||/[\u0000-\u001f\u007f]/.test(value))return;
  const origin='https://return.invalid';let url:URL;
  try{url=new URL(value,origin)}catch{return}
  const path=url.pathname+url.search+url.hash;
  if(url.origin!==origin||path.startsWith('//')||path.includes('\\')||/^\/(?:login|register|setup)(?:[/?#]|$)/.test(path))return;
  return path;
}
export function loginPath(current?:string):string {const next=safeNextPath(current);return next&&next!=='/'?`/login?next=${encodeURIComponent(next)}`:'/login';}
