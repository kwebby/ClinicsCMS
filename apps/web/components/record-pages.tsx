/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {useCallback,useEffect,useState} from 'react';
import {api,action,errorMessage,displayName,formatValue} from '@/lib/api';
import {modules,canAccess,writeRoles} from '@/lib/modules';
import {recordPath,actionPath,mayEdit,recordActions} from '@/lib/record-workflow';
import type {RecordData} from '@/lib/types';
import {useSession,useClinicTime} from './session';
import {Alert,Empty,Loading,Status} from './ui';
import {RecordEditor,ActionForm,PaymentCheckout} from './record-forms';
import {Blocks} from './blocks';
import {UploadControl} from './workspace';

function useRecord(module:string,id?:string){
  const [record,setRecord]=useState<RecordData|null>(null),[error,setError]=useState(''),[loading,setLoading]=useState(Boolean(id));
  const reload=useCallback(async(signal?:AbortSignal)=>{
    if(!id){setLoading(false);return}setLoading(true);setError('');setRecord(null);
    try{const row=await api<RecordData>(`/records/${module}/${encodeURIComponent(id)}`,{signal});if(!signal?.aborted)setRecord(row)}catch(e){if(!signal?.aborted)setError(errorMessage(e))}finally{if(!signal?.aborted)setLoading(false)}
  },[module,id]);
  useEffect(()=>{const controller=new AbortController();void reload(controller.signal);return()=>controller.abort()},[reload]);
  return {record,error,loading,reload};
}
function PageHeading({module,title,record,subtitle,actions}:{module:string;title:string;record?:RecordData;subtitle?:string;actions?:React.ReactNode}){
  const definition=modules[module];
  return <><nav className="record-breadcrumbs" aria-label="Breadcrumb"><Link href={`/workspace/${encodeURIComponent(module)}`}>Back to {definition.title.toLowerCase()}</Link>{record&&<><span aria-hidden="true">/</span><Link href={recordPath(module,record.id)}>{displayName(record)}</Link></>}</nav><div className="page-heading"><div><h1>{title}</h1><p>{subtitle||definition.description}</p></div>{actions&&<div className="button-row">{actions}</div>}</div></>;
}
function Failure({module,error,retry}:{module:string;error:string;retry:()=>void}){return <><PageHeading module={module} title="Record unavailable"/><Alert>{error}<button className="text-button" onClick={retry}>Try again</button></Alert></>}
function RevisionHistory({module,record}:{module:string;record:RecordData}){
  const [revisions,setRevisions]=useState<RecordData[]|null>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false);const time=useClinicTime();const {session}=useSession();
  return <section className="revision-history"><h2>Version history</h2>{revisions===null&&<button className="text-button" disabled={busy} onClick={async()=>{setBusy(true);try{setRevisions(await action<RecordData[]>(`${module}.revisions`,{id:record.id}))}catch(e){setError(errorMessage(e))}finally{setBusy(false)}}}>{busy?'Loading revisions…':'Load version history'}</button>}{error&&<Alert>{error}</Alert>}{revisions&&(!revisions.length?<p>No earlier revisions are available.</p>:revisions.map(revision=><div className="revision-row" key={revision.id}><span>Version {String(revision.recordVersion)} · {time.date(String(revision.createdAt),{dateStyle:'medium',timeStyle:'short'})}</span><Link className="text-button" href={`${recordPath(module,record.id)}/revisions/${encodeURIComponent(revision.id)}`}>View revision</Link>{module==='pages'&&canAccess(session?.user.roles||[],writeRoles.pages)&&<Link className="text-button" href={`${actionPath(module,record.id,'pages.restore')}?revisionId=${encodeURIComponent(revision.id)}`}>Restore as draft</Link>}</div>))}</section>;
}
export function RecordDetailPage({module,id}:{module:string;id:string}){
  const {session}=useSession(),time=useClinicTime();const {record,error,loading,reload}=useRecord(module,id);const [names,setNames]=useState<Record<string,string>>({});
  useEffect(()=>{let mounted=true;void api<RecordData[]>('/directory').then(rows=>{if(mounted)setNames(Object.fromEntries(rows.map(row=>[row.id,displayName(row)])))}).catch(()=>{});return()=>{mounted=false}},[]);
  if(loading||!session)return <Loading/>;if(error||!record)return <Failure module={module} error={error||'Record not found.'} retry={()=>void reload()}/>;
  const definition=modules[module],actions=recordActions(module,record,session.user);
  const format=(key:string,value:unknown)=>{if(key.endsWith('Id')&&names[String(value)])return names[String(value)];if(/At$/.test(key)&&value){const date=new Date(String(value));if(!Number.isNaN(date.getTime()))return time.date(date,{dateStyle:'medium',timeStyle:'short'})}return formatValue(value)};
  return <><PageHeading module={module} title={displayName(record)||definition.singular} actions={mayEdit(module,record,session.user)&&<Link className="button primary" href={`${recordPath(module,id)}/edit`}>Edit {definition.singular.toLowerCase()}</Link>}/><section className="panel record-page"><div className="detail-meta"><Status value={record.status||record.stage||record.reviewState||'active'}/><span>Version {record.version}</span><code>{record.id}</code></div><div className="detail-actions">{actions.map(def=><Link className="button secondary" key={def.action} href={actionPath(module,id,def.action)}>{def.label}</Link>)}{module==='documents'&&['invoice','payslip','credit-note'].includes(String(record.kind))&&<a className="button secondary" href={`/api/v1/documents/${encodeURIComponent(id)}/pdf`} download>Download PDF</a>}{module==='invoices'&&['issued','partially-paid'].includes(String(record.status))&&<PaymentCheckout invoiceId={id}/>}</div><dl className="detail-grid">{Object.entries(record).filter(([key])=>!['id','organizationId','version','content','notes','revisions','snapshots'].includes(key)).map(([key,value])=><div key={key}><dt>{key.replace(/([A-Z])/g,' $1').replace(/^./,x=>x.toUpperCase())}</dt><dd>{typeof value==='object'?<pre className="json-value">{JSON.stringify(value,null,2)}</pre>:format(key,value)}</dd></div>)}</dl>{record.content?<Blocks value={record.content}/>:null}{record.notes?<Blocks value={record.notes}/>:null}{['pages','encounters','templates'].includes(module)&&<RevisionHistory module={module} record={record}/>} {module==='patients'&&<UploadControl patientId={id}/>}</section></>;
}
export function RecordEditorPage({module,id}:{module:string;id?:string}){
  const {session}=useSession(),router=useRouter();const {record,error,loading,reload}=useRecord(module,id);const definition=modules[module];
  if(loading||!session)return <Loading/>;
  if(id&&(error||!record))return <Failure module={module} error={error||'Record not found.'} retry={()=>void reload()}/>;
  const allowed=record?mayEdit(module,record,session.user):!definition.readonly&&canAccess(session.user.roles,writeRoles[module]||[]);
  const back=record?recordPath(module,record.id):`/workspace/${encodeURIComponent(module)}`;
  if(!allowed)return <><PageHeading module={module} title="Editing unavailable" record={record||undefined}/><Empty title="This record cannot be edited" description="Your permissions or the record’s current state do not allow this change." action={<Link className="button secondary" href={back}>Back to record</Link>}/></>;
  return <><PageHeading module={module} title={`${record?'Edit':'New'} ${definition.singular.toLowerCase()}`} record={record||undefined}/><section className="panel record-page"><RecordEditor key={record?.id||'new'} module={module} record={record||undefined} onSave={saved=>router.push(saved?.id?recordPath(module,saved.id):back)} onCancel={()=>router.push(back)}/></section></>;
}
export function RecordActionPage({module,id,actionName}:{module:string;id:string;actionName:string}){
  const {session}=useSession(),router=useRouter(),params=useSearchParams();const {record,error,loading,reload}=useRecord(module,id);
  if(loading||!session)return <Loading/>;if(error||!record)return <Failure module={module} error={error||'Record not found.'} retry={()=>void reload()}/>;
  const definition=recordActions(module,record,session.user).find(def=>def.action===actionName);
  if(!definition)return <><PageHeading module={module} title="Action unavailable" record={record}/><Empty title="This action is no longer available" description="The record’s status or your permissions do not allow this action." action={<Link className="button secondary" href={recordPath(module,id)}>View current record</Link>}/></>;
  const seed=Object.fromEntries((definition.fields||[]).filter(field=>['stage','status','revisionId'].includes(field.key)&&params.has(field.key)&&(!field.options||field.options.includes(params.get(field.key)!))).map(field=>[field.key,params.get(field.key)]));
  return <><PageHeading module={module} title={definition.label} record={record} subtitle={`For ${displayName(record)}. Review the information below before saving.`}/><section className="panel record-page action-page"><div className="detail-meta"><Status value={record.status||record.stage||record.reviewState||'active'}/><span>Version {record.version}</span></div><ActionForm key={`${id}:${actionName}`} definition={definition} record={record} seed={seed} onDone={()=>router.push(recordPath(module,id))}/><Link className="text-button page-cancel" href={recordPath(module,id)}>Cancel and return to record</Link></section></>;
}
export function RecordRevisionPage({module,id,revisionId}:{module:string;id:string;revisionId:string}){
  const {record,error,loading,reload}=useRecord(module,id),{session}=useSession();const [revision,setRevision]=useState<RecordData|null>(null),[revisionError,setRevisionError]=useState('');
  useEffect(()=>{let mounted=true;setRevision(null);setRevisionError('');if(!record)return;void action<RecordData[]>(`${module}.revisions`,{id}).then(rows=>{if(!mounted)return;const found=rows.find(row=>row.id===revisionId);if(!found)setRevisionError('This revision was not found for this record.');else setRevision(found)}).catch(e=>{if(mounted)setRevisionError(errorMessage(e))});return()=>{mounted=false}},[record,module,id,revisionId]);
  if(loading||!session)return <Loading/>;if(error||!record)return <Failure module={module} error={error||'Record not found.'} retry={()=>void reload()}/>;
  const snapshot=revision?.snapshot as Record<string,unknown>|undefined;
  return <><PageHeading module={module} record={record} title={revision?`Version ${String(revision.recordVersion)}`:'Version history'} subtitle="This saved revision is read-only."/>{revisionError?<Alert>{revisionError}</Alert>:!revision?<Loading/>:<section className="panel record-page"><Blocks value={snapshot?.content}/>{snapshot?.notes?<Blocks value={snapshot.notes}/>:null}<details><summary>Revision details</summary><pre className="json-value">{JSON.stringify(snapshot,null,2)}</pre></details>{module==='pages'&&canAccess(session.user.roles,writeRoles.pages)&&<Link className="button secondary" href={`${actionPath(module,id,'pages.restore')}?revisionId=${encodeURIComponent(revisionId)}`}>Restore as draft</Link>}</section>}</>;
}
