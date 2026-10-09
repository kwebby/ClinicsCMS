/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {useEffect,useState,useCallback,useRef} from 'react';
import {api,action,errorMessage,displayName,formatValue,ApiError} from '@/lib/api';
import {modules,canAccess,writeRoles} from '@/lib/modules';
import {recordPath,actionPath,mayMove,recordActions} from '@/lib/record-workflow';
import {allowedWorkflowTargets} from '@/lib/workflow-views';
import type {RecordData} from '@/lib/types';
import {useSession,useClinicTime} from './session';
import {Alert,Empty,Icon,Loading,Status} from './ui';
import {CalendarView,KanbanView} from './workflow-views';
export {RecordEditor,ActionForm} from './record-forms';

async function allRecords(collection:string,signal?:AbortSignal){
  const rows:RecordData[]=[];let after='';
  for(;;){
    const batch=await api<RecordData[]>(`/records/${collection}?limit=500${after?'&after='+encodeURIComponent(after):''}`,{signal});
    rows.push(...batch);if(batch.length<500)return rows;
    const next=batch[batch.length-1].id;if(next===after)throw new Error('The server could not continue the record list.');after=next;
  }
}
export function RecordWorkspace({module}:{module:string}){
  const definition=modules[module],time=useClinicTime(),{session}=useSession(),router=useRouter(),params=useSearchParams();
  const [data,setData]=useState<RecordData[]>([]),[loading,setLoading]=useState(true),[error,setError]=useState('');
  const [search,setSearch]=useState(''),[filter,setFilter]=useState('all'),[notice,setNotice]=useState(''),[names,setNames]=useState<Record<string,string>>({});
  const [busyId,setBusyId]=useState(''),[rowErrors,setRowErrors]=useState<Record<string,string>>({});
  const mutation=useRef(false);
  const load=useCallback(async(signal?:AbortSignal)=>{
    setLoading(true);setError('');
    try{const records=await allRecords(module,signal);if(!signal?.aborted)setData(records)}catch(e){if(!signal?.aborted)setError(errorMessage(e))}finally{if(!signal?.aborted)setLoading(false)}
  },[module]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);setSearch('');setFilter('all');setNotice('');setRowErrors({});return()=>controller.abort()},[load]);
  useEffect(()=>{let active=true;const refs=definition?.fields.some(f=>f.reference==='patients')||definition?.columns.some(c=>c.key==='patientId')?['patients']:[];void Promise.allSettled([api<RecordData[]>('/directory'),...refs.map(c=>allRecords(c))]).then(results=>{const map:Record<string,string>={};results.forEach(result=>{if(result.status==='fulfilled')result.value.forEach(row=>{map[row.id]=displayName(row);if(row.userId)map[String(row.userId)]=displayName(row)})});if(active)setNames(map)});return()=>{active=false}},[module,definition]);
  if(!definition)return <Empty title="Page not found" description="Choose a page from the navigation."/>;
  if(session&&!canAccess(session.user.roles,definition.roles))return <Empty title="This workspace is restricted" description="Your account does not have access to this part of the clinic."/>;
  const calendar=['appointments','leave'].includes(module),board=['appointments','leads','tasks'].includes(module);
  const requested=params.get('view'),view=requested==='calendar'&&calendar?'calendar':requested==='board'&&board?'board':'table';
  const statusKey=module==='leads'?'stage':module==='results'?'reviewState':'status';
  const states=[...new Set(data.map(row=>String(row[statusKey]||'')).filter(Boolean))];
  const visible=data.filter(row=>(filter==='all'||row[statusKey]===filter)&&[JSON.stringify(row),...Object.entries(row).filter(([key])=>key.endsWith('Id')).map(([,value])=>names[String(value)]||'')].join(' ').toLowerCase().includes(search.toLowerCase()));
  const format=(key:string,value:unknown)=>{if(key.endsWith('Id')&&names[String(value)])return names[String(value)];if(/At$/.test(key)&&value){const date=new Date(String(value));if(!Number.isNaN(date.getTime()))return time.date(date,{day:'numeric',month:'short',hour:'2-digit',minute:'2-digit'})}return formatValue(value)};
  const label=(row:RecordData)=>module==='appointments'?(names[String(row.patientId)]||'Appointment'):module==='leave'?(names[String(row.userId)]||String(row.reason||'Time off')):displayName(row);
  const writable=canAccess(session?.user.roles||[],writeRoles[module]||[]);
  const progressable=module==='tasks'?canAccess(session?.user.roles||[],modules.tasks.actions?.[0].roles||[]):writable;
  async function mutate(row:RecordData,name:string,patch:Record<string,unknown>){
    if(mutation.current)return;mutation.current=true;setBusyId(row.id);setRowErrors(errors=>({...errors,[row.id]:''}));setNotice('');
    try{
      const result=await action<RecordData>(name,{id:row.id,...(name==='notifications.read'?{}:{expectedVersion:row.version}),...patch});
      const fresh=result?.id===row.id?result:await api<RecordData>(`/records/${module}/${encodeURIComponent(row.id)}`);
      setData(rows=>rows.map(item=>item.id===row.id?fresh:item));setNotice(`${label(fresh)} updated.`);
    }catch(e){
      const message=e instanceof ApiError&&e.status===409?'This record changed or this transition is no longer available. Refresh records to use the latest status.':errorMessage(e);
      setRowErrors(errors=>({...errors,[row.id]:message}));
      // A board card may move out of view; keep the failure visible above every view too.
      setError(message);
      throw e;
    }finally{mutation.current=false;setBusyId('')}
  }
  async function move(row:RecordData,target:string){
    if(!session||!mayMove(module,row,session.user)||!allowedWorkflowTargets(module,row).includes(target))return;
    if(module==='leads'&&['booked','closed'].includes(target)){router.push(`${actionPath(module,row.id,'leads.transition')}?stage=${encodeURIComponent(target)}`);return}
    await mutate(row,module==='leads'?'leads.transition':`${module}.status`,{[module==='leads'?'stage':'status']:target});
  }
  const controls=(row:RecordData)=>{
    const permitted=session&&mayMove(module,row,session.user),targets=permitted?allowedWorkflowTargets(module,row):[];
    const actions=session?recordActions(module,row,session.user):[];
    return <div className="table-actions">
      {targets.length>0&&<select className="inline-status" aria-label={`Update status for ${displayName(row)}`} disabled={Boolean(busyId)} value={String(row[module==='leads'?'stage':'status']||'')} onChange={event=>{const target=event.target.value;if(target)void move(row,target).catch(()=>{})}}><option value={String(row[module==='leads'?'stage':'status']||'')}>{busyId===row.id?'Updating…':String(row[module==='leads'?'stage':'status']||'Choose status').replaceAll('-',' ')}</option>{targets.map(target=><option key={target} value={target}>{target.replaceAll('-',' ')}{module==='leads'&&['closed','booked'].includes(target)?'…':''}</option>)}</select>}
      {module==='notifications'&&!row.read&&<button className="text-button" disabled={Boolean(busyId)} onClick={()=>void mutate(row,'notifications.read',{}).catch(()=>{})}>Mark as read</button>}
      {module==='leave'&&actions.some(def=>def.action==='leave.approve')&&<><button className="text-button" disabled={Boolean(busyId)} onClick={()=>void mutate(row,'leave.approve',{approved:true}).catch(()=>{})}>Approve</button><button className="text-button" disabled={Boolean(busyId)} onClick={()=>void mutate(row,'leave.approve',{approved:false}).catch(()=>{})}>Reject</button></>}
      {!targets.length&&!['notifications','leave'].includes(module)&&actions.slice(0,1).map(def=><Link key={def.action} className="text-button" href={actionPath(module,row.id,def.action)}>{def.label}</Link>)}
      {rowErrors[row.id]&&<small className="row-error" role="alert">{rowErrors[row.id]}</small>}
    </div>;
  };
  const viewHref=(next:string)=>{const query=new URLSearchParams(params.toString());query.set('view',next);return `/workspace/${encodeURIComponent(module)}?${query}`};
  return <>
    <div className="page-heading"><div><h1>{definition.title}</h1><p>{definition.description}{['appointments','availability','encounters','results','leave','tasks'].includes(module)?` Times shown in ${time.timezone}.`:''}</p></div>{!definition.readonly&&writable&&<Link className="button primary" href={`/workspace/${encodeURIComponent(module)}/new`}><Icon name="plus" size={17}/>New {definition.singular.toLowerCase()}</Link>}</div>
    {(calendar||board)&&<nav className="view-switcher" aria-label="Workspace view"><Link href={viewHref('table')} aria-current={view==='table'?'page':undefined}><Icon name="dashboard" size={16}/>Table</Link>{calendar&&<Link href={viewHref('calendar')} aria-current={view==='calendar'?'page':undefined}><Icon name="calendar" size={16}/>Calendar</Link>}{board&&<Link href={viewHref('board')} aria-current={view==='board'?'page':undefined}><Icon name="tasks" size={16}/>Kanban</Link>}</nav>}
    {notice&&<Alert kind="success">{notice}</Alert>}{error&&<Alert>{error}<button className="text-button" onClick={()=>void load()}>Refresh records</button></Alert>}
    <section className="panel record-list-panel"><div className="data-toolbar"><div className="tabs" role="group" aria-label="Filter records"><button className={filter==='all'?'active':''} onClick={()=>setFilter('all')}>All <span>{data.length}</span></button>{states.map(state=><button key={state} className={filter===state?'active':''} onClick={()=>setFilter(state)}>{state.replaceAll('-',' ')}</button>)}</div><div className="search-input"><Icon name="search" size={16}/><input aria-label={`Search ${definition.title.toLowerCase()}`} placeholder="Search records…" value={search} onChange={event=>setSearch(event.target.value)}/></div><button className="icon-button" aria-label="Refresh records" onClick={()=>void load()}><Icon name="refresh" size={17}/></button></div>
      {loading?<Loading label={`Loading ${definition.title.toLowerCase()}…`}/>:view==='calendar'?<CalendarView module={module} rows={visible} timeZone={time.timezone} recordHref={row=>recordPath(module,row.id)} recordLabel={label} renderActions={controls} busyId={busyId}/>:view==='board'?<KanbanView module={module} rows={visible} timeZone={time.timezone} recordHref={row=>recordPath(module,row.id)} recordLabel={label} onMove={progressable?move:undefined} canMove={row=>Boolean(session&&mayMove(module,row,session.user))} busyId={busyId}/>:!visible.length?<Empty title={search?'No matching records':`No ${definition.title.toLowerCase()} yet`} description={search?'Try a different search or filter.':`Create a ${definition.singular.toLowerCase()} to get started.`}/>:<div className="table-scroll"><table className="data-table"><thead><tr>{definition.columns.map(column=><th key={column.key}>{column.label}</th>)}<th>Quick actions</th><th><span className="sr-only">Open record</span></th></tr></thead><tbody>{visible.map((row,index)=><tr key={row.id} aria-busy={busyId===row.id}>{definition.columns.map((column,columnIndex)=><td key={column.key}>{columnIndex===0?<Link className="record-link" href={recordPath(module,row.id)}>{['patients','employees','leads'].includes(module)&&<span className={`avatar shade-${index%4}`}>{displayName(row).split(' ').map(part=>part[0]).slice(0,2).join('')}</span>}<span>{format(column.key,row[column.key])}<small>{row.id.slice(0,8)}</small></span></Link>:column.key==='status'||column.key==='stage'||column.key.endsWith('State')?<Status value={row[column.key]}/>:format(column.key,row[column.key])}</td>)}<td>{controls(row)}</td><td><Link className="icon-button" aria-label={`Open ${displayName(row)}`} href={recordPath(module,row.id)}><Icon name="arrow" size={17}/></Link></td></tr>)}</tbody></table><div className="table-footer">{visible.length} {visible.length===1?'record':'records'} shown <span>Only records your account can access</span></div></div>}
    </section>
  </>;
}
