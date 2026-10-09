/* Author: ramanpal singh | URL: https://kwebby.com */
import type {RecordData} from './types.js';
import {zonedDateKey} from './datetime.js';

export type CalendarMode = 'month' | 'week' | 'day';
export interface WorkflowColumn {id:string;label:string}
export const kanbanColumns:Record<string,WorkflowColumn[]> = {
  appointments:[{id:'booked',label:'Booked'},{id:'arrived',label:'Arrived'},{id:'in-progress',label:'In consultation'},{id:'completed',label:'Completed'},{id:'cancelled',label:'Cancelled'},{id:'no-show',label:'No-show'}],
  tasks:[{id:'open',label:'Open'},{id:'in-progress',label:'In progress'},{id:'blocked',label:'Blocked'},{id:'completed',label:'Completed'}],
  leads:[{id:'new',label:'New'},{id:'contacted',label:'Contacted'},{id:'qualified',label:'Qualified'},{id:'booked',label:'Booked'},{id:'closed',label:'Closed'}],
};
const transitions:Record<string,Record<string,string[]>> = {
  appointments:{booked:['arrived','cancelled','no-show'],arrived:['in-progress','cancelled'],'in-progress':['completed'],completed:[],cancelled:[],'no-show':[]},
  tasks:{open:['in-progress','blocked','completed'],'in-progress':['open','blocked','completed'],blocked:['open','in-progress','completed'],completed:['open']},
  leads:{new:['contacted','qualified','closed'],contacted:['qualified','booked','closed'],qualified:['booked','closed'],booked:['closed'],closed:['new']},
};
export function workflowState(module:string,row:RecordData):string {return String(row[module==='leads'?'stage':'status']||'');}
/** Only expose transitions supported by the domain. Authorization is still enforced by the API. */
export function allowedWorkflowTargets(module:string,row:RecordData):string[] {const states=Object.hasOwn(transitions,module)?transitions[module]:{},state=workflowState(module,row);return Object.hasOwn(states,state)?states[state]:[];}
export function workflowLabel(module:string,status:string):string {return kanbanColumns[module]?.find(column=>column.id===status)?.label||status.replaceAll('-',' ')||'Unspecified';}

/** Date keys are calendar coordinates, never browser-local timestamps. */
export function dateKeyDate(key:string):Date {return new Date(`${key}T12:00:00.000Z`);}
export function shiftDateKey(key:string,days:number):string {const date=dateKeyDate(key);date.setUTCDate(date.getUTCDate()+days);return date.toISOString().slice(0,10);}
export function calendarDates(anchor:string,mode:CalendarMode):string[] {
  if(mode==='day')return [anchor];
  const date=dateKeyDate(mode==='month'?`${anchor.slice(0,7)}-01`:anchor);
  const start=shiftDateKey(date.toISOString().slice(0,10),-((date.getUTCDay()+6)%7));
  return Array.from({length:mode==='month'?42:7},(_,index)=>shiftDateKey(start,index));
}
export function stepCalendar(anchor:string,mode:CalendarMode,direction:number):string {
  if(mode!=='month')return shiftDateKey(anchor,direction*(mode==='week'?7:1));
  const date=dateKeyDate(`${anchor.slice(0,7)}-01`);date.setUTCMonth(date.getUTCMonth()+direction);return date.toISOString().slice(0,10);
}
/** Monday-first weekday names in the clinic's language. */
export function weekdayNames(locale:string,width:'long'|'short'='long'):string[] {
  let format:Intl.DateTimeFormat;try{format=new Intl.DateTimeFormat(locale,{weekday:width,timeZone:'UTC'})}catch{format=new Intl.DateTimeFormat('en',{weekday:width,timeZone:'UTC'})}
  return Array.from({length:7},(_,index)=>format.format(dateKeyDate(shiftDateKey('2024-01-01',index))));
}
export function calendarInterval(row:RecordData):{start:Date;end:Date}|null {
  const start=new Date(String(row.startsAt||'')),end=new Date(String(row.endsAt||''));
  return Number.isFinite(start.getTime())&&Number.isFinite(end.getTime())&&end>start?{start,end}:null;
}
/** The ending instant is exclusive; midnight and DST changes do not create an extra day. */
export function recordFallsOnDate(row:RecordData,key:string,timeZone:string):boolean {
  const interval=calendarInterval(row);if(!interval)return false;
  return zonedDateKey(interval.start,timeZone)<=key&&zonedDateKey(new Date(interval.end.getTime()-1),timeZone)>=key;
}
export function recordsByCalendarDate(rows:RecordData[],dates:string[],timeZone:string):Map<string,RecordData[]> {
  const result=new Map<string,RecordData[]>(dates.map(key=>[key,[]]));
  for(const row of rows){const interval=calendarInterval(row);if(!interval)continue;const first=zonedDateKey(interval.start,timeZone),last=zonedDateKey(new Date(interval.end.getTime()-1),timeZone);for(const key of dates)if(first<=key&&key<=last)result.get(key)!.push(row);}
  for(const records of result.values())records.sort((a,b)=>Date.parse(String(a.startsAt))-Date.parse(String(b.startsAt))||a.id.localeCompare(b.id));
  return result;
}
