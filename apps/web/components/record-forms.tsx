/* Author: ramanpal singh | URL: https://kwebby.com */
'use client';
import {useEffect,useState,useCallback,useRef} from 'react';
import {api,action,errorMessage,ApiError} from '@/lib/api';
import {modules} from '@/lib/modules';
import type {RecordData,ActionDefinition} from '@/lib/types';
import {draftIdentity,readMemoryDraft,writeMemoryDraft,removeMemoryDraft,removeMatchingMemoryDraft} from '@/lib/draft-memory';
import {useSession,useClinicTime} from './session';
import {Alert} from './ui';
import {FormFields,initialValues,cleanValues,updateValues} from './forms';
import {AiDraft} from './ai-draft';

export function RecordEditor({module,record,onSave,onCancel}:{module:string;record?:RecordData;onSave:(record?:RecordData)=>void;onCancel:()=>void}){
  const def=modules[module],{session}=useSession(),localization=useClinicTime();
  const identity=session?draftIdentity(session.user):'',cacheKey=JSON.stringify(['record',module,record?.id||'new']);
  const [initial]=useState(()=>{
    const values=initialValues(def.fields,record,session?.user.branchIds[0]);
    if(!record){
      if('currency' in values)values.currency=localization.currency;
      if(module==='employees')values.salary={currency:localization.currency,base:'0',earnings:[],deductions:[]};
      if(module==='conversations'&&session?.user.roles.every(role=>role==='patient')){values.kind='patient-service';values.patientId=session.user.patientIds[0]||'';}
    }
    const cached=readMemoryDraft(identity,cacheKey);
    return {values:cached?.values||values,baseline:cached?.baseline||JSON.stringify(values),version:cached?cached.expectedVersion:record?.version,restored:Boolean(cached),conflict:Boolean(cached&&cached.expectedVersion!==record?.version)};
  });
  const [values,setValues]=useState<Record<string,unknown>>(initial.values),[busy,setBusy]=useState(false),[error,setError]=useState(initial.conflict?'The record changed after this draft was started. Your unsaved edits are retained. Review the latest record before applying them.':''),[saveState,setSaveState]=useState(''),[restored,setRestored]=useState(initial.restored),[discarding,setDiscarding]=useState(false);
  const version=useRef(initial.version),persisted=useRef<Record<string,unknown>>(record||{}),latest=useRef(values),savedJson=useRef(initial.baseline),saving=useRef(false),conflicted=useRef(initial.conflict),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  const remember=useCallback((next:Record<string,unknown>)=>{
    if(savedJson.current===JSON.stringify(next))removeMemoryDraft(identity,cacheKey);
    else writeMemoryDraft(identity,cacheKey,{values:next,baseline:savedJson.current,expectedVersion:version.current});
  },[identity,cacheKey]);
  const changeValues=useCallback((next:Record<string,unknown>)=>{if(!record&&saving.current)return;latest.current=next;setValues(next);remember(next)},[remember,record]);
  const autosave=Boolean(record&&['encounters','pages'].includes(module)&&record.status==='draft');
  const persist=useCallback(async(close=false)=>{
    if(saving.current||conflicted.current)return;
    saving.current=true;const submitted=structuredClone(latest.current);setBusy(true);setError('');setSaveState('Saving…');
    try{
      const result=record&&module==='prescriptions'?
        await action<RecordData>('prescriptions.save',{id:record.id,expectedVersion:version.current,...Object.fromEntries(Object.entries(cleanValues(submitted)).filter(([key])=>['medications','instructions'].includes(key)))}):
        record&&module==='encounters'?
        await action<RecordData>('encounters.save',{id:record.id,expectedVersion:version.current,...Object.fromEntries(Object.entries(cleanValues(submitted)).filter(([key])=>['content','observations','diagnosis','followUpAt'].includes(key)))}):
        await api<RecordData>(`/records/${module}${record?'/'+encodeURIComponent(record.id):''}`,{method:record?'PATCH':'POST',body:(()=>{const payload={...submitted,...(module==='invoices'&&Array.isArray(submitted.lines)?{lines:(submitted.lines as Record<string,unknown>[]).map(line=>Object.fromEntries(Object.entries(line).filter(([key])=>['description','quantity','unitPrice','taxRate','discount'].includes(key))))}:{})};
          // On edit, an emptied optional field is sent as null so the server clears it; create omits empty fields.
          return record?{...updateValues(payload,persisted.current),expectedVersion:version.current}:cleanValues(payload)})()});
      version.current=result.version;savedJson.current=JSON.stringify(submitted);persisted.current={...persisted.current,...submitted};
      const current=mounted.current?latest.current:(readMemoryDraft(identity,cacheKey)?.values||latest.current);
      const unchanged=JSON.stringify(current)===savedJson.current;
      if(unchanged)removeMatchingMemoryDraft(identity,cacheKey,submitted);
      else writeMemoryDraft(identity,cacheKey,{values:current,baseline:savedJson.current,expectedVersion:result.version});
      if(mounted.current){setSaveState(unchanged?'All changes saved':'Newer edits are retained. Save them before leaving.');setRestored(false);if(close&&unchanged)onSave(result);}
    }catch(e){
      remember(latest.current);
      if(mounted.current){setError(errorMessage(e));setSaveState('Not saved');if(e instanceof ApiError&&e.status===409){conflicted.current=true;setError('Someone changed this record. Your edits are retained in this tab. Review the latest record version before applying them.');}}
    }finally{saving.current=false;if(mounted.current)setBusy(false)}
  },[module,record,onSave,identity,cacheKey,remember]);
  useEffect(()=>{
    latest.current=values;remember(values);
    if(savedJson.current===JSON.stringify(values))return;
    setSaveState(autosave&&!conflicted.current?'Unsaved changes · saving shortly':'Unsaved changes');
    if(!autosave||conflicted.current||busy)return;
    const timeout=setTimeout(()=>void persist(),1800);return()=>clearTimeout(timeout);
  },[values,autosave,persist,busy,remember]);
  const discard=()=>{removeMemoryDraft(identity,cacheKey);onCancel()};
  return <form onSubmit={event=>{event.preventDefault();void persist(true)}} className="record-form">
    {restored&&<Alert kind="info">Your unsaved draft was restored from this tab. {initial.conflict?'It will not save automatically because the record has changed.':autosave?'Draft autosave continues.':'Review it before saving.'} Drafts stay in memory for 30 minutes; save before refreshing or closing this tab.</Alert>}
    {error&&<Alert>{error}</Alert>}
    <fieldset disabled={busy&&!record} inert={busy&&!record} aria-busy={busy&&!record} style={{border:0,margin:0,padding:0,minWidth:0}}>
    <FormFields fields={def.fields} values={values} onChange={changeValues} publicContent={module==='pages'}/>
    {['encounters','pages','leads'].includes(module)&&<AiDraft task={module==='encounters'?'consultation':module==='pages'?'education':'administrative'} input={values} onAccept={text=>{const key=module==='leads'?'notes':'content';changeValues({...latest.current,[key]:[...(Array.isArray(latest.current[key])?latest.current[key] as unknown[]:[]),{type:'paragraph',content:[{type:'text',text,styles:{}}]}]})}}/>}
    </fieldset>
    <footer className="form-footer"><span role="status">{saveState||(autosave?'Draft changes save automatically':'Changes are private until saved')} {!autosave&&'Save before refreshing or closing this tab.'}</span><button type="button" className="button secondary" disabled={busy} onClick={()=>{if(savedJson.current!==JSON.stringify(latest.current))setDiscarding(true);else onCancel()}}>Cancel</button><button className="button primary" disabled={busy||conflicted.current}>{busy?'Saving…':'Save '+def.singular.toLowerCase()}</button></footer>
    {discarding&&<div className="inline-decision" role="status"><p>There are unsaved changes on this page.</p><button type="button" className="button secondary" onClick={()=>setDiscarding(false)}>Keep editing</button><button type="button" className="button danger" disabled={busy} onClick={discard}>Discard changes and leave</button></div>}
  </form>;
}

