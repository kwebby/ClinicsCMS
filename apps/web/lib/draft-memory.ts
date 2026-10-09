/* Author: ramanpal singh | URL: https://kwebby.com */
/** Private tab memory only: never persisted in browser storage or sent to another account. */
export interface MemoryDraft {
  values:Record<string,unknown>;
  baseline:string;
  expectedVersion?:number;
  idempotencyKey?:string;
}
const lifetime=30*60*1000;
const maximum=20;
let currentIdentity:string|null=null;
const drafts=new Map<string,{draft:MemoryDraft;expiresAt:number}>();

export function draftIdentity(actor:{organizationId:string;id:string}):string {return JSON.stringify([actor.organizationId,actor.id]);}
export function activateDraftIdentity(identity:string|null):void {
  if(identity!==currentIdentity){drafts.clear();currentIdentity=identity;}
}
export function clearDraftMemory():void {drafts.clear();currentIdentity=null;}
function purge(now:number){for(const [key,entry] of drafts)if(entry.expiresAt<=now)drafts.delete(key);}
export function readMemoryDraft(identity:string,key:string,now=Date.now()):MemoryDraft|null {
  purge(now);if(identity!==currentIdentity)return null;
  const entry=drafts.get(key);return entry?structuredClone(entry.draft):null;
}
export function writeMemoryDraft(identity:string,key:string,draft:MemoryDraft,now=Date.now()):void {
  purge(now);if(identity!==currentIdentity)return;
  drafts.delete(key);drafts.set(key,{draft:structuredClone(draft),expiresAt:now+lifetime});
  while(drafts.size>maximum)drafts.delete(drafts.keys().next().value!);
}
export function removeMemoryDraft(identity:string,key:string):void {if(identity===currentIdentity)drafts.delete(key);}
/** A late save must not erase edits that were cached after its request started. */
export function removeMatchingMemoryDraft(identity:string,key:string,submitted:Record<string,unknown>):void {
  if(identity!==currentIdentity)return;
  const entry=drafts.get(key);if(entry&&JSON.stringify(entry.draft.values)===JSON.stringify(submitted))drafts.delete(key);
}
