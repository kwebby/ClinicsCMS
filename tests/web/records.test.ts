/* Author: ramanpal singh | URL: https://kwebby.com */
import {describe,expect,it} from 'vitest';
import {cleanValues,collectPages,listPath,loginPath,mergeRecords,nextCursor,safeNextPath,sortByActivity,sortCreated,uniqueIds,updateValues} from '../../apps/web/lib/records.js';
const row=(id:string,extra:Record<string,unknown>={})=>({id,version:1,...extra});

describe('bounded record list requests',()=>{
  it('encodes filters, trimmed search, order, a clamped limit and the cursor',()=>{
    expect(listPath('patients')).toBe('/records/patients');
    expect(listPath('appointments',{eq:{status:'arrived',branchId:undefined,doctorId:''},q:'  Asha & Ravi ',order:'desc',limit:900,after:'01a2'})).toBe('/records/appointments?status=arrived&q=Asha+%26+Ravi&order=desc&limit=500&after=01a2');
    expect(new URLSearchParams(listPath('patients',{q:'x'.repeat(150)}).split('?')[1]).get('q')).toHaveLength(100);
    expect(listPath('tasks',{limit:0.5})).toBe('/records/tasks?limit=1');
  });
  it('follows cursors until a short page and reports a window that stopped early',async()=>{
    const pages:Record<string,string[]>={'':['a','b'],b:['c','d'],d:['e']};const cursors:string[]=[];
    const fetch=async(after:string)=>{cursors.push(after);return {data:(pages[after]||[]).map(id=>row(id))}};
    expect(await collectPages(fetch,2)).toEqual({rows:['a','b','c','d','e'].map(id=>row(id)),complete:true});expect(cursors).toEqual(['','b','d']);
    const window=await collectPages(fetch,2,4);expect(window.complete).toBe(false);expect(window.rows.map(r=>r.id)).toEqual(['a','b','c','d']);
  });
  it('refuses a cursor that does not advance instead of looping forever',async()=>{
    await expect(collectPages(async()=>({data:[row('same'),row('same')]}),2)).rejects.toThrow('could not continue');
  });
  it('continues past a short or empty page while the server still sends a cursor, and stops when it does not',async()=>{
    const pages:Record<string,{data:string[];next?:string}>={'':{data:['a'],next:'k'},k:{data:[],next:'p'},p:{data:['q','r']},r:{data:[]}};
    const result=await collectPages(async after=>({data:pages[after].data.map(id=>row(id)),...(pages[after].next?{next:pages[after].next}:{})}),2);
    expect(result).toEqual({rows:['a','q','r'].map(id=>row(id)),complete:true});
    expect(nextCursor({data:[row('a'),row('b')]},2)).toBe('b');expect(nextCursor({data:[row('a')]},2)).toBe('');expect(nextCursor({data:[],next:'z'},2)).toBe('z');
  });
});

describe('record ordering',()=>{
  it('orders by creation time, using the id only to break ties, so legacy random ids still read chronologically',()=>{
    const rows=[row('f-legacy',{createdAt:'2026-01-02T00:00:00Z'}),row('0-new',{createdAt:'2026-03-01T00:00:00Z'}),row('b',{createdAt:'2026-01-02T00:00:00Z'}),row('a')];
    expect(sortCreated(rows).map(r=>r.id)).toEqual(['a','b','f-legacy','0-new']);
    expect(sortCreated(rows,true).map(r=>r.id)).toEqual(['0-new','f-legacy','b','a']);
    expect(rows[0].id).toBe('f-legacy');
  });
  it('puts conversations with the latest message first and ignores read-receipt updates',()=>{
    const rooms=[row('quiet',{createdAt:'2026-01-01T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z'}),row('busy',{createdAt:'2025-01-01T00:00:00Z',lastMessageAt:'2026-10-08T00:00:00Z'}),row('new',{createdAt:'2026-05-01T00:00:00Z'})];
    expect(sortByActivity(rooms).map(r=>r.id)).toEqual(['busy','new','quiet']);
  });
  it('merges a further page without duplicates and keeps refreshed copies in place',()=>{
    expect(mergeRecords([row('a'),row('b',{v:1})],[row('b',{v:2}),row('c')])).toEqual([row('a'),row('b',{v:2}),row('c')]);
    expect(uniqueIds(['p1',undefined,'p1','',3,'p2'])).toEqual(['p1','p2']);
  });
});

describe('record payloads',()=>{
  it('omits empty fields when creating',()=>{
    expect(cleanValues({name:'Asha',email:'',phone:undefined,notes:null,count:0,active:false})).toEqual({name:'Asha',notes:null,count:0,active:false});
  });
  it('sends null for a cleared field that had a value and leaves untouched blanks out',()=>{
    const original={name:'Asha',email:'asha@example.invalid',phone:'',weight:0,dueAt:'2026-10-09T10:00:00Z'};
    expect(updateValues({name:'Asha K',email:'',phone:'',weight:'',dueAt:'',address:''},original)).toEqual({name:'Asha K',email:null,weight:null,dueAt:null});
    expect(updateValues({active:false,tags:[]},{active:true,tags:['a']})).toEqual({active:false,tags:[]});
  });
});

describe('sign-in return path',()=>{
  it('keeps same-origin relative paths with their query and fragment',()=>{
    expect(safeNextPath('/workspace/patients/p1?view=board#notes')).toBe('/workspace/patients/p1?view=board#notes');
    expect(safeNextPath('/portal')).toBe('/portal');
  });
  it('rejects open redirects and sign-in loops',()=>{
    for(const value of ['//evil.example','/\\evil.example','\\\\evil.example','https://evil.example','javascript:alert(1)','workspace','/%2e%2e//evil.example','/\tevil','/ok\nLocation: x','/login?next=/x','/register','',null,undefined,42])expect(safeNextPath(value),String(value)).toBeUndefined();
  });
  it('builds the sign-in link only for a useful return path',()=>{
    expect(loginPath('/workspace/tasks?view=board')).toBe('/login?next=%2Fworkspace%2Ftasks%3Fview%3Dboard');
    expect(loginPath('/')).toBe('/login');expect(loginPath('//evil.example')).toBe('/login');
  });
});