export function ActionForm({definition,record,onDone,seed={}}:{definition:ActionDefinition;record:RecordData;onDone:(record?:RecordData)=>void;seed?:Record<string,unknown>}){
  const {session}=useSession(),identity=session?draftIdentity(session.user):'',cacheKey=JSON.stringify(['action',definition.action,record.id]);
  const [initial]=useState(()=>{const values={...initialValues(definition.fields||[]),...seed};const cached=readMemoryDraft(identity,cacheKey);return {values:cached?.values||values,defaults:values,baseline:cached?.baseline||JSON.stringify(values),version:cached?cached.expectedVersion:record.version,idempotencyKey:cached?.idempotencyKey||crypto.randomUUID(),restored:Boolean(cached),conflict:Boolean(cached&&cached.expectedVersion!==record.version)}});
  const [values,setValues]=useState<Record<string,unknown>>(initial.values),[busy,setBusy]=useState(false),[error,setError]=useState(initial.conflict?'The record changed after this draft was started. Review your retained values, then return to the latest record or explicitly discard this draft.':''),[restored,setRestored]=useState(initial.restored),[conflict,setConflict]=useState(initial.conflict);
  const key=useRef(initial.idempotencyKey),version=useRef(initial.version),baseline=useRef(initial.baseline),latest=useRef(values),sending=useRef(false),mounted=useRef(true);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false}},[]);
  const remember=(next:Record<string,unknown>,force=false)=>{if(!force&&JSON.stringify(next)===baseline.current)removeMemoryDraft(identity,cacheKey);else writeMemoryDraft(identity,cacheKey,{values:next,baseline:baseline.current,expectedVersion:version.current,idempotencyKey:key.current})};
  const changeValues=(next:Record<string,unknown>)=>{if(sending.current)return;latest.current=next;setValues(next);remember(next)};
  const discard=()=>{removeMemoryDraft(identity,cacheKey);const next=structuredClone(initial.defaults);latest.current=next;baseline.current=JSON.stringify(next);version.current=record.version;key.current=crypto.randomUUID();setValues(next);setRestored(false);setConflict(false);setError('')};
  return <form className="record-form" onSubmit={async event=>{
    event.preventDefault();if(sending.current||conflict)return;sending.current=true;setBusy(true);setError('');const submitted=structuredClone(latest.current);remember(submitted,true);
    try{
      const body={...(definition.idKey?{[definition.idKey]:record.id,idempotencyKey:key.current}:{id:record.id,...(!['notifications.read','conversations.read'].includes(definition.action)?{expectedVersion:version.current}:{})}),...cleanValues(submitted)};
      const result=await action<RecordData>(definition.action,body);removeMatchingMemoryDraft(identity,cacheKey,submitted);if(mounted.current)onDone(result);
    }catch(err){if(mounted.current){setError(errorMessage(err));if(err instanceof ApiError&&err.status===409){setConflict(true);setError('The record changed or this action is no longer available. Your draft is retained. Return to the record to review its latest state.');}}}
    finally{sending.current=false;if(mounted.current)setBusy(false)}
  }}>
    {restored&&<Alert kind="info">Your unsaved action draft was restored from this tab. Review it before submitting; nothing was sent automatically. Drafts expire after 30 minutes. <button type="button" className="text-button" disabled={busy} onClick={discard}>Discard restored draft</button></Alert>}
    {definition.hint&&<Alert kind="info">{definition.hint}</Alert>}{error&&<Alert>{error}</Alert>}
    <fieldset disabled={busy} inert={busy} aria-busy={busy} style={{border:0,margin:0,padding:0,minWidth:0}}><FormFields fields={definition.fields||[]} values={values} onChange={changeValues} branchId={record.branchId?String(record.branchId):undefined}/></fieldset>
    <footer className="form-footer"><span>Changes will be recorded in the audit history. Save before refreshing or closing this tab.</span><button className="button primary" disabled={busy||conflict}>{busy?'Saving…':definition.label}</button></footer>
  </form>;
}
export function PaymentCheckout({invoiceId}:{invoiceId:string}){const[busy,setBusy]=useState('');const[error,setError]=useState('');return <><select aria-label="Online payment provider" value="" disabled={Boolean(busy)} onChange={async e=>{const provider=e.target.value;if(!provider)return;setBusy(provider);setError('');try{const result=await api<{url?:string;checkoutUrl?:string;orderId?:string}>(`/payments/${provider}/checkout`,{method:'POST',body:{invoiceId,idempotencyKey:crypto.randomUUID()}});const url=result.url||result.checkoutUrl;if(url&&new URL(url).protocol==='https:')window.location.assign(url);else setError(result.orderId?`Payment order ${result.orderId} created. Complete payment using the configured provider.`:'Payment provider did not return a checkout URL.')}catch(err){setError(errorMessage(err))}finally{setBusy('')}}}><option value="">{busy?'Opening checkout…':'Pay online…'}</option><option value="stripe">Stripe</option><option value="razorpay">Razorpay</option></select>{error&&<Alert>{error}</Alert>}</>}
