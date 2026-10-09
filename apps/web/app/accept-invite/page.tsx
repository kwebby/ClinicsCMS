/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import {Suspense,useState} from 'react';
import {useSearchParams,useRouter} from 'next/navigation';
import {api,errorMessage} from '@/lib/api';
import {useSession} from '@/components/session';
import {Alert,Loading,Mark} from '@/components/ui';
function Accept(){const params=useSearchParams();const router=useRouter();const{reload}=useSession();const[password,setPassword]=useState('');const[error,setError]=useState('');const[busy,setBusy]=useState(false);return <main className="invite-page"><div className="panel"><Mark/><h1>Join your clinic team</h1><p>Create a strong password to accept your staff invitation.</p>{error&&<Alert>{error}</Alert>}<form onSubmit={async e=>{e.preventDefault();setBusy(true);try{await api('/auth/accept-invite',{method:'POST',body:{token:params.get('token'),password}});await reload();router.replace('/workspace')}catch(err){setError(errorMessage(err))}finally{setBusy(false)}}}><label className="form-field">Choose a password<input type="password" required minLength={12} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)}/><small>At least 12 characters.</small></label><button className="button primary" disabled={busy||!params.get('token')}>{busy?'Accepting…':'Accept invitation'}</button></form></div></main>}
export default function Page(){return <Suspense fallback={<Loading/>}><Accept/></Suspense>}
