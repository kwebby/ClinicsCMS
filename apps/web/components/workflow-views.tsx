/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import Link from 'next/link';
import {useEffect,useMemo,useState,type ReactNode} from 'react';
import type {RecordData} from '@/lib/types';
import {errorMessage} from '@/lib/api';
import {zonedDateKey} from '@/lib/datetime';
import {allowedWorkflowTargets,calendarDates,calendarInterval,dateKeyDate,kanbanColumns,recordsByCalendarDate,stepCalendar,workflowLabel,workflowState,type CalendarMode} from '@/lib/workflow-views';
import {Alert,Icon,Status} from './ui';

export interface WorkflowViewProps {
  module:string;
  rows:RecordData[];
  timeZone:string;
  recordHref:(row:RecordData)=>string;
  recordLabel?:(row:RecordData)=>string;
  renderActions?:(row:RecordData)=>ReactNode;
  onMove?:(row:RecordData,target:string)=>Promise<void>;
  canMove?:(row:RecordData)=>boolean;
  busyId?:string;
}
function defaultLabel(module:string,row:RecordData):string {
  return String(row.name||row.title||(module==='appointments'?`${String(row.kind||'Appointment').replaceAll('-',' ')} · ${String(row.patientId||row.id).slice(0,8)}`:module==='leave'?`Leave · ${String(row.employeeId||row.id).slice(0,8)}`:row.id.slice(0,8)));
}
function clockLabel(value:unknown,timeZone:string){const date=new Date(String(value||''));return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en',{timeZone,hour:'numeric',minute:'2-digit'}).format(date):'';}
function fullDate(value:unknown,timeZone:string){const date=new Date(String(value||''));return Number.isFinite(date.getTime())?new Intl.DateTimeFormat('en',{timeZone,dateStyle:'medium',timeStyle:'short'}).format(date):'';}

export function CalendarView({module,rows,timeZone,recordHref,recordLabel,renderActions}:WorkflowViewProps){
  const[mode,setMode]=useState<CalendarMode>('month');
  const[anchor,setAnchor]=useState(()=>zonedDateKey(new Date(),timeZone));
  useEffect(()=>setAnchor(zonedDateKey(new Date(),timeZone)),[timeZone]);
  const dates=useMemo(()=>calendarDates(anchor,mode),[anchor,mode]);
  const grouped=useMemo(()=>recordsByCalendarDate(rows,dates,timeZone),[rows,dates,timeZone]);
  const today=zonedDateKey(new Date(),timeZone);
  const invalidCount=rows.filter(row=>!calendarInterval(row)).length;
  const title=mode==='month'?new Intl.DateTimeFormat('en',{timeZone:'UTC',month:'long',year:'numeric'}).format(dateKeyDate(anchor)):mode==='day'?new Intl.DateTimeFormat('en',{timeZone:'UTC',weekday:'long',month:'long',day:'numeric',year:'numeric'}).format(dateKeyDate(anchor)):`${new Intl.DateTimeFormat('en',{timeZone:'UTC',month:'short',day:'numeric'}).format(dateKeyDate(dates[0]))} – ${new Intl.DateTimeFormat('en',{timeZone:'UTC',month:'short',day:'numeric',year:'numeric'}).format(dateKeyDate(dates[6]))}`;
  const shown=new Set([...grouped.values()].flat().map(row=>row.id)).size;
  const openDay=(key:string)=>{setAnchor(key);setMode('day')};
  const event=(row:RecordData,key:string,compact=false)=>{
    const interval=calendarInterval(row)!;const continues=zonedDateKey(interval.start,timeZone)<key;const carries=zonedDateKey(new Date(interval.end.getTime()-1),timeZone)>key;
    return <article className={`calendar-event ${compact?'compact':''} calendar-event-${String(row.status||'booked')}`} key={row.id}>
      <Link className="calendar-event-link" href={recordHref(row)} prefetch={false} title={`${recordLabel?.(row)||defaultLabel(module,row)} · ${fullDate(row.startsAt,timeZone)} – ${fullDate(row.endsAt,timeZone)}`}>
        <time className="calendar-event-time" dateTime={String(row.startsAt)}>{continues?'Continues':clockLabel(row.startsAt,timeZone)}{compact?'':` – ${carries?'continues':clockLabel(row.endsAt,timeZone)}`}</time>
        <strong>{recordLabel?.(row)||defaultLabel(module,row)}</strong>
        {!compact&&<Status value={row.status}/>}
      </Link>
      {!compact&&renderActions&&<div className="calendar-event-actions">{renderActions(row)}</div>}
    </article>;
  };
  return <section className="workflow-calendar" aria-label={`${module==='leave'?'Leave':'Appointments'} calendar`}>
    <div className="calendar-toolbar"><div className="calendar-navigation"><button type="button" className="icon-button" aria-label={`Previous ${mode}`} onClick={()=>setAnchor(stepCalendar(anchor,mode,-1))}><span aria-hidden="true">‹</span></button><button type="button" className="button secondary calendar-today" onClick={()=>setAnchor(today)}>Today</button><button type="button" className="icon-button" aria-label={`Next ${mode}`} onClick={()=>setAnchor(stepCalendar(anchor,mode,1))}><span aria-hidden="true">›</span></button><h2 aria-live="polite">{title}</h2></div><div className="calendar-mode" role="group" aria-label="Calendar period">{(['month','week','day'] as const).map(value=><button type="button" key={value} aria-pressed={mode===value} className={mode===value?'active':''} onClick={()=>setMode(value)}>{value}</button>)}</div></div>
    <div className="calendar-context"><span><Icon name="clock" size={14}/>{timeZone}</span><span>{shown} {shown===1?'record':'records'} in this {mode}</span></div>
    {mode==='day'?<div className="calendar-day-agenda">{grouped.get(anchor)?.length?grouped.get(anchor)!.map(row=>event(row,anchor)):<p className="calendar-empty-day">No {module==='leave'?'leave':'appointments'} on this date.</p>}</div>:<div className="calendar-scroll" tabIndex={0} role="region" aria-label={`${mode} calendar, scroll horizontally on smaller screens`}><table className={`calendar-grid calendar-grid-${mode}`}><caption className="sr-only">{title}. Times are in {timeZone}. Select a date to open its day view.</caption><thead><tr>{['Monday','Tuesday','Wednesday','Thursday','Friday','Saturday','Sunday'].map(day=><th scope="col" key={day}><abbr title={day}>{day.slice(0,3)}</abbr></th>)}</tr></thead><tbody>{Array.from({length:mode==='month'?6:1},(_,week)=><tr key={week}>{dates.slice(week*7,week*7+7).map(key=>{const items=grouped.get(key)||[];const compact=mode==='month';return <td key={key} className={`${key.slice(0,7)!==anchor.slice(0,7)&&mode==='month'?'outside-month':''} ${key===today?'is-today':''}`}><div className="calendar-day-heading"><button type="button" className="calendar-date" aria-current={key===today?'date':undefined} aria-label={`Open ${new Intl.DateTimeFormat('en',{timeZone:'UTC',dateStyle:'full'}).format(dateKeyDate(key))}`} onClick={()=>openDay(key)}>{Number(key.slice(-2))}</button>{items.length>0&&<span aria-label={`${items.length} records`}>{items.length}</span>}</div><div className="calendar-cell-events">{items.slice(0,compact?3:items.length).map(row=>event(row,key,compact))}{compact&&items.length>3&&<button type="button" className="calendar-more" onClick={()=>openDay(key)}>+{items.length-3} more</button>}{!compact&&!items.length&&<p className="calendar-empty-cell">No records</p>}</div></td>})}</tr>)}</tbody></table></div>}
    {invalidCount>0&&<p className="workflow-footnote">{invalidCount} {invalidCount===1?'record has':'records have'} no valid date range. Open the table to review.</p>}
  </section>;
}

export function KanbanView({module,rows,timeZone,recordHref,recordLabel,renderActions,onMove,canMove,busyId}:WorkflowViewProps){
  const[dragged,setDragged]=useState<string|null>(null);const[over,setOver]=useState<string|null>(null);const[moving,setMoving]=useState<string|null>(null);const[error,setError]=useState('');const[notice,setNotice]=useState('');
  const configured=kanbanColumns[module]||[];const unknown=[...new Set(rows.map(row=>workflowState(module,row)))].filter(state=>!configured.some(column=>column.id===state));const columns=[...configured,...unknown.map(id=>({id,label:workflowLabel(module,id)}))];
  const move=async(row:RecordData,target:string)=>{if(!onMove||(canMove&&!canMove(row))||moving||busyId||!allowedWorkflowTargets(module,row).includes(target))return;setMoving(row.id);setError('');setNotice('');try{await onMove(row,target);setNotice(`${recordLabel?.(row)||defaultLabel(module,row)}: ${workflowLabel(module,target)} requested.`)}catch(e){setError(errorMessage(e))}finally{setMoving(null);setDragged(null);setOver(null)}};
  const draggedRow=rows.find(row=>row.id===dragged);const validDrop=(id:string)=>Boolean(draggedRow&&onMove&&(!canMove||canMove(draggedRow))&&!moving&&!busyId&&allowedWorkflowTargets(module,draggedRow).includes(id));
  return <section className="workflow-kanban" aria-label={`${module==='leads'?'Inquiry':module==='tasks'?'Task':'Appointment'} progress board`}>
    <div className="kanban-help"><span>{onMove?'Move cards using the status control or drag to an available column.':'Open a card to review its details.'}{module==='leads'&&onMove?' Booked and closed stages open a page for the required details.':''}</span><span>{rows.length} {rows.length===1?'record':'records'}</span></div>
    {error&&<Alert>{error}</Alert>}{notice&&<p className="workflow-footnote" role="status">{notice}</p>}
    <div className="kanban-scroll" tabIndex={0} role="region" aria-label="Progress columns, scroll horizontally to see all stages"><div className="kanban-board">{columns.map(column=>{const items=rows.filter(row=>workflowState(module,row)===column.id);return <section className={`kanban-column ${over===column.id&&validDrop(column.id)?'is-drop-target':''}`} key={column.id} aria-label={`${column.label}, ${items.length} records`} onDragOver={e=>{if(validDrop(column.id)){e.preventDefault();e.dataTransfer.dropEffect='move';setOver(column.id)}}} onDragLeave={e=>{if(!e.currentTarget.contains(e.relatedTarget as Node|null))setOver(null)}} onDrop={e=>{e.preventDefault();const id=e.dataTransfer.getData('application/x-clinic-record');const row=rows.find(item=>item.id===id);if(row&&row.id===dragged&&validDrop(column.id))void move(row,column.id);setOver(null);setDragged(null)}}><header className="kanban-column-heading"><h3>{column.label}</h3><span>{items.length}</span></header><div className="kanban-cards">{items.map(row=>{const targets=canMove&&!canMove(row)?[]:allowedWorkflowTargets(module,row),busy=moving===row.id||busyId===row.id;const canDrag=Boolean(onMove&&targets.length&&!moving&&!busyId);const due=row.dueAt||row.callbackAt||row.startsAt;return <article className={`kanban-card ${dragged===row.id?'is-dragging':''}`} key={row.id} draggable={canDrag} aria-busy={busy} onDragStart={e=>{if(!canDrag){e.preventDefault();return}e.dataTransfer.setData('application/x-clinic-record',row.id);e.dataTransfer.effectAllowed='move';setDragged(row.id);setError('')}} onDragEnd={()=>{setDragged(null);setOver(null)}}><div className="kanban-card-top"><span className="kanban-card-reference">{row.id.slice(0,8)}</span>{Boolean(row.priority)&&<span className={`kanban-priority priority-${String(row.priority)}`}>{String(row.priority)}</span>}{canDrag&&<span className="kanban-grip" aria-hidden="true">⠿</span>}</div><Link className="kanban-record-link" href={recordHref(row)} prefetch={false}>{recordLabel?.(row)||defaultLabel(module,row)}</Link>{module==='leads'&&Boolean(row.interest)&&<p className="kanban-card-description">{String(row.interest)}</p>}{Boolean(due)&&<p className="kanban-date"><Icon name="clock" size={13}/><time dateTime={String(due)}>{fullDate(due,timeZone)}</time></p>}{onMove&&targets.length>0&&<label className="kanban-move"><span>{busy?'Updating…':'Move to'}</span><select aria-label={`Move ${recordLabel?.(row)||defaultLabel(module,row)}`} value="" disabled={Boolean(moving||busyId)} onChange={e=>{if(e.target.value)void move(row,e.target.value)}}><option value="">Choose stage…</option>{targets.map(target=><option value={target} key={target}>{workflowLabel(module,target)}{module==='leads'&&['booked','closed'].includes(target)?' · details required':''}</option>)}</select></label>}{renderActions&&<div className="kanban-card-actions">{renderActions(row)}</div>}</article>})}{items.length===0&&<p className="kanban-empty">No records in this stage</p>}</div></section>})}</div></div>
  </section>;
}
