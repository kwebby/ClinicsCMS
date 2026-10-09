/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import Link from 'next/link';
import {useRouter,useSearchParams} from 'next/navigation';
import {useEffect,useMemo,useState,useCallback,useRef} from 'react';
import {api,apiPage,action,allRecords,errorMessage,displayName,formatValue,recordNames,ApiError} from '@/lib/api';
import {listPath,mergeRecords,nextCursor,sortCreated,uniqueIds} from '@/lib/records';
import {modules,canAccess,writeRoles} from '@/lib/modules';
import {recordPath,actionPath,mayMove,recordActions} from '@/lib/record-workflow';
import {allowedWorkflowTargets,kanbanColumns,workflowLabel} from '@/lib/workflow-views';
import type {RecordData} from '@/lib/types';
import {useSession,useClinicTime} from './session';
import {Alert,Empty,Icon,Loading,Status} from './ui';
import {CalendarView,KanbanView} from './workflow-views';
export {RecordEditor,ActionForm} from './record-forms';

const pageSize=50,boardLimit=100,calendarWindow=1000;
const knownStates:Record<string,string[]>={...Object.fromEntries(Object.entries(kanbanColumns).map(([key,columns])=>[key,columns.map(column=>column.id)])),results:['pending','reviewed']};
/** One page at a time with server-side search; the board asks each stage for its newest cards and the calendar reads a bounded window of the newest records. */
export function RecordWorkspace({module}:{module:string}){
  const definition=modules[module],time=useClinicTime(),{session}=useSession(),router=useRouter(),params=useSearchParams();
  const calendar=['appointments','leave'].includes(module),board=['appointments','leads','tasks'].includes(module);
  const requested=params.get('view'),view=requested==='calendar'&&calendar?'calendar':requested==='board'&&board?'board':'table';
  const statusKey=module==='leads'?'stage':module==='results'?'reviewState':'status';
  const [data,setData]=useState<RecordData[]>([]),[loading,setLoading]=useState(true),[loadingMore,setLoadingMore]=useState(false),[error,setError]=useState(''),[cursor,setCursor]=useState(''),[limitNote,setLimitNote]=useState('');
  const [search,setSearch]=useState(''),[query,setQuery]=useState(''),[filter,setFilter]=useState('all'),[seenStates,setSeenStates]=useState<string[]>([]),[notice,setNotice]=useState(''),[names,setNames]=useState<Record<string,string>>({});
  const [busyId,setBusyId]=useState(''),[rowErrors,setRowErrors]=useState<Record<string,string>>({});
  const mutation=useRef(false),generation=useRef(0);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(search.trim()),300);return()=>clearTimeout(timer)},[search]);
  const eq=useMemo(()=>filter==='all'?undefined:{[statusKey]:filter},[filter,statusKey]);
  const load=useCallback(async(signal?:AbortSignal)=>{
    const run=++generation.current;setLoading(true);setError('');
    try{
      let rows:RecordData[],next='',note='';
      if(view==='board'){
        const states=filter==='all'?knownStates[module]||[]:[filter];
        const pages=await Promise.all(states.map(state=>apiPage(listPath(module,{order:'desc',limit:boardLimit,q:query,eq:{[statusKey]:state}}),signal)));
        rows=pages.flatMap(page=>page.data);const capped=states.filter((_,index)=>nextCursor(pages[index],boardLimit)).map(state=>workflowLabel(module,state));
        if(capped.length)note=`${capped.join(', ')} ${capped.length===1?'shows its':'show their'} ${boardLimit} newest records. Search or use the table to find older ones.`;
      }else if(view==='calendar'){
        const window=await allRecords(module,{order:'desc',q:query,eq},signal,calendarWindow);rows=window.rows;
        if(!window.complete)note=`The calendar shows the ${calendarWindow.toLocaleString(time.locale)} most recently created records. Search or use the table to find older ones.`;
      }else{const page=await apiPage(listPath(module,{order:'desc',limit:pageSize,q:query,eq}),signal);rows=page.data;next=nextCursor(page,pageSize)}
      if(signal?.aborted||run!==generation.current)return;
      setData(rows);setCursor(next);setLimitNote(note);
    }catch(e){if(!signal?.aborted&&run===generation.current)setError(errorMessage(e))}finally{if(!signal?.aborted&&run===generation.current)setLoading(false)}
  },[module,view,filter,query,eq,statusKey,time.locale]);
  useEffect(()=>{const controller=new AbortController();void load(controller.signal);return()=>controller.abort()},[load]);
  async function loadMore(){
    if(!cursor||loadingMore)return;const run=generation.current;setLoadingMore(true);
    try{const page=await apiPage(listPath(module,{order:'desc',limit:pageSize,q:query,eq,after:cursor}));if(run!==generation.current)return;setData(current=>mergeRecords(current,page.data));setCursor(nextCursor(page,pageSize))}
    catch(e){if(run===generation.current)setError(errorMessage(e))}finally{setLoadingMore(false)}
  }
  useEffect(()=>{setSeenStates(current=>{const next=[...new Set([...current,...data.map(row=>String(row[statusKey]||'')).filter(Boolean)])];return next.length===current.length?current:next})},[data,statusKey]);
  // Staff names come from the directory; patient names only for the patients on screen.
  useEffect(()=>{let active=true;void api<RecordData[]>('/directory').then(rows=>{if(active)setNames(current=>({...Object.fromEntries(rows.flatMap(row=>[[row.id,displayName(row)],...(row.userId?[[String(row.userId),displayName(row)]]:[])])),...current}))}).catch(()=>{});return()=>{active=false}},[]);
  const patientRefs=Boolean(definition?.fields.some(f=>f.reference==='patients')||definition?.columns.some(c=>c.key==='patientId'));
  const missingPatients=patientRefs?uniqueIds(data.map(row=>row.patientId)).filter(id=>!(id in names)).join(','):'';
  useEffect(()=>{if(!missingPatients)return;const ids=missingPatients.split(','),controller=new AbortController();void recordNames('patients',ids,controller.signal).then(found=>{if(!controller.signal.aborted)setNames(current=>({...current,...Object.fromEntries(ids.map(id=>[id,found[id]||'']))}))});return()=>controller.abort()},[missingPatients]);
  const visible=useMemo(()=>sortCreated(data.filter(row=>filter==='all'||row[statusKey]===filter),true),[data,filter,statusKey]);
  if(!definition)return <Empty title="Page not found" description="Choose a page from the navigation."/>;
  if(session&&!canAccess(session.user.roles,definition.roles))return <Empty title="This workspace is restricted" description="Your account does not have access to this part of the clinic."/>;
  const states=[...new Set([...(knownStates[module]||[]),...seenStates])];
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
    <section className="panel record-list-panel"><div className="data-toolbar"><div className="tabs" role="group" aria-label="Filter records"><button type="button" className={filter==='all'?'active':''} aria-pressed={filter==='all'} onClick={()=>setFilter('all')}>All</button>{states.map(state=><button type="button" key={state} className={filter===state?'active':''} aria-pressed={filter===state} onClick={()=>setFilter(state)}>{state.replaceAll('-',' ')}</button>)}</div><div className="search-input"><Icon name="search" size={16}/><input type="search" maxLength={100} aria-label={`Search ${definition.title.toLowerCase()}`} placeholder="Search records…" value={search} onChange={event=>setSearch(event.target.value)}/></div><button className="icon-button" aria-label="Refresh records" onClick={()=>void load()}><Icon name="refresh" size={17}/></button></div>
      {limitNote&&!loading&&<p className="workflow-footnote" role="status">{limitNote}</p>}{loading?<Loading label={`Loading ${definition.title.toLowerCase()}…`}/>:view==='calendar'?<CalendarView module={module} rows={visible} timeZone={time.timezone} recordHref={row=>recordPath(module,row.id)} recordLabel={label} renderActions={controls} busyId={busyId} locale={time.locale}/>:view==='board'?<KanbanView module={module} rows={visible} timeZone={time.timezone} recordHref={row=>recordPath(module,row.id)} recordLabel={label} onMove={progressable?move:undefined} canMove={row=>Boolean(session&&mayMove(module,row,session.user))} busyId={busyId} locale={time.locale}/>:!visible.length?<Empty title={query||filter!=='all'?'No matching records':`No ${definition.title.toLowerCase()} yet`} description={query||filter!=='all'?'Try a different search or filter.':`Create a ${definition.singular.toLowerCase()} to get started.`} action={cursor?<button type="button" className="button secondary" disabled={loadingMore} onClick={()=>void loadMore()}>{loadingMore?'Loading more…':'Look further'}</button>:undefined}/>:<div className="table-scroll"><table className="data-table"><thead><tr>{definition.columns.map(column=><th key={column.key}>{column.label}</th>)}<th>Quick actions</th><th><span className="sr-only">Open record</span></th></tr></thead><tbody>{visible.map((row,index)=><tr key={row.id} aria-busy={busyId===row.id}>{definition.columns.map((column,columnIndex)=><td key={column.key}>{columnIndex===0?<Link className="record-link" href={recordPath(module,row.id)}>{['patients','employees','leads'].includes(module)&&<span className={`avatar shade-${index%4}`}>{displayName(row).split(' ').map(part=>part[0]).slice(0,2).join('')}</span>}<span>{format(column.key,row[column.key])}<small>{row.id.slice(0,8)}</small></span></Link>:column.key==='status'||column.key==='stage'||column.key.endsWith('State')?<Status value={row[column.key]}/>:format(column.key,row[column.key])}</td>)}<td>{controls(row)}</td><td><Link className="icon-button" aria-label={`Open ${displayName(row)}`} href={recordPath(module,row.id)}><Icon name="arrow" size={17}/></Link></td></tr>)}</tbody></table><div className="table-footer">{visible.length} {visible.length===1?'record':'records'} shown{cursor&&<> · <button type="button" className="text-button" disabled={loadingMore} aria-busy={loadingMore} onClick={()=>void loadMore()}>{loadingMore?'Loading more…':'Load more'}</button></>} <span>Only records your account can access</span></div></div>}
    </section>
  </>;
}
