/* Author: ramanpal singh | URL: https://kwebby.com */
import {beforeEach,describe,expect,it} from 'vitest';
import {activateDraftIdentity,clearDraftMemory,draftIdentity,readMemoryDraft,removeMatchingMemoryDraft,removeMemoryDraft,writeMemoryDraft} from '../../apps/web/lib/draft-memory.js';
const identity=draftIdentity({organizationId:'clinic',id:'doctor'});
const draft={values:{title:'Unsaved visit',content:[{type:'paragraph',content:'Draft narrative'}]},baseline:'{}',expectedVersion:4,idempotencyKey:'request-id'};
beforeEach(()=>{clearDraftMemory();activateDraftIdentity(identity)});
describe('private tab draft memory',()=>{
  it('preserves conflict and idempotency metadata without sharing mutable references',()=>{
    writeMemoryDraft(identity,'record',draft,100);const restored=readMemoryDraft(identity,'record',101)!;
    expect(restored).toEqual(draft);restored.values.title='Changed in another form';expect(readMemoryDraft(identity,'record',102)?.values.title).toBe('Unsaved visit');
  });
  it('expires after thirty minutes without extending lifetime merely by reading',()=>{
    writeMemoryDraft(identity,'record',draft,100);expect(readMemoryDraft(identity,'record',100+30*60*1000-1)).not.toBeNull();expect(readMemoryDraft(identity,'record',100+30*60*1000)).toBeNull();
  });
  it('keeps only the twenty most recently changed drafts',()=>{
    for(let index=0;index<21;index++)writeMemoryDraft(identity,String(index),draft,100+index);
    expect(readMemoryDraft(identity,'0',130)).toBeNull();expect(readMemoryDraft(identity,'1',130)).not.toBeNull();expect(readMemoryDraft(identity,'20',130)).not.toBeNull();
  });
  it('clears on logout and account change and rejects a late write from the old account',()=>{
    writeMemoryDraft(identity,'record',draft,100);activateDraftIdentity('another-account');expect(readMemoryDraft(identity,'record',101)).toBeNull();writeMemoryDraft(identity,'late-save',draft,102);expect(readMemoryDraft('another-account','late-save',103)).toBeNull();
    activateDraftIdentity(identity);expect(readMemoryDraft(identity,'record',104)).toBeNull();writeMemoryDraft(identity,'record',draft,105);clearDraftMemory();activateDraftIdentity(identity);expect(readMemoryDraft(identity,'record',106)).toBeNull();
  });
  it('keeps drafts across session refreshes for the same account',()=>{
    writeMemoryDraft(identity,'record',draft,100);activateDraftIdentity(identity);expect(readMemoryDraft(identity,'record',101)).toEqual(draft);
  });
  it('explicit discard clears the draft; successful older saves retain newer unsaved values',()=>{
    writeMemoryDraft(identity,'record',draft,100);removeMatchingMemoryDraft(identity,'record',{title:'Earlier value'});expect(readMemoryDraft(identity,'record',101)).not.toBeNull();removeMatchingMemoryDraft(identity,'record',draft.values);expect(readMemoryDraft(identity,'record',102)).toBeNull();
    writeMemoryDraft(identity,'record',draft,103);removeMemoryDraft(identity,'record');expect(readMemoryDraft(identity,'record',104)).toBeNull();
  });
});
