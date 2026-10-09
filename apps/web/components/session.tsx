/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import {createContext,useContext,useEffect,useState,useCallback,useRef} from 'react';
import {useRouter} from 'next/navigation';
import {api,ApiError,setCsrf,onSessionExpired} from '@/lib/api';
import {zonedDateKey} from '@/lib/datetime';
import {activateDraftIdentity,clearDraftMemory,draftIdentity} from '@/lib/draft-memory';
import type {Session} from '@/lib/types';
export interface Localization {timezone:string;locale:string;currency:string;branchTimezones?:Record<string,string>}
const unknownClinic:Localization={timezone:'UTC',locale:'en',currency:'USD'};
const TimeContext=createContext<Localization>(unknownClinic);
const Context=createContext<{session:Session|null;loading:boolean;signedOut:boolean;reload:()=>Promise<Session|null>;logout:()=>Promise<void>}>({session:null,loading:true,signedOut:false,reload:async()=>null,logout:async()=>{}});
/** `localization` comes from the server render; the browser fetches the site only when that render could not. */
export function SessionProvider({children,localization:initial}:{children:React.ReactNode;localization?:Localization}){
 const [session,setSession]=useState<Session|null>(null);const[localization,setLocalization]=useState<Localization>(initial||unknownClinic);const[loading,setLoading]=useState(true);const[signedOut,setSignedOut]=useState(false);const router=useRouter();
 const current=useRef<Session|null>(null),checkedAt=useRef(0),serverLocalized=Boolean(initial);
 const apply=useCallback((value:Session|null)=>{current.current=value;setSession(value);setCsrf(value?.csrfToken||'')},[]);
 useEffect(()=>{if(serverLocalized)return;let active=true;void api<{timezone:string;locale:string;currency:string;locations?:{branchId:string;timezone:string}[]}>('/public/site').then(s=>{try{new Intl.DateTimeFormat(s.locale,{timeZone:s.timezone});if(active)setLocalization({timezone:s.timezone,locale:s.locale,currency:s.currency,branchTimezones:Object.fromEntries((s.locations??[]).map(l=>[l.branchId,l.timezone]))})}catch{}}).catch(()=>{});return()=>{active=false}},[serverLocalized]);
 const reload=useCallback(async():Promise<Session|null>=>{const signedIn=current.current;try{const value=await api<Session>('/auth/session');activateDraftIdentity(draftIdentity(value.user));setSignedOut(false);apply(value);return value}catch(e){const expired=e instanceof ApiError&&e.status===401;
  // An expired sign-in keeps this tab's drafts so they can be restored after signing in again as the same person.
  if(!(expired&&signedIn))clearDraftMemory();apply(null);if(!expired)console.warn('Session unavailable');return null}finally{setLoading(false)}},[apply]);
 useEffect(()=>{void reload()},[reload]);
 useEffect(()=>{onSessionExpired(()=>{if(current.current)apply(null)});return()=>onSessionExpired(null)},[apply]);
 // Re-check when the person returns to the tab; a 401 expires the session through the API handler, a network error keeps it.
 useEffect(()=>{const check=()=>{if(!current.current||document.visibilityState!=='visible'||Date.now()-checkedAt.current<15000)return;checkedAt.current=Date.now();void api<Session>('/auth/session').then(value=>{if(!current.current||JSON.stringify(value)===JSON.stringify(current.current))return;activateDraftIdentity(draftIdentity(value.user));apply(value)}).catch(()=>{})};window.addEventListener('focus',check);document.addEventListener('visibilitychange',check);return()=>{window.removeEventListener('focus',check);document.removeEventListener('visibilitychange',check)}},[apply]);
 const logout=async()=>{await api('/auth/logout',{method:'POST'});clearDraftMemory();setSignedOut(true);apply(null);router.replace('/login');router.refresh()};
 return <TimeContext.Provider value={localization}><Context.Provider value={{session,loading,signedOut,reload,logout}}>{children}</Context.Provider></TimeContext.Provider>
}
export const useSession=()=>useContext(Context);

/** Clinic time; pass a record's branch to use that branch's own timezone when it has one. */
export function useClinicTime(branchId?:string){const settings=useContext(TimeContext);const zones=settings.branchTimezones||{};const timezone=(branchId&&Object.hasOwn(zones,branchId)&&zones[branchId])||settings.timezone;return {timezone,known:settings!==unknownClinic,locale:settings.locale,currency:settings.currency,date:(value:Date|string,options:Intl.DateTimeFormatOptions={})=>{const d=value instanceof Date?value:new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat(settings.locale,{timeZone:timezone,...options}).format(d)},day:(value:Date|string)=>zonedDateKey(value,timezone)}}
