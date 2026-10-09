/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import {createContext,useContext,useEffect,useState,useCallback} from 'react';
import {useRouter} from 'next/navigation';
import {api,ApiError,setCsrf} from '@/lib/api';
import {zonedDateKey} from '@/lib/datetime';
import {activateDraftIdentity,clearDraftMemory,draftIdentity} from '@/lib/draft-memory';
import type {Session} from '@/lib/types';
const TimeContext=createContext({timezone:'UTC',locale:'en',currency:'USD'});
const Context=createContext<{session:Session|null;loading:boolean;reload:()=>Promise<void>;logout:()=>Promise<void>}>({session:null,loading:true,reload:async()=>{},logout:async()=>{}});
export function SessionProvider({children}:{children:React.ReactNode}){
 const [session,setSession]=useState<Session|null>(null);const[localization,setLocalization]=useState({timezone:'UTC',locale:'en',currency:'USD'});
 useEffect(()=>{void api<{timezone:string;locale:string;currency:string}>('/public/site').then(s=>{try{new Intl.DateTimeFormat(s.locale,{timeZone:s.timezone});setLocalization({timezone:s.timezone,locale:s.locale,currency:s.currency})}catch{}}).catch(()=>{})},[]);const[loading,setLoading]=useState(true);const router=useRouter();
 const reload=useCallback(async()=>{try{const value=await api<Session>('/auth/session');activateDraftIdentity(draftIdentity(value.user));setSession(value);setCsrf(value.csrfToken)}catch(e){clearDraftMemory();setSession(null);setCsrf('');if(!(e instanceof ApiError&&e.status===401))console.warn('Session unavailable')}finally{setLoading(false)}},[]);
 useEffect(()=>{void reload()},[reload]);
 const logout=async()=>{await api('/auth/logout',{method:'POST'});clearDraftMemory();setSession(null);setCsrf('');router.replace('/login');router.refresh()};
 return <TimeContext.Provider value={localization}><Context.Provider value={{session,loading,reload,logout}}>{children}</Context.Provider></TimeContext.Provider>
}
export const useSession=()=>useContext(Context);

export function useClinicTime(){const settings=useContext(TimeContext);return {...settings,date:(value:Date|string,options:Intl.DateTimeFormatOptions={})=>{const d=value instanceof Date?value:new Date(value);return Number.isNaN(d.getTime())?'—':new Intl.DateTimeFormat(settings.locale,{timeZone:settings.timezone,...options}).format(d)},day:(value:Date|string)=>zonedDateKey(value,settings.timezone)}}
