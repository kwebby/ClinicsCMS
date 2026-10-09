/* Author: ramanpal singh | URL: https://kwebby.com */
import { Actor, Collection, Entity, Role, assert } from '../../contracts/src/index.js';

export const adminRoles:Role[]=['owner','admin'];
export const clinicalRoles:Role[]=['doctor','nurse'];
export const staffRoles:Role[]=['owner','admin','manager','doctor','nurse','receptionist','accountant','hr','editor','employee'];
export const hasRole=(actor:Actor,...roles:Role[])=>actor.roles.some(r=>roles.includes(r));
const readRoles:Record<Collection,Role[]>={
 patients:['owner','admin','manager','doctor','nurse','receptionist','accountant','patient'],
 appointments:['owner','admin','manager','doctor','nurse','receptionist','patient'],
 encounters:['doctor','nurse','patient'], prescriptions:['doctor','nurse','patient'], results:['doctor','nurse','patient'], referrals:['doctor','nurse','patient'],
 tasks:['owner','admin','manager','doctor','nurse','receptionist','accountant','hr','editor','employee'],
 leads:['owner','admin','manager','receptionist'], employees:['owner','admin','manager','hr','employee','doctor','nurse','receptionist','accountant','editor'],
 invoices:['owner','admin','manager','receptionist','accountant','patient'],payments:['owner','admin','manager','accountant','patient'],refunds:['owner','admin','manager','accountant','patient'],payroll:['owner','admin','hr','accountant'],
 documents:['owner','admin','doctor','nurse','accountant','hr','patient','employee','receptionist','manager','editor'],
 pages:['owner','admin','manager','editor','doctor'], templates:['owner','admin','manager','accountant','hr','editor'],themes:['owner','admin','editor'],publications:['owner','admin','editor'],
 conversations:staffRoles.concat('patient'),messages:staffRoles.concat('patient'),notifications:staffRoles.concat('patient'),consents:['owner','admin','manager','doctor','nurse','receptionist','patient'],
 settings:['owner','admin','manager','accountant','hr','editor'],availability:['owner','admin','manager','doctor','nurse','receptionist','patient'],leave:staffRoles,services:staffRoles.concat('patient'),
};
const writeRoles:Partial<Record<Collection,Role[]>>={
 patients:['owner','admin','manager','doctor','nurse','receptionist'],appointments:['owner','admin','manager','doctor','nurse','receptionist','patient'],
 encounters:['doctor','nurse'],prescriptions:['doctor'],results:['doctor','nurse'],referrals:['doctor','nurse'],tasks:['owner','admin','manager','doctor','nurse','receptionist','accountant','hr','editor'],
 leads:['owner','admin','manager','receptionist'],employees:['owner','admin','hr'],invoices:['owner','admin','accountant','receptionist'],payroll:['owner','admin','hr'],pages:['owner','admin','editor'],templates:['owner','admin','accountant','hr','editor'],
 conversations:staffRoles.concat('patient'),consents:['owner','admin','manager','doctor','nurse','receptionist','patient'],settings:['owner','admin'],availability:['owner','admin','manager','doctor'],leave:['owner','admin','manager','hr','doctor','nurse','receptionist','employee'],services:['owner','admin','manager','accountant'],
};
export function requireRole(actor:Actor,roles:Role[]):void { assert(hasRole(actor,...roles),'FORBIDDEN','Your role cannot perform this action',403); }
export function requireWrite(collection:Collection,actor:Actor):void { requireRole(actor,writeRoles[collection]||[]); }
export function branchAllowed(entity:Entity|Record<string,unknown>,actor:Actor):boolean { return !entity.branchId || hasRole(actor,...adminRoles) || actor.branchIds.includes(String(entity.branchId)); }
export function baseVisible(collection:Collection,entity:Entity,actor:Actor):boolean {
 if(entity.organizationId!==actor.organizationId || !hasRole(actor,...readRoles[collection])) return false;
 const patientOnly=!hasRole(actor,...staffRoles) && hasRole(actor,'patient');
 if(patientOnly){
  if(collection==='patients')return actor.patientIds.includes(entity.id);
  if(collection==='appointments'||collection==='consents')return actor.patientIds.includes(String(entity.patientId));
  if(collection==='availability'||collection==='services')return entity.public===true;
  if(collection==='conversations')return Array.isArray(entity.participantIds)&&entity.participantIds.includes(actor.id);
  if(collection==='messages')return true; // conversation membership checked by service
  if(collection==='notifications')return entity.userId===actor.id;
  if(collection==='documents')return actor.patientIds.includes(String(entity.patientId))&&entity.released===true;
  if(['encounters','prescriptions'].includes(collection))return actor.patientIds.includes(String(entity.patientId))&&entity.status==='signed';
  if(['results','referrals'].includes(collection))return actor.patientIds.includes(String(entity.patientId))&&entity.released===true;
  if(['invoices','payments','refunds'].includes(collection))return actor.patientIds.includes(String(entity.patientId))&&entity.status!=='draft';
  return false;
 }
 if(!branchAllowed(entity,actor))return false;
 if(collection==='conversations')return Array.isArray(entity.participantIds)&&entity.participantIds.includes(actor.id);
 if(collection==='notifications')return entity.userId===actor.id;
 if(collection==='employees')return hasRole(actor,'owner','admin','hr')||entity.userId===actor.id;
 if(collection==='leave')return hasRole(actor,'owner','admin','manager','hr')||entity.userId===actor.id;
 if(collection==='documents'){
  if(entity.kind==='payslip')return entity.userId===actor.id||hasRole(actor,'owner','admin','hr');
  if(entity.kind==='clinical'||entity.kind==='intake')return hasRole(actor,'doctor','nurse');
  if(entity.kind==='invoice'||entity.kind==='credit-note')return hasRole(actor,'owner','admin','accountant','receptionist');
  return entity.ownerId===actor.id||hasRole(actor,'owner','admin');
 }
 if(collection==='tasks') {
  if(entity.category==='clinical'&&!hasRole(actor,'doctor','nurse'))return false;
  if(entity.category==='finance'&&!hasRole(actor,'owner','admin','accountant'))return false;
  return entity.assignedTo===actor.id||hasRole(actor,'owner','admin','manager','doctor','nurse');
 }
 if(collection==='settings')return hasRole(actor,'owner','admin')||['business','localization','website'].includes(String(entity.key));
 return true;
}
export function assertScope(value:Record<string,unknown>,actor:Actor):void {
 assert(branchAllowed(value,actor),'FORBIDDEN','Branch access denied',403);
 if(hasRole(actor,'patient')&&!hasRole(actor,...staffRoles)&&value.patientId) assert(actor.patientIds.includes(String(value.patientId)),'FORBIDDEN','Patient access denied',403);
}
