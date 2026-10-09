/* Author: ramanpal singh | URL: https://kwebby.com */
import {describe,expect,it} from 'vitest';
import {allowedWorkflowTargets,calendarDates,recordFallsOnDate,recordsByCalendarDate,stepCalendar,workflowState} from '../../apps/web/lib/workflow-views.js';
const event=(startsAt:string,endsAt:string,id='event')=>({id,version:1,startsAt,endsAt});

describe('clinic calendar dates',()=>{
  it('lays out full Monday-first weeks without browser timezone arithmetic',()=>{
    const dates=calendarDates('2026-10-09','month');expect(dates).toHaveLength(42);expect(dates[0]).toBe('2026-09-28');expect(dates[41]).toBe('2026-11-08');
    expect(calendarDates('2026-10-11','week')).toEqual(['2026-10-05','2026-10-06','2026-10-07','2026-10-08','2026-10-09','2026-10-10','2026-10-11']);
    expect(calendarDates('2026-10-09','day')).toEqual(['2026-10-09']);
  });
  it('moves across month/year/leap boundaries without skipping February',()=>{
    expect(stepCalendar('2028-01-31','month',1)).toBe('2028-02-01');expect(stepCalendar('2028-02-28','day',1)).toBe('2028-02-29');expect(stepCalendar('2026-12-31','week',1)).toBe('2027-01-07');expect(stepCalendar('2026-01-09','month',-1)).toBe('2025-12-01');
  });
  it('uses the clinic date and excludes midnight at the end of a multi-day interval',()=>{
    const row=event('2026-10-09T23:45:00Z','2026-10-11T18:30:00Z');expect(recordFallsOnDate(row,'2026-10-09','Asia/Kolkata')).toBe(false);expect(recordFallsOnDate(row,'2026-10-10','Asia/Kolkata')).toBe(true);expect(recordFallsOnDate(row,'2026-10-11','Asia/Kolkata')).toBe(true);expect(recordFallsOnDate(row,'2026-10-12','Asia/Kolkata')).toBe(false);
  });
  it('keeps leave on the correct local days over both daylight saving transitions',()=>{
    const spring=event('2026-03-08T05:00:00Z','2026-03-09T04:00:00Z');expect(recordFallsOnDate(spring,'2026-03-08','America/New_York')).toBe(true);expect(recordFallsOnDate(spring,'2026-03-09','America/New_York')).toBe(false);
    const fall=event('2026-11-01T04:00:00Z','2026-11-02T05:00:00Z');expect(recordFallsOnDate(fall,'2026-11-01','America/New_York')).toBe(true);expect(recordFallsOnDate(fall,'2026-11-02','America/New_York')).toBe(false);
  });
  it('groups chronologically and omits invalid intervals rather than inventing dates',()=>{
    const rows=[event('2026-10-09T12:00Z','2026-10-09T13:00Z','later'),event('2026-10-09T09:00Z','2026-10-09T10:00Z','earlier'),event('bad','bad','invalid'),event('2026-10-09T12:00Z','2026-10-09T11:00Z','backwards')];const grouped=recordsByCalendarDate(rows,['2026-10-09','2026-10-10'],'UTC');expect(grouped.get('2026-10-09')?.map(row=>row.id)).toEqual(['earlier','later']);expect(grouped.get('2026-10-10')).toEqual([]);
  });
});
describe('progress board domain transitions',()=>{
  it('prevents skipped appointment steps and reopening terminal visits',()=>{
    expect(allowedWorkflowTargets('appointments',{id:'a',version:1,status:'booked'})).toEqual(['arrived','cancelled','no-show']);expect(allowedWorkflowTargets('appointments',{id:'a',version:1,status:'in-progress'})).toEqual(['completed']);for(const status of ['completed','cancelled','no-show'])expect(allowedWorkflowTargets('appointments',{id:'a',version:1,status})).toEqual([]);
  });
  it('supports task progress and reopening, and reads inquiry stage separately',()=>{
    expect(allowedWorkflowTargets('tasks',{id:'t',version:1,status:'open'})).toEqual(['in-progress','blocked','completed']);expect(allowedWorkflowTargets('tasks',{id:'t',version:1,status:'in-progress'})).toEqual(['open','blocked','completed']);expect(allowedWorkflowTargets('tasks',{id:'t',version:1,status:'blocked'})).toEqual(['open','in-progress','completed']);expect(allowedWorkflowTargets('tasks',{id:'t',version:1,status:'completed'})).toEqual(['open']);const row={id:'l',version:1,status:'unused',stage:'qualified'};expect(workflowState('leads',row)).toBe('qualified');expect(allowedWorkflowTargets('leads',row)).toEqual(['booked','closed']);expect(allowedWorkflowTargets('leads',{...row,stage:'closed'})).toEqual(['new']);expect(allowedWorkflowTargets('unrecognized',row)).toEqual([]);
  });
});
