/* Author: ramanpal singh | URL: https://kwebby.com */
import {canAccess, modules, writeRoles} from './modules';
import type {Actor, RecordData, ActionDefinition} from './types';
import {allowedWorkflowTargets} from './workflow-views';

export const recordPath = (module: string, id: string) => `/workspace/${encodeURIComponent(module)}/${encodeURIComponent(id)}`;
export const actionPath = (module: string, id: string, action: string) => `${recordPath(module,id)}/actions/${encodeURIComponent(action)}`;
export function mayMove(module: string, row: RecordData, actor: Actor): boolean {
  const allowed = module === 'tasks' ? modules.tasks.actions?.find(action=>action.action==='tasks.complete')?.roles : writeRoles[module];
  if (!canAccess(actor.roles, allowed || [])) return false;
  return module !== 'tasks' || row.assignedTo === actor.id || actor.roles.some(r=>['owner','admin','manager'].includes(r));
}
export function mayEdit(module: string, record: RecordData, actor: Actor): boolean {
  if (!canAccess(actor.roles,writeRoles[module]||[]) || modules[module]?.readonly || !['patients','leads','tasks','employees','invoices','pages','templates','conversations','services','availability','encounters','prescriptions'].includes(module)) return false;
  if (['signed','issued','partially-paid','paid','approved'].includes(String(record.status))) return false;
  if (module==='encounters' && !actor.roles.includes('nurse') && record.doctorId!==actor.id) return false;
  if (module==='prescriptions' && record.doctorId!==actor.id) return false;
  return true;
}
/** Presentation hints only. All changes still pass through the versioned, authorized domain action. */
export function recordActions(module: string, record: RecordData, actor: Actor): ActionDefinition[] {
  return (modules[module]?.actions || []).filter(def=>{
    if (!canAccess(actor.roles,def.roles||writeRoles[module]||['owner','admin','accountant'])) return false;
    if (def.match && !Object.entries(def.match).every(([key,values])=>values.includes(String(record[key])))) return false;
    if (['appointments.status','leads.transition'].includes(def.action)) return allowedWorkflowTargets(module,record).length>0;
    if (def.action==='appointments.reschedule') return record.status==='booked';
    if (def.action==='tasks.complete') return record.status!=='completed' && mayMove(module,record,actor);
    if (def.action==='leave.approve') return record.status==='pending';
    if (def.action==='notifications.read') return !record.read;
    if (def.action==='referrals.complete') return record.status==='open';
    if (def.action.endsWith('.release') && record.released) return false;
    if (def.action==='results.review') return record.reviewState==='pending' && [record.reviewerId,record.coveringReviewerId].includes(actor.id);
    if (def.action==='results.contact') return record.reviewState==='reviewed' && record.contactState!=='communicated';
    if (def.action==='results.action') return actor.roles.includes('doctor') && record.actionState==='required' && [record.reviewerId,record.coveringReviewerId].includes(actor.id);
    if (def.action==='results.release') return record.reviewState==='reviewed' && [record.reviewerId,record.coveringReviewerId].includes(actor.id);
    if (['encounters.sign','encounters.amend','prescriptions.sign'].includes(def.action)) return record.doctorId===actor.id;
    if (def.action==='payments.record') return ['issued','partially-paid'].includes(String(record.status));
    return true;
  }).map(def=>['appointments.status','leads.transition'].includes(def.action)?{...def,fields:def.fields?.map(field=>['status','stage'].includes(field.key)?{...field,options:allowedWorkflowTargets(module,record)}:field)}:def);
}
