/* Author: ramanpal singh | URL: https://kwebby.com */
import { createHash } from 'node:crypto';
import { Decimal } from 'decimal.js';
import { z } from 'zod';
import { Actor, Collection, Database, Entity, FilterValue, ListPage, ListQuery, Repository, Role, DomainError, assert, canonicalJson, isCollection } from '../../contracts/src/index.js';
import { websiteAssetIds, type WebsiteSettings } from '../../contracts/src/website.js';
import { schemas, actionSchemas as a, settingsSchemas, parse, Creatable, mediaUrls, MAX_PAYROLL_EMPLOYEES } from './schemas.js';
import { adminRoles, staffRoles, hasRole, requireRole, requireWrite, baseVisible, canRead, assertScope } from './access.js';
import { newId } from './ids.js';

type Row=Entity & Record<string,any>;
type Data=Record<string,any>;
const now=()=>new Date().toISOString();
const patientOnly=(actor:Actor)=>hasRole(actor,'patient')&&!hasRole(actor,...staffRoles);
const clean=<T>(value:T):T=>JSON.parse(JSON.stringify(value));
const overlap=(aStart:string,aEnd:string,bStart:string,bEnd:string)=>Date.parse(aStart)<Date.parse(bEnd)&&Date.parse(bStart)<Date.parse(aEnd);
const immutable=['payments','refunds','messages','notifications','documents','themes','publications','consents'];
// Canonical (sorted-key) JSON keeps hashes stable after JSONB/MySQL reorder stored object keys or a database migration.
const hash=(value:unknown)=>createHash('sha256').update(canonicalJson(value)).digest('hex');
// Hashes stored before canonical serialization; accepted only when verifying an existing review or idempotency hash.
const legacyHash=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const sameHash=(stored:unknown,value:unknown)=>typeof stored==='string'&&(stored===hash(value)||stored===legacyHash(value));
const metadata=(actor:Actor, data:Data, id:string=newId()):Row=>clean({...data,id,organizationId:actor.organizationId,version:1,createdAt:now(),updatedAt:now()});
const moneyDigits=(currency:string)=> { try{return new Intl.NumberFormat('en',{style:'currency',currency}).resolvedOptions().maximumFractionDigits??2;}catch{return 2;} };
// Money maths use 40 significant digits: quantity x price x tax can exceed decimal.js's default precision of 20.
const Money=Decimal.clone({precision:40,rounding:Decimal.ROUND_HALF_UP});
/** Normalizes an exact non-negative amount to the currency's decimals; excess precision is rejected, never rounded. */
const money=(value:string,currency:string,message='Amounts must use the currency precision')=>{const d=new Money(value),dp=moneyDigits(currency);assert(d.isFinite()&&d.gte(0)&&d.eq(d.toDecimalPlaces(dp)),'MONEY',message);return d.toFixed(dp);};
/** Lock key shared with account administration, so assigning a user and disabling or re-scoping that user serialize. */
const userLock=(id:string)=>`user:${id}`;
const userLocks=(ids:unknown[])=>[...new Set(ids.filter((id):id is string=>typeof id==='string'&&id.length>0))].map(userLock);
const SCAN_BATCH=500;
/** Rows one list request may examine; when reached, the page returns what it found plus a `next` cursor. */
const SCAN_BUDGET=5000;
/** Patient-only reads are pushed down as one equality query per linked patient (or conversation) up to this many. */
const MAX_SCOPES=10;
const patientScoped:Collection[]=['appointments','consents','documents','encounters','prescriptions','results','referrals','invoices','payments','refunds','conversations'];
/** Display fields searched by ListQuery.q; dotted paths descend into objects and arrays. */
const searchFields:Partial<Record<Collection,string[]>>={patients:['name','email','phone'],appointments:['reason','kind','status'],encounters:['diagnosis','status'],prescriptions:['medications.name','instructions','status'],results:['title','summary'],referrals:['destination','reason','status'],tasks:['title','description','status'],leads:['name','email','phone','source','interest','stage'],employees:['name','email','jobTitle','specialty'],invoices:['number','status'],payments:['reference','method','status'],refunds:['reason','status'],payroll:['period','status'],documents:['title','kind'],pages:['title','slug'],templates:['name','kind'],themes:['name','title'],publications:['kind','pageId'],conversations:['title'],messages:['body','senderName'],notifications:['title','category'],consents:['purpose','versionLabel','source'],settings:['key'],availability:['timezone'],leave:['reason','status'],services:['name','description']};
const textValues=(value:unknown,path:string[]):string[]=>{if(value===null||value===undefined)return [];if(Array.isArray(value))return value.flatMap(v=>textValues(v,path));if(!path.length)return ['string','number','boolean'].includes(typeof value)?[String(value)]:[];return typeof value==='object'?textValues((value as Data)[path[0]],path.slice(1)):[];};
/** Generated scalar fields that are not part of the input schemas. */
const generatedTypes:Record<string,'number'|'boolean'>={version:'number',attempts:'number',released:'boolean',read:'boolean',active:'boolean',public:'boolean'};
function scalarType(collection:Collection,field:string):'string'|'number'|'boolean'|undefined{let schema:any=(schemas as Record<string,z.ZodObject<z.ZodRawShape>>)[collection]?.shape?.[field];while(schema?.def?.innerType)schema=schema.def.innerType;const type=schema?.def?.type;return type==='enum'?'string':['string','number','boolean'].includes(type)?type:generatedTypes[field];}
// Appointments start now or later; this tolerates clock skew and whole-minute rounding. Staff may record a walk-in
// that has already started (the patient is in the building) up to an hour back.
const BOOKING_GRACE_MS=5*60000,WALK_IN_GRACE_MS=60*60000;
/** Fields of a recorded page review, removed whenever the assigned reviewer changes. */
const clearedReview={reviewerName:undefined,reviewedAt:undefined,reviewNote:undefined,reviewedContentHash:undefined};
function expectVersion(row:Row,expected:number){assert(row.version===expected,'CONFLICT','This record changed. Reload before saving.',409);}
function isValidDay(value:string){return Number.isFinite(Date.parse(value));}

export class ClinicService {
 constructor(readonly db:Database){}
 private async rows(repo:Repository,collection:string,actor:Actor,eq:Record<string,string|number|boolean|null>={}):Promise<Row[]>{
  const result:Row[]=[];let after:string|undefined;
  for(;;){const batch=await repo.list<Row>(collection,{eq:{...eq,organizationId:actor.organizationId},limit:10000,...(after?{after}:{})});result.push(...batch);if(batch.length<10000)return result;const next=batch[batch.length-1].id;assert(next!==after,'PAGINATION','Database pagination did not advance',500);after=next;}
 }
 private async record(repo:Repository,collection:string,id:string,actor:Actor):Promise<Row>{const row=await repo.get<Row>(collection,id);assert(row&&row.organizationId===actor.organizationId,'NOT_FOUND','Record not found',404);return row;}
 private async visible(repo:Repository,collection:Collection,row:Row,actor:Actor,threads?:Map<string,boolean>):Promise<boolean>{
  if(!baseVisible(collection,row,actor))return false;
  // Message visibility follows its conversation; a list request looks each conversation up once.
  if(collection==='messages'){const id=String(row.conversationId);let allowed=threads?.get(id);if(allowed===undefined){const thread=await repo.get<Row>('conversations',id);allowed=!!thread&&baseVisible('conversations',thread,actor);threads?.set(id,allowed);}return allowed;}
  return true;
 }
 private async authorized(repo:Repository,collection:Collection,id:string,actor:Actor):Promise<Row>{const row=await this.record(repo,collection,id,actor);assert(await this.visible(repo,collection,row,actor),'NOT_FOUND','Record not found',404);return row;}
 private async write(repo:Repository,collection:string,row:Row,patch:Data):Promise<Row>{const next=clean({...row,...patch,version:row.version+1,updatedAt:now()});return repo.put(collection,next,row.version);}
 private async insert(repo:Repository,collection:string,data:Data,actor:Actor,id?:string):Promise<Row>{return repo.put(collection,metadata(actor,data,id));}
 private async audit(repo:Repository,actor:Actor,action:string,row:Row):Promise<void>{await this.insert(repo,'audit',{actorId:actor.id,action,resourceId:row.id,resourceVersion:row.version,branchId:row.branchId??null,at:now()},actor);}
 private async emit(repo:Repository,actor:Actor,type:string,payload:Data):Promise<void>{await this.insert(repo,'outbox',{type,status:'pending',payload,attempts:0,nextAttemptAt:now()},actor);}
 private async user(repo:Repository,id:string,actor:Actor,roles?:Role[],branchId?:string):Promise<Row>{
  const user=await this.record(repo,'users',id,actor);
  assert(user.active!==false&&user.disabled!==true&&user.status!=='disabled','VALIDATION','The selected account is disabled');
  if(roles)assert(Array.isArray(user.roles)&&user.roles.some((r:Role)=>roles.includes(r)),'VALIDATION','The selected account has the wrong role');
  if(branchId)assert(user.roles?.some((r:Role)=>adminRoles.includes(r))||user.branchIds?.includes(branchId),'VALIDATION','Account does not have branch access');
  return user;
 }
 private async patient(repo:Repository,data:Data,actor:Actor):Promise<Row|undefined>{if(!data.patientId)return;const row=await this.record(repo,'patients',data.patientId,actor);assert(row.branchId===data.branchId,'VALIDATION','Patient belongs to another branch');if(patientOnly(actor))assert(actor.patientIds.includes(row.id),'FORBIDDEN','Patient access denied',403);return row;}
 private async clinicalMedia(repo:Repository,content:unknown,patientId:string,actor:Actor):Promise<void>{for(const url of mediaUrls(content)){const file=await this.record(repo,'files',url.split('/').pop()!,actor);assert(file.patientId===patientId&&file.scope==='clinical'&&file.scanStatus==='clean','VALIDATION','Clinical media must be a clean upload linked to the same patient');}}
 private async releaseClinicalMedia(repo:Repository,content:unknown,patientId:string,actor:Actor):Promise<void>{await this.clinicalMedia(repo,content,patientId,actor);for(const url of new Set(mediaUrls(content))){const file=await this.record(repo,'files',url.split('/').pop()!,actor);if(!file.released)await this.write(repo,'files',file,{released:true,releasedAt:now(),releasedBy:actor.id});}}
 private async revision(repo:Repository,collection:string,row:Row,actor:Actor):Promise<void>{await this.insert(repo,'revisions',{collection,recordId:row.id,recordVersion:row.version,snapshot:clean(row),createdBy:actor.id},actor);}
 private async notification(repo:Repository,actor:Actor,userId:string,category:string,title:string,resourceId:string,branchId?:string):Promise<void>{
  await this.emit(repo,actor,'notification.requested',clean({userId,category,title,resourceId,branchId}));
 }
 async list(collection:Collection,actor:Actor,query:ListQuery={}):Promise<Row[]>{return (await this.listPage(collection,actor,query)).data;}
 /** Bounded, actor-visible page. Scans at most SCAN_BUDGET rows; `next` continues after the last returned row, or after
  * the last scanned row when the budget ran out first (so a short page is not necessarily the end). */
 async listPage(collection:Collection,actor:Actor,query:ListQuery={}):Promise<ListPage<Row>>{
  assert(isCollection(collection),'NOT_FOUND','Collection not found',404);
  const numericLimit=Number(query.limit);const requested=Number.isFinite(numericLimit)?Math.max(1,Math.min(Math.floor(numericLimit),500)):100;
  const after=typeof query.after==='string'&&query.after?query.after:undefined,order=query.order==='desc'?'desc' as const:'asc' as const;
  const search=typeof query.q==='string'?query.q.trim().toLowerCase():'';assert(search.length<=100,'VALIDATION','Search text is limited to 100 characters');
  if(!canRead(collection,actor))return {data:[]};
  const eq=this.coerce(collection,query.eq??{}),paths=(searchFields[collection]??['name','title']).map(field=>field.split('.'));
  const matched=(row:Row)=>!search||paths.some(path=>textValues(row,path).some(value=>value.toLowerCase().includes(search)));
  // Each scope is one equality query (e.g. one linked patient); a scope that contradicts an explicit filter matches nothing.
  const filters=((await this.scopes(collection,actor))??[{}]).filter(scope=>Object.entries(scope).every(([k,v])=>!(k in eq)||eq[k]===v)).map(scope=>({...eq,...scope,organizationId:actor.organizationId}));
  const precedes=(x:string,y:string)=>order==='desc'?x>y:x<y,budget=Math.max(SCAN_BATCH,Math.floor(SCAN_BUDGET/Math.max(1,filters.length)));
  const found=new Map<string,Row>(),threads=new Map<string,boolean>();let boundary:string|undefined;
  for(const filter of filters){
   let cursor=after,scanned=0,taken=0;
   for(;;){
    // Budget exhausted: rows of this scope beyond the cursor are unknown, so the page may only extend to the cursor.
    if(scanned>=budget){if(cursor!==undefined&&(boundary===undefined||precedes(cursor,boundary)))boundary=cursor;break;}
    const limit=Math.min(SCAN_BATCH,budget-scanned),batch=await this.db.list<Row>(collection,{eq:filter,limit,order,...(cursor?{after:cursor}:{})});scanned+=batch.length;
    let full=false;for(const row of batch){if(matched(row)&&await this.visible(this.db,collection,row,actor,threads)){found.set(row.id,row);if(++taken===requested){full=true;break;}}}
    if(full||batch.length<limit)break;
    const next=batch[batch.length-1].id;assert(next!==cursor,'PAGINATION','Database pagination did not advance',500);cursor=next;
   }
  }
  const data=[...found.values()].filter(row=>boundary===undefined||!precedes(boundary,row.id)).sort((x,y)=>precedes(x.id,y.id)?-1:precedes(y.id,x.id)?1:0).slice(0,requested);
  const next=data.length===requested?data[data.length-1].id:boundary;return next?{data,next}:{data};
 }
 /** Query-string filters arrive as strings: convert them to the field's schema type so every adapter compares typed values. */
 private coerce(collection:Collection,eq:Record<string,FilterValue>):Record<string,FilterValue>{
  return Object.fromEntries(Object.entries(eq).map(([field,value])=>{const type=scalarType(collection,field);
   if(type==='number'&&typeof value==='string'&&/^-?\d+(?:\.\d+)?$/.test(value))return [field,Number(value)];
   if(type==='boolean'&&(value==='true'||value==='false'))return [field,value==='true'];
   if(type==='string'&&(typeof value==='number'||typeof value==='boolean'))return [field,String(value)];
   return [field,value];}));
 }
 /** Equality scopes that push actor scoping into the database instead of scanning the whole collection. */
 private async scopes(collection:Collection,actor:Actor):Promise<Record<string,FilterValue>[]|undefined>{
  if(collection==='notifications')return [{userId:actor.id}];
  if(!patientOnly(actor))return;
  if(collection==='availability'||collection==='services')return [{public:true}];
  const patients=[...new Set(actor.patientIds)];if(patients.length>MAX_SCOPES)return;
  if(collection==='patients')return patients.map(id=>({id}));
  if(patientScoped.includes(collection))return patients.map(patientId=>({patientId}));
  if(collection==='messages'){const threads:string[]=[];for(const patientId of patients)for(const thread of await this.rows(this.db,'conversations',actor,{patientId}))if(baseVisible('conversations',thread,actor))threads.push(thread.id);return threads.length<=MAX_SCOPES?threads.map(conversationId=>({conversationId})):undefined;}
  return;
 }
 async get(collection:Collection,id:string,actor:Actor):Promise<Row>{assert(isCollection(collection),'NOT_FOUND','Collection not found',404);return this.authorized(this.db,collection,id,actor);}
 /** The caller's saved notification preferences, or null when none are saved. */
 async notificationPreferences(actor:Actor):Promise<Data|null>{const row=await this.db.get<Row>('preferences',`notification-${actor.id}`);return row&&row.organizationId===actor.organizationId&&row.userId===actor.id?clean(row.value??null):null;}
 async dashboard(actor:Actor):Promise<Data>{
  const relevant:Collection[]=patientOnly(actor)?['appointments','invoices','results','messages','notifications']:['patients','appointments','tasks','leads','invoices','results','notifications'];
  // Newest records first (ids are time-ordered), so current work is inside the 500-record window.
  const data=await Promise.all(relevant.map(async c=>[c,await this.list(c,actor,{limit:500,order:'desc'})] as const));
  const records=Object.fromEntries(data);return {counts:Object.fromEntries(data.map(([c,rows])=>[c,rows.length])),appointments:records.appointments?.filter((r:Row)=>!['cancelled','completed','no-show'].includes(r.status)).sort((x:Row,y:Row)=>x.startsAt.localeCompare(y.startsAt)).slice(0,12)??[],tasks:records.tasks?.filter((r:Row)=>r.status!=='completed').slice(0,10)??[],notifications:records.notifications?.filter((r:Row)=>!r.read).slice(0,10)??[],metricsAreCappedAt:500};
 }
 private validate(collection:Creatable,input:unknown):Data {
  const data=parse(schemas[collection] as z.ZodType<Data>,input);
  if(collection==='settings')data.value=parse(settingsSchemas[data.key],data.value);
  if(collection==='invoices')Object.assign(data,this.invoiceTotals(data.lines,data.currency));
  if(collection==='services'){assert(new Money(data.taxRate).lte(100),'VALIDATION','Tax rate exceeds 100%');data.price=money(data.price,data.currency,'Prices must use the service currency precision');}
  if(collection==='employees'){const salary=data.salary;for(const value of [salary.base,...salary.earnings.map((v:Data)=>v.amount),...salary.deductions.map((v:Data)=>v.amount)])money(value,salary.currency,'Salary amounts must use the salary currency precision');}
  if(collection==='availability')assert(data.startTime<data.endTime,'VALIDATION','Availability must end after it starts');
  if(collection==='leave'||collection==='appointments')assert(isValidDay(data.startsAt)&&Date.parse(data.startsAt)<Date.parse(data.endsAt),'VALIDATION','End time must follow start time');
  if(collection==='pages'&&data.seo?.schema){const encoded=JSON.stringify(data.seo.schema);assert(encoded.length<=50000&&!/<\/?script|javascript:|__proto__/i.test(encoded),'VALIDATION','Unsafe schema');}
  return clean(data);
 }
 async create(collection:Collection,input:unknown,actor:Actor):Promise<Row>{
  assert(collection in schemas,'FORBIDDEN','This record is created through a dedicated action',403);
  if(collection==='settings'&&input&&typeof input==='object'&&(input as Data).key==='website')requireRole(actor,['owner','admin','editor']);else requireWrite(collection,actor);
  const data=this.validate(collection as Creatable,input);if(!patientOnly(actor))assertScope(data,actor);
  if(collection==='appointments')return this.book(data,actor);
  if(collection==='consents')return this.consent(data,actor);
  return this.db.transaction([...this.scopeKeys(collection,data,actor),...this.userKeys(collection,data,actor)],async repo=>{
   await this.validateRelations(repo,collection,data,actor);
   if(collection==='employees')await this.separateDuties(repo,actor,data.userId===actor.id,['owner','admin','hr'],data.branchId,'Another administrator or HR user must create your own employee record');
   const state:Data={};
   if(['encounters','prescriptions','invoices','payroll','pages','templates'].includes(collection))state.status='draft';
   if(collection==='encounters'){state.createdBy=actor.id;state.amendments=[];}
   if(collection==='prescriptions')state.doctorId=actor.id;
   if(collection==='results')Object.assign(state,{reviewState:'pending',contactState:'pending',actionState:'pending-review',released:false});
   if(collection==='referrals')Object.assign(state,{status:'open',released:false});
   if(collection==='tasks')state.status='open';
   if(collection==='leads')Object.assign(state,{stage:'new',contactAttempts:[]});
   if(collection==='employees')state.active=true;
   if(collection==='leave')state.status='pending';
   if(collection==='availability')state.public=true;
   if(collection==='payroll'){state.slips=await this.payrollSnapshot(repo,data,actor);state.createdBy=actor.id;}
   if(collection==='conversations'){state.createdBy=actor.id;data.participantIds=[...new Set([...data.participantIds,actor.id])];state.readAt={};}
   const record=await this.insert(repo,collection,{...data,...state},actor,collection==='settings'?data.key:undefined);
   if(['encounters','pages','templates'].includes(collection))await this.revision(repo,collection,record,actor);
   await this.audit(repo,actor,`${collection}.created`,record);
   if(collection==='tasks')await this.notification(repo,actor,data.assignedTo,'operations','A task was assigned to you',record.id,data.branchId);
   if(collection==='results')await this.notification(repo,actor,data.reviewerId,'clinical','A result needs your review',record.id,data.branchId);
   return record;
  });
 }
 /** Scope locks only where an invariant spans records: page/location URL ownership (shared with theme publication) and a
  * doctor's schedule, which availability rules constrain. Everything else relies on record locks and expected versions. */
 private scopeKeys(collection:Collection,data:Data,actor:Actor):string[]{
  if(collection==='pages'||collection==='settings')return [`${actor.organizationId}:pages`,`${actor.organizationId}:settings`];
  if(collection==='availability')return [`${actor.organizationId}:schedule:${data.doctorId}`];
  return [];
 }
 /** Users this record assigns or references; their locks serialize the role/branch/status checks with account changes. */
 private userKeys(collection:Collection,data:Data,actor:Actor,participants=true):string[]{
  const ids:unknown[]=[];
  if(collection==='encounters'||collection==='availability')ids.push(data.doctorId);
  if(collection==='results')ids.push(data.reviewerId,data.coveringReviewerId);
  if(['tasks','leads','referrals','conversations'].includes(collection))ids.push(data.assignedTo);
  if(collection==='employees')ids.push(data.userId);
  if(collection==='pages')ids.push(data.reviewedBy);
  if(collection==='conversations'&&participants)ids.push(...(Array.isArray(data.participantIds)?data.participantIds:[]),actor.id);
  return userLocks(ids);
 }
 /** Separation of duties: one person may not both originate and approve. An owner is exempt only while no other active
  * account holds an approving role for the branch (a single-person clinic would otherwise be unable to operate). */
 private async separateDuties(repo:Repository,actor:Actor,conflict:boolean,approvers:Role[],branchId:string|undefined,message:string):Promise<void>{
  if(!conflict)return;
  assert(hasRole(actor,'owner')&&!(await this.otherApprover(repo,actor,approvers,branchId)),'SEPARATION_OF_DUTIES',message,403);
 }
 private async otherApprover(repo:Repository,actor:Actor,roles:Role[],branchId?:string):Promise<boolean>{
  for(let after:string|undefined;;){
   const batch=await repo.list<Row>('users',{eq:{organizationId:actor.organizationId},limit:SCAN_BATCH,...(after?{after}:{})});
   if(batch.some(u=>u.id!==actor.id&&u.active!==false&&u.disabled!==true&&u.status!=='disabled'&&Array.isArray(u.roles)&&u.roles.some((r:Role)=>roles.includes(r))&&(!branchId||u.roles.some((r:Role)=>adminRoles.includes(r))||u.branchIds?.includes(branchId))))return true;
   if(batch.length<SCAN_BATCH)return false;after=batch[batch.length-1].id;
  }
 }
 private async validateRelations(repo:Repository,collection:Collection,data:Data,actor:Actor):Promise<void>{
  await this.patient(repo,data,actor);
  if(collection==='settings'&&data.key==='business'&&data.value.logoFileId){const asset=await this.record(repo,'publicAssets',data.value.logoFileId,actor);assert(asset.status==='published'&&['image/png','image/jpeg','image/webp'].includes(asset.mime),'VALIDATION','Business logo must be an approved public image');}
  if(collection==='settings'&&data.key==='website'){
   const slugs=new Set((data.value.locations??[]).map((location:Data)=>location.slug));
   for(const page of await this.rows(repo,'pages',actor))assert(!slugs.has(page.slug),'SLUG_CONFLICT','A location URL is already used by a CMS page',409);
   for(const route of await this.rows(repo,'pageRoutes',actor))assert(!slugs.has(route.slug),'SLUG_CONFLICT','A location URL is already used by a page or permanent redirect',409);
  }
  if(collection==='pages'){
   const website=await repo.get<Row>('settings','website'),pointer=await repo.get<Row>('settings',`site-publication:${actor.organizationId}`),publication=pointer?await repo.get<Row>('publications',String(pointer.publicationId)):undefined;
   const locations=[...(website?.organizationId===actor.organizationId?website.value?.locations??[]:[]),...(publication?.organizationId===actor.organizationId?publication.publicSettings?.website?.locations??[]:[])];
   assert(!locations.some((location:Data)=>location.slug===data.slug),'SLUG_CONFLICT','This URL belongs to a clinic location',409);
  }
  if(collection==='settings'&&data.key==='website')for(const assetId of websiteAssetIds(data.value as WebsiteSettings)){const asset=await this.record(repo,'publicAssets',assetId,actor);assert(asset.status==='published'&&['image/png','image/jpeg','image/webp'].includes(asset.mime),'VALIDATION','Website media must be an approved public image');}
  if(collection==='pages')for(const url of mediaUrls(data.content)){const asset=await this.record(repo,'publicAssets',url.split('/').pop()!,actor);assert(asset.status==='published','VALIDATION','Page media must be a published public asset');}
  if(['encounters','availability'].includes(collection))await this.user(repo,data.doctorId,actor,['doctor'],data.branchId);
  if(collection==='encounters'){
   await this.clinicalMedia(repo,data.content,data.patientId,actor);
   if(hasRole(actor,'doctor')&&!hasRole(actor,'nurse'))assert(data.doctorId===actor.id,'FORBIDDEN','Doctors author their own encounters',403);
   if(data.appointmentId){const appt=await this.record(repo,'appointments',data.appointmentId,actor);assert(appt.patientId===data.patientId&&appt.doctorId===data.doctorId&&appt.branchId===data.branchId,'VALIDATION','Encounter appointment mismatch');}
  }
  if(collection==='prescriptions'||collection==='referrals'){
   if(data.encounterId){const encounter=await this.record(repo,'encounters',data.encounterId,actor);assert(encounter.patientId===data.patientId&&encounter.branchId===data.branchId,'VALIDATION','Encounter patient mismatch');if(collection==='prescriptions')assert(encounter.doctorId===actor.id,'FORBIDDEN','Only the responsible doctor can prescribe',403);}
  }
  if(collection==='results'){await this.user(repo,data.reviewerId,actor,['doctor'],data.branchId);if(data.coveringReviewerId)await this.user(repo,data.coveringReviewerId,actor,['doctor'],data.branchId);if(data.fileId){const f=await this.record(repo,'files',data.fileId,actor);assert(f.patientId===data.patientId&&f.scanStatus==='clean','VALIDATION','A clean file belonging to this patient is required');}}
  if(['tasks','leads','referrals'].includes(collection)&&data.assignedTo)await this.user(repo,data.assignedTo,actor,collection==='tasks'&&data.category==='clinical'?['doctor','nurse']:staffRoles,data.branchId);
  if(collection==='tasks'){if(data.category==='clinical')requireRole(actor,['doctor','nurse']);if(data.category==='finance')requireRole(actor,['owner','admin','accountant']);}
  if(collection==='employees'&&data.userId)await this.user(repo,data.userId,actor,staffRoles,data.branchId);
  if(collection==='availability'&&hasRole(actor,'doctor')&&!hasRole(actor,'owner','admin','manager'))assert(data.doctorId===actor.id,'FORBIDDEN','You can manage only your availability',403);
  if(collection==='leave'){
   const employee=await this.record(repo,'employees',data.employeeId,actor);assert(employee.branchId===data.branchId,'VALIDATION','Employee branch mismatch');
   if(!hasRole(actor,'owner','admin','manager','hr'))assert(employee.userId===actor.id,'FORBIDDEN','You may request leave only for yourself',403);data.userId=employee.userId;
  }
  if(collection==='invoices'&&data.templateId){const t=await this.record(repo,'templates',data.templateId,actor);assert(t.kind==='invoice'&&(!t.branchId||t.branchId===data.branchId),'VALIDATION','Invoice template mismatch');}
  if(collection==='pages'&&data.reviewedBy)await this.user(repo,data.reviewedBy,actor,['doctor'],data.branchId);
  if(collection==='conversations'){
   assert(data.kind!=='staff'||!data.patientId,'VALIDATION','Staff channels cannot contain patient records');
   if(patientOnly(actor))assert(data.kind==='patient-service'&&data.patientId,'FORBIDDEN','Patients can start service conversations only',403);
   if(data.kind==='clinical')requireRole(actor,['doctor','nurse']);
   for(const userId of new Set([...data.participantIds,actor.id])){const u=await this.user(repo,userId,actor);const isPatient=u.roles?.includes('patient')&&!u.roles?.some((r:Role)=>staffRoles.includes(r));
    if(isPatient)assert(data.kind!=='staff'&&data.patientId&&u.patientIds?.includes(data.patientId),'VALIDATION','Patient participant is not linked to this patient');
    else assert(u.roles?.some((r:Role)=>adminRoles.includes(r))||u.branchIds?.includes(data.branchId),'VALIDATION','Participant belongs to another branch');
    if(data.kind==='clinical'&&!isPatient)assert(u.roles?.some((r:Role)=>['doctor','nurse'].includes(r)),'VALIDATION','Clinical conversations require clinical staff');
   }
   if(data.assignedTo)assert(data.participantIds.includes(data.assignedTo)||data.assignedTo===actor.id,'VALIDATION','Assignee must participate in conversation');
  }
 }
 async update(collection:Collection,id:string,input:unknown,actor:Actor):Promise<Row>{
  assert(collection in schemas&&!immutable.includes(collection),'FORBIDDEN','Use the dedicated lifecycle action',403);
  if(collection==='settings'&&id==='website')requireRole(actor,['owner','admin','editor']);else requireWrite(collection,actor);
  assert(input&&typeof input==='object'&&!Array.isArray(input),'VALIDATION','Object required');const {expectedVersion,...patch}=input as Data;
  assert(Number.isInteger(expectedVersion)&&expectedVersion>0,'VALIDATION','expectedVersion is required');
  // Booking, clinical histories and consents must pass their specialized transitions.
  assert(!['appointments','encounters','prescriptions','results','payroll','leave'].includes(collection),'FORBIDDEN','Use the dedicated lifecycle action',403);
  // Lock keys come from the version the caller edited; the transaction re-checks that version, so the keys stay accurate.
  const org=actor.organizationId,initial=await this.authorized(this.db,collection,id,actor);expectVersion(initial,expectedVersion);
  const keys=[`${org}:${collection}:${id}`,...(collection==='invoices'?[`${org}:invoice:${id}`]:[]),...this.scopeKeys(collection,initial,actor),...this.userKeys(collection,{...initial,...patch},actor,false)];
  return this.db.transaction(keys,async repo=>{
   const row=await this.authorized(repo,collection,id,actor);expectVersion(row,expectedVersion);
   if(['invoices'].includes(collection))assert(row.status==='draft','IMMUTABLE','Issued financial documents cannot be changed',409);
   if(collection==='employees')await this.separateDuties(repo,actor,!!row.userId&&row.userId===actor.id,['owner','admin','hr'],row.branchId,'Another administrator or HR user must change your own employee record');
   const schema=schemas[collection as Creatable];const writable=Object.keys(schema.shape);const original=Object.fromEntries(writable.filter(k=>row[k]!==undefined).map(k=>[k,row[k]]));
   if(collection==='invoices')original.lines=row.lines.map((line:Data)=>Object.fromEntries(['description','quantity','unitPrice','taxRate','discount'].map(k=>[k,line[k]])));
   for(const key of ['branchId','patientId','doctorId','employeeId','userId','key','kind'])if(key in patch)assert(patch[key]===row[key]||patch[key]===null&&row[key]===undefined,'IMMUTABLE',`${key} cannot be reassigned`);
   // A null field removes an optional value (a defaulted field returns to its default); null for a required field fails validation.
   const cleared=Object.keys(patch).filter(k=>patch[k]===null&&writable.includes(k)),merged:Data={...original,...patch};for(const k of cleared)delete merged[k];
   const data=this.validate(collection as Creatable,merged);for(const k of cleared)if(!(k in data))data[k]=undefined;
   assertScope(data,actor);await this.validateRelations(repo,collection,data,actor);
   if(collection==='conversations')assert(!('participantIds'in patch)||hash(patch.participantIds)===hash(row.participantIds),'FORBIDDEN','Use conversation transfer to change participants',403);
   if(['pages','templates'].includes(collection))data.status='draft';
   // Reassigning the clinical reviewer voids the recorded review, so a publication can never pair one reviewer's name with another's approval.
   if(collection==='pages'&&(data.reviewedBy??undefined)!==(row.reviewedBy??undefined))Object.assign(data,clearedReview);
   const next=await this.write(repo,collection,row,data);if(['pages','templates'].includes(collection))await this.revision(repo,collection,next,actor);await this.audit(repo,actor,`${collection}.updated`,next);return next;
  });
 }
 private invoiceTotals(lines:Data[],currency:string):Data {
  const dp=moneyDigits(currency);let subtotal=new Money(0),discountTotal=new Money(0),taxTotal=new Money(0);const calculated=lines.map(l=>{
   const qty=new Money(l.quantity),unit=new Money(l.unitPrice),discount=new Money(l.discount||'0'),rate=new Money(l.taxRate||'0');
   assert(qty.gt(0)&&qty.lte(1000000)&&unit.gte(0)&&rate.gte(0)&&rate.lte(100),'VALIDATION','Invalid invoice quantity or tax rate');assert(unit.eq(unit.toDecimalPlaces(dp))&&discount.eq(discount.toDecimalPlaces(dp)),'MONEY','Prices and discounts must use the invoice currency precision');
   const gross=qty.mul(unit).toDecimalPlaces(dp);assert(discount.gte(0)&&discount.lte(gross),'VALIDATION','Discount exceeds line amount');const net=gross.minus(discount).toDecimalPlaces(dp);const tax=net.mul(rate).div(100).toDecimalPlaces(dp);subtotal=subtotal.plus(gross);discountTotal=discountTotal.plus(discount);taxTotal=taxTotal.plus(tax);
   return {...l,discount:discount.toFixed(dp),subtotal:gross.toFixed(dp),tax:tax.toFixed(dp),total:net.plus(tax).toFixed(dp)};
  });return {lines:calculated,subtotal:subtotal.toFixed(dp),discountTotal:discountTotal.toFixed(dp),taxTotal:taxTotal.toFixed(dp),total:subtotal.minus(discountTotal).plus(taxTotal).toFixed(dp),currency};
 }
 private async scheduleCheck(repo:Repository,data:Data,actor:Actor,ignoreId?:string):Promise<void>{
  await this.patient(repo,data,actor);await this.user(repo,data.doctorId,actor,['doctor'],data.branchId);
  const duration=Date.parse(data.endsAt)-Date.parse(data.startsAt);assert(duration>=60000&&duration<=8*3600000&&Date.parse(data.startsAt)%60000===0&&Date.parse(data.endsAt)%60000===0,'VALIDATION','Appointments must use whole minutes and last between 1 minute and 8 hours');
  assert(Date.parse(data.startsAt)>=Date.now()-(data.kind==='walk-in'&&!patientOnly(actor)?WALK_IN_GRACE_MS:BOOKING_GRACE_MS),'START_IN_PAST','Appointments cannot start in the past');
  const active=(r:Row)=>r.id!==ignoreId&&!['cancelled','no-show'].includes(r.status)&&overlap(data.startsAt,data.endsAt,r.startsAt,r.endsAt);
  const booked=await this.rows(repo,'appointments',actor,{doctorId:data.doctorId});assert(!booked.some(active),'SLOT_TAKEN','Doctor is already booked during this time',409);
  const visits=await this.rows(repo,'appointments',actor,{patientId:data.patientId});assert(!visits.some(active),'PATIENT_BOOKED','The patient already has an appointment during this time',409);
  const leaves=await this.rows(repo,'leave',actor,{userId:data.doctorId});assert(!leaves.some(r=>r.status==='approved'&&overlap(data.startsAt,data.endsAt,r.startsAt,r.endsAt)),'DOCTOR_ABSENT','Doctor is on approved leave',409);
  const rules=await this.rows(repo,'availability',actor,{doctorId:data.doctorId,branchId:data.branchId});assert(rules.length>0,'NO_AVAILABILITY','Doctor has no configured availability',409);
  const fits=rules.some(rule=>{const start=this.localParts(data.startsAt,rule.timezone),end=this.localParts(data.endsAt,rule.timezone);return start.date===end.date&&start.weekday===rule.weekday&&start.time>=rule.startTime&&end.time<=rule.endTime;});assert(fits,'OUTSIDE_AVAILABILITY','Appointment is outside the doctor’s available hours',409);
 }
 private localParts(value:string,timeZone:string):{date:string,time:string,weekday:number}{const parts=new Intl.DateTimeFormat('en-US',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',weekday:'short',hourCycle:'h23'}).formatToParts(new Date(value));const p=Object.fromEntries(parts.map(x=>[x.type,x.value]));return {date:`${p.year}-${p.month}-${p.day}`,time:`${p.hour}:${p.minute}`,weekday:['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].indexOf(p.weekday)};}
 private async book(data:Data,actor:Actor):Promise<Row>{
  return this.db.transaction(this.scheduleKeys(actor,data.doctorId,data.patientId),async repo=>{await this.scheduleCheck(repo,data,actor);const row=await this.insert(repo,'appointments',{...data,status:'booked',createdBy:actor.id},actor);await this.audit(repo,actor,'appointments.booked',row);await this.emit(repo,actor,'appointment.booked',{appointmentId:row.id,patientId:row.patientId});await this.notification(repo,actor,data.doctorId,'appointments','A new appointment was booked',row.id,data.branchId);return row;});
 }
 /** Doctor and patient calendars plus the doctor's account: overlap checks per practitioner and per patient, and practitioner validity. */
 private scheduleKeys(actor:Actor,doctorId:string,patientId:string,previousDoctorId=doctorId):string[]{return [`${actor.organizationId}:schedule:${previousDoctorId}`,`${actor.organizationId}:schedule:${doctorId}`,`${actor.organizationId}:schedule:patient:${patientId}`,userLock(doctorId)];}
 private async consent(data:Data,actor:Actor):Promise<Row>{return this.db.transaction([`${actor.organizationId}:consent:${data.patientId}`],async repo=>{await this.patient(repo,data,actor);const row=await this.insert(repo,'consents',{...data,recordedBy:actor.id,recordedAt:now()},actor);await this.audit(repo,actor,'consents.recorded',row);return row;});}
 private async transition(collection:Collection,input:{id:string;expectedVersion:number},actor:Actor,roles:Role[],fn:(repo:Repository,row:Row)=>Promise<Data>,keys:string[]=[]):Promise<Row>{
  requireRole(actor,roles);return this.db.transaction([`${actor.organizationId}:${collection}:${input.id}`,...keys],async repo=>{
   const row=await this.authorized(repo,collection,input.id,actor);expectVersion(row,input.expectedVersion);const patch=await fn(repo,row);const next=await this.write(repo,collection,row,patch);await this.audit(repo,actor,`${collection}.transition`,next);return next;
  });
 }
 async execute(action:string,input:unknown,actor:Actor):Promise<any>{
  switch(action){
   case 'patients.intake':{
    const data=parse(a.intake,input);requireRole(actor,['doctor','nurse','patient']);const patient=await this.record(this.db,'patients',data.patientId,actor);if(patientOnly(actor))assert(actor.patientIds.includes(patient.id),'FORBIDDEN','Patient access denied',403);else assertScope(patient,actor);
    return this.db.transaction([`${actor.organizationId}:patient:${patient.id}`],async repo=>{let appointment:Row|undefined;if(data.appointmentId){appointment=await this.record(repo,'appointments',data.appointmentId,actor);assert(appointment.patientId===patient.id,'VALIDATION','Appointment belongs to another patient');}
     await this.clinicalMedia(repo,data.content,patient.id,actor);const document=await this.insert(repo,'documents',{kind:'intake',branchId:patient.branchId,patientId:patient.id,ownerId:actor.id,title:'Patient intake',snapshot:clean(data),status:'submitted',released:true},actor);await this.audit(repo,actor,'intake.submitted',document);if(appointment)await this.notification(repo,actor,appointment.doctorId,'clinical','New patient intake is available',document.id,patient.branchId);return document;});
   }
   case 'appointments.book':return this.create('appointments',input,actor);
   case 'appointments.reschedule':{
    const data=parse(a.reschedule,input);requireWrite('appointments',actor);const existing=await this.get('appointments',data.id,actor);
    const doctorId=data.doctorId??existing.doctorId;
    return this.transition('appointments',data,actor,['owner','admin','manager','doctor','nurse','receptionist','patient'],async(repo,row)=>{
     assert(['booked','arrived'].includes(row.status),'STATE','Only upcoming appointments can be rescheduled',409);assert(row.doctorId===existing.doctorId,'CONFLICT','This record changed. Reload before saving.',409);
     if(patientOnly(actor))assert(row.status==='booked','STATE','Contact reception to reschedule after arrival',409);
     const proposed={...row,doctorId,startsAt:data.startsAt,endsAt:data.endsAt};await this.scheduleCheck(repo,proposed,actor,row.id);
     await this.emit(repo,actor,'appointment.rescheduled',{appointmentId:row.id});return {doctorId,startsAt:data.startsAt,endsAt:data.endsAt,status:'booked'};
    },this.scheduleKeys(actor,doctorId,existing.patientId,existing.doctorId));
   }
   case 'appointments.status':{
    const data=parse(a.status,input);return this.transition('appointments',data,actor,['owner','admin','manager','doctor','nurse','receptionist','patient'],async(repo,row)=>{
     if(patientOnly(actor))assert(data.status==='cancelled'&&row.status==='booked','FORBIDDEN','Patients may cancel upcoming bookings only',403);
     const transitions:Record<string,string[]>={booked:['arrived','cancelled','no-show'],arrived:['in-progress','cancelled'], 'in-progress':['completed'],completed:[],cancelled:[],'no-show':[]};
     assert(transitions[row.status]?.includes(data.status),'STATE','Invalid appointment transition',409);
     await this.emit(repo,actor,'appointment.status',{appointmentId:row.id,status:data.status});return {status:data.status};
    });
   }
   case 'encounters.save':{
    const data=parse(a.encounterSave,input);return this.transition('encounters',data,actor,['doctor','nurse'],async(repo,row)=>{
     assert(row.status==='draft','IMMUTABLE','Signed encounters require an amendment',409);assert(hasRole(actor,'nurse')||row.doctorId===actor.id,'FORBIDDEN','Only the responsible doctor can edit',403);
     await this.clinicalMedia(repo,data.content,row.patientId,actor);const {id,expectedVersion,...patch}=data;const next={...row,...patch,version:row.version+1};await this.revision(repo,'encounters',next,actor);return patch;
    });
   }
   case 'encounters.sign':{
    const data=parse(a.version,input);return this.transition('encounters',data,actor,['doctor'],async(repo,row)=>{
     assert(row.doctorId===actor.id,'FORBIDDEN','Only the responsible doctor can sign',403);assert(row.status==='draft','STATE','Encounter is already signed',409);assert(row.content?.length>0,'VALIDATION','Cannot sign an empty encounter');
     await this.releaseClinicalMedia(repo,row.content,row.patientId,actor);const signed={content:row.content,observations:row.observations??{},diagnosis:row.diagnosis??[],doctorId:row.doctorId,patientId:row.patientId,renderVersion:1};await this.emit(repo,actor,'encounter.signed',{encounterId:row.id});return {status:'signed',signedAt:now(),signedBy:actor.id,signedSnapshot:clean(signed),signatureHash:hash(signed)};
    });
   }
   case 'encounters.amend':{
    const data=parse(a.amend,input);return this.transition('encounters',data,actor,['doctor'],async(repo,row)=>{assert(row.status==='signed','STATE','Only signed encounters can be amended',409);assert(row.doctorId===actor.id,'FORBIDDEN','Only the signing doctor can amend',403);await this.releaseClinicalMedia(repo,data.content,row.patientId,actor);const amendment={id:newId(),reason:data.reason,content:data.content,signedBy:actor.id,signedAt:now(),renderVersion:1};await this.emit(repo,actor,'encounter.amended',{encounterId:row.id});return {amendments:[...(row.amendments||[]),{...amendment,signatureHash:hash(amendment)}]};});
   }
   case 'prescriptions.save':{
    const data=parse(a.prescriptionSave,input);return this.transition('prescriptions',data,actor,['doctor'],async(repo,row)=>{assert(row.doctorId===actor.id,'FORBIDDEN','Only the prescribing doctor can edit',403);assert(row.status==='draft','IMMUTABLE','Signed prescriptions cannot be edited',409);return {medications:data.medications,instructions:data.instructions??row.instructions??''};});
   }
   case 'prescriptions.sign':{
    const data=parse(a.version,input);return this.transition('prescriptions',data,actor,['doctor'],async(repo,row)=>{assert(row.doctorId===actor.id,'FORBIDDEN','Only the prescribing doctor can sign',403);assert(row.status==='draft','STATE','Prescription is already signed',409);const encounter=await this.record(repo,'encounters',row.encounterId,actor);assert(encounter.status==='signed','STATE','Sign the consultation first',409);const snapshot={patientId:row.patientId,medications:row.medications,instructions:row.instructions??'',doctorId:actor.id,renderVersion:1};await this.emit(repo,actor,'prescription.signed',{prescriptionId:row.id});return {status:'signed',signedAt:now(),signedBy:actor.id,signedSnapshot:snapshot,signatureHash:hash(snapshot)};});
   }
   case 'results.review':{
    const data=parse(a.review,input);return this.transition('results',data,actor,['doctor'],async(repo,row)=>{assert([row.reviewerId,row.coveringReviewerId].includes(actor.id),'FORBIDDEN','Result is assigned to another reviewer',403);assert(row.reviewState==='pending','STATE','Result has already been reviewed',409);return {reviewState:'reviewed',reviewedBy:actor.id,reviewedAt:now(),summary:data.summary,actionState:data.actionRequired?'required':'not-required'};});
   }
   case 'results.contact':{
    const data=parse(a.contact,input);return this.transition('results',data,actor,['doctor','nurse'],async(repo,row)=>{assert(row.reviewState==='reviewed','STATE','Result requires clinical review before communication',409);assert(row.contactState!=='communicated','STATE','Communication is already complete',409);return {contactState:data.outcome,contactAttempts:[...(row.contactAttempts||[]),{outcome:data.outcome,note:data.note,actorId:actor.id,at:now()}]};});
   }
   case 'results.action':{
    const data=parse(a.note,input);return this.transition('results',data,actor,['doctor'],async(repo,row)=>{assert([row.reviewerId,row.coveringReviewerId].includes(actor.id),'FORBIDDEN','Result is assigned to another reviewer',403);assert(row.actionState==='required','STATE','No outstanding clinical action',409);return {actionState:'completed',actionNote:data.note,actionCompletedAt:now(),actionCompletedBy:actor.id};});
   }
   case 'results.reassign':{
    const data=parse(a.reassign,input);return this.transition('results',data,actor,['doctor','nurse'],async(repo,row)=>{assert(row.reviewState==='pending'||row.actionState==='required'||!row.released,'STATE','This result has no outstanding review, action or release to reassign',409);await this.user(repo,data.reviewerId,actor,['doctor'],row.branchId);if(data.coveringReviewerId)await this.user(repo,data.coveringReviewerId,actor,['doctor'],row.branchId);await this.notification(repo,actor,data.reviewerId,'clinical','A result was assigned to you',row.id,row.branchId);return {reviewerId:data.reviewerId,coveringReviewerId:data.coveringReviewerId??null};},userLocks([data.reviewerId,data.coveringReviewerId]));
   }
   case 'results.release':{
    const data=parse(a.version,input);return this.transition('results',data,actor,['doctor'],async(repo,row)=>{assert([row.reviewerId,row.coveringReviewerId].includes(actor.id),'FORBIDDEN','Only the assigned reviewer can release',403);assert(row.reviewState==='reviewed','STATE','Result must be reviewed before release',409);assert(!row.released,'STATE','Result already released',409);if(row.fileId){const file=await this.record(repo,'files',row.fileId,actor);assert(file.patientId===row.patientId&&file.scope==='clinical'&&file.scanStatus==='clean','VALIDATION','Result file must be a clean clinical upload for the same patient');await this.write(repo,'files',file,{released:true,releasedAt:now(),releasedBy:actor.id});}await this.emit(repo,actor,'result.released',{resultId:row.id,patientId:row.patientId});return {released:true,releasedAt:now(),releasedBy:actor.id};});
   }
   case 'referrals.complete':case 'referrals.release':{
    const data=parse(a.optionalNote,input);return this.transition('referrals',data,actor,['doctor','nurse'],async(repo,row)=>{if(action==='referrals.release'){requireRole(actor,['doctor']);assert(!row.released,'STATE','Referral already released',409);assert(!row.assignedTo||row.assignedTo===actor.id,'FORBIDDEN','Only the assigned clinician can release this referral',403);return {released:true,releasedAt:now(),releasedBy:actor.id};}assert(row.status==='open','STATE','Referral already completed',409);return {status:'completed',completedAt:now(),completedBy:actor.id,completionNote:data.note??''};});
   }
   case 'tasks.status':case 'tasks.complete':{
    const data=action==='tasks.complete'?{...parse(a.optionalNote,input),status:'completed' as const}:parse(a.taskStatus,input);
    return this.transition('tasks',data,actor,staffRoles,async(repo,row)=>{
     assert(row.assignedTo===actor.id||hasRole(actor,'owner','admin','manager'),'FORBIDDEN','Only the assignee or manager can update task progress',403);
     const transitions:Record<string,string[]>={open:['in-progress','blocked','completed'],'in-progress':['open','blocked','completed'],blocked:['open','in-progress','completed'],completed:['open']};
     assert(transitions[row.status]?.includes(data.status),'STATE','Invalid task transition',409);
     const changedAt=now();return {status:data.status,statusNote:data.note??'',statusChangedAt:changedAt,statusChangedBy:actor.id,...(data.status==='completed'?{completionNote:data.note??'',completedAt:changedAt,completedBy:actor.id}:{completionNote:undefined,completedAt:undefined,completedBy:undefined})};
    });
   }
   case 'leave.approve':{
    const data=parse(a.leaveApprove,input);const existing=await this.get('leave',data.id,actor);return this.transition('leave',data,actor,['owner','admin','manager','hr'],async(repo,row)=>{assert(row.status==='pending','STATE','Leave request already decided',409);
     if(data.approved)await this.separateDuties(repo,actor,row.userId===actor.id,['owner','admin','manager','hr'],row.branchId,'Another manager must approve your own leave');
     if(data.approved&&row.userId){const appointments=await this.rows(repo,'appointments',actor,{doctorId:row.userId});assert(!appointments.some(r=>!['cancelled','no-show','completed'].includes(r.status)&&overlap(row.startsAt,row.endsAt,r.startsAt,r.endsAt)),'BOOKINGS_EXIST','Reschedule existing appointments before approving leave',409);}
     return {status:data.approved?'approved':'rejected',decidedBy:actor.id,decidedAt:now()};
    },existing.userId?[`${actor.organizationId}:schedule:${existing.userId}`]:[]);
   }
   case 'leads.transition':{
    const data=parse(a.leadTransition,input);return this.transition('leads',data,actor,['owner','admin','manager','receptionist'],async(repo,row)=>{const transitions:Record<string,string[]>={new:['contacted','qualified','closed'],contacted:['qualified','booked','closed'],qualified:['booked','closed'],booked:['closed'],closed:['new']};assert(transitions[row.stage]?.includes(data.stage),'STATE','Invalid lead transition',409);if(data.stage==='closed')assert(data.closureReason,'VALIDATION','Closure reason is required');if(data.stage==='booked'){assert(data.appointmentId,'VALIDATION','A booking is required');const appt=await this.record(repo,'appointments',data.appointmentId,actor);assert(appt.branchId===row.branchId,'VALIDATION','Booking branch mismatch');}return {stage:data.stage,closureReason:data.closureReason??null,appointmentId:data.appointmentId??row.appointmentId??null};});
   }
   case 'leads.contact':{
    const data=parse(a.leadContact,input);return this.transition('leads',data,actor,['owner','admin','manager','receptionist'],async(repo,row)=>({contactAttempts:[...(row.contactAttempts||[]),{note:data.note,outcome:data.outcome,at:now(),actorId:actor.id}],callbackAt:data.callbackAt??row.callbackAt??null,stage:row.stage==='new'?'contacted':row.stage}));
   }
   case 'invoices.issue':return this.issueInvoice(parse(a.version,input),actor);
   case 'invoices.credit':return this.creditInvoice(parse(a.credit,input),actor);
   case 'payments.record':return this.recordPayment(parse(a.payment,input),actor);
   case 'refunds.record':return this.refund(parse(a.refund,input),actor);
   case 'payroll.approve':return this.approvePayroll(parse(a.version,input),actor);
   case 'payroll.pay':{
    const data=parse(a.payrollPay,input);return this.transition('payroll',data,actor,['owner','admin','hr','accountant'],async(repo,row)=>{assert(row.status==='approved','STATE','Payroll requires approval before payment',409);await this.emit(repo,actor,'payroll.paid',{payrollId:row.id});return {status:'paid',paidAt:now(),paidBy:actor.id,paymentReference:data.reference};});
   }
   case 'templates.publish':{
    const data=parse(a.version,input);return this.transition('templates',data,actor,['owner','admin','accountant','hr','editor'],async(repo,row)=>{assert(row.status==='draft','STATE','This template version is already published; edit it to publish changes',409);const snapshot={name:row.name,kind:row.kind,content:row.content,design:row.design,version:row.version,renderVersion:1};return {status:'published',publishedSnapshot:snapshot,publishedAt:now(),publishedBy:actor.id};});
   }
   case 'pages.review':{
    const data=parse(a.optionalNote,input);return this.transition('pages',data,actor,['doctor'],async(repo,row)=>{assert(!row.reviewedBy||row.reviewedBy===actor.id,'FORBIDDEN','This page is assigned to another clinical reviewer',403);return {reviewedBy:actor.id,reviewerName:actor.name,reviewedAt:now(),reviewNote:data.note??'',reviewedContentHash:hash({title:row.title,content:row.content,citations:row.citations??[]})};});
   }
   case 'pages.publish':return this.publishPage(parse(a.version,input),actor);
   case 'pages.restore':{
    // A restore is a full edit: current validation, relation checks (location URLs, public media, reviewer) and URL locks apply.
    const data=parse(a.restore,input);const revision=await this.record(this.db,'revisions',data.revisionId,actor);const snapshot:Data=revision.snapshot??{};const writable=Object.keys(schemas.pages.shape);
    return this.transition('pages',data,actor,['owner','admin','editor'],async(repo,row)=>{assert(revision.collection==='pages'&&revision.recordId===row.id,'VALIDATION','Revision does not belong to this page');
     const restored=this.validate('pages',Object.fromEntries(writable.filter(k=>snapshot[k]!==undefined).map(k=>[k,snapshot[k]])));assert((restored.branchId??null)===(row.branchId??null)&&restored.kind===row.kind,'VALIDATION','Revision does not belong to this page');
     assertScope(restored,actor);await this.validateRelations(repo,'pages',restored,actor);
     const patch:Data={...Object.fromEntries(writable.map(k=>[k,restored[k]])),status:'draft',...((restored.reviewedBy??undefined)!==(row.reviewedBy??undefined)?clearedReview:{})};
     await this.revision(repo,'pages',clean({...row,...patch,version:row.version+1}),actor);return patch;
    },[`${actor.organizationId}:pages`,`${actor.organizationId}:settings`,...userLocks([snapshot.reviewedBy])]);
   }
   case 'pages.revisions':case 'encounters.revisions':case 'templates.revisions':{
    const data=parse(a.read,input);const collection=action.split('.')[0] as Collection;const row=await this.get(collection,data.id,actor);assert(!patientOnly(actor),'FORBIDDEN','Draft histories are staff-only',403);return this.rows(this.db,'revisions',actor,{collection,recordId:row.id});
   }
   case 'documents.release':{
    const data=parse(a.version,input);return this.transition('documents',data,actor,['doctor','accountant','hr','owner','admin'],async(repo,row)=>{if(row.kind==='clinical')requireRole(actor,['doctor']);assert(!row.released,'STATE','Document already released',409);if(row.fileId){const file=await this.record(repo,'files',row.fileId,actor);assert(file.scanStatus==='clean'&&file.scope==='clinical'&&file.patientId===row.patientId,'VALIDATION','Document file must be a clean clinical upload for the same patient');await this.write(repo,'files',file,{released:true,releasedAt:now(),releasedBy:actor.id});}await this.emit(repo,actor,'document.released',{documentId:row.id,patientId:row.patientId??null,userId:row.userId??null});return {released:true,releasedBy:actor.id,releasedAt:now()};});
   }
   case 'conversations.send':return this.sendMessage(parse(a.message,input),actor);
   case 'conversations.read':{
    const data=parse(a.read,input);return this.db.transaction([`${actor.organizationId}:conversations:${data.id}`],async repo=>{const row=await this.authorized(repo,'conversations',data.id,actor);return this.write(repo,'conversations',row,{readAt:{...row.readAt,[actor.id]:now()}});});
   }
   case 'conversations.transfer':{
    const data=parse(a.transfer,input);return this.transition('conversations',data,actor,staffRoles,async(repo,row)=>{assert(data.participantIds.includes(data.assignedTo),'VALIDATION','Assignee must be a participant');assert(data.participantIds.includes(actor.id),'VALIDATION','Transferring staff member must remain a participant');const proposed={...row,assignedTo:data.assignedTo,participantIds:data.participantIds};await this.validateRelations(repo,'conversations',proposed,actor);return {assignedTo:data.assignedTo,participantIds:data.participantIds};},userLocks([...data.participantIds,data.assignedTo]));
   }
   case 'notifications.read':{
    const data=parse(a.read,input);return this.db.transaction([`${actor.organizationId}:notifications:${data.id}`],async repo=>{const row=await this.authorized(repo,'notifications',data.id,actor);return row.read?row:this.write(repo,'notifications',row,{read:true,readAt:now()});});
   }
   case 'notifications.preferences':{
    const data=parse(a.preferences,input);const id=`notification-${actor.id}`;return this.db.transaction([`${actor.organizationId}:${id}`],async repo=>{const prev=await repo.get<Row>('preferences',id);if(prev)assert(prev.organizationId===actor.organizationId&&prev.userId===actor.id,'FORBIDDEN','Preferences access denied',403);return prev?this.write(repo,'preferences',prev,{value:data}):this.insert(repo,'preferences',{userId:actor.id,value:data},actor,id);});
   }
   case 'consents.record':return this.create('consents',input,actor);
   default:throw new DomainError('NOT_FOUND','Unknown action',404);
  }
 }
 private async issueInvoice(data:{id:string;expectedVersion:number},actor:Actor):Promise<Row>{
  // Numbers are sequential per branch counter, so issuing serializes per branch, not per organization.
  requireRole(actor,['owner','admin','accountant','receptionist']);const initial=await this.authorized(this.db,'invoices',data.id,actor);
  return this.db.transaction([`${actor.organizationId}:invoice-counter:${initial.branchId}`,`${actor.organizationId}:invoice:${data.id}`],async repo=>{
   const row=await this.authorized(repo,'invoices',data.id,actor);expectVersion(row,data.expectedVersion);assert(row.status==='draft','IMMUTABLE','Invoice already issued',409);
   const business=await this.record(repo,'settings','business',actor);const patient=await this.record(repo,'patients',row.patientId,actor);
   let templateSnapshot:Data={kind:'invoice',design:{accent:'#126b5e',font:'system',showLogo:true,columns:['description','quantity','unitPrice','tax','total']},content:[],renderVersion:1};
   if(row.templateId){const template=await this.record(repo,'templates',row.templateId,actor);assert(template.kind==='invoice'&&template.publishedSnapshot,'STATE','Publish the invoice template before issuing');templateSnapshot=template.publishedSnapshot;}
   const current=new Date();const local=Object.fromEntries(new Intl.DateTimeFormat('en',{timeZone:business.value.timezone??'UTC',year:'numeric',month:'numeric'}).formatToParts(current).map(part=>[part.type,part.value]));const month=business.value.fiscalYearStart??1;const year=Number(local.year)-(Number(local.month)<month?1:0);const counterId=`invoice-${row.branchId}-${year}`;const counter=await repo.get<Row>('counters',counterId);const sequence=(counter?.value??0)+1;
   const number=`${business.value.invoicePrefix??'INV'}-${row.branchId}-${year}-${String(sequence).padStart(6,'0')}`;
   const snapshot=clean({number,currency:row.currency,lines:row.lines,subtotal:row.subtotal,discountTotal:row.discountTotal,taxTotal:row.taxTotal,total:row.total,notes:row.notes,business:business.value,patient:{id:patient.id,name:patient.name,address:patient.address??'',email:patient.email??''},template:templateSnapshot,issuedAt:now(),renderVersion:1});
   if(counter)await this.write(repo,'counters',counter,{value:sequence});else await this.insert(repo,'counters',{value:sequence},actor,counterId);
   const doc=await this.insert(repo,'documents',{branchId:row.branchId,patientId:row.patientId,kind:'invoice',sourceId:row.id,title:`Invoice ${number}`,snapshot,released:true,ownerId:actor.id},actor);
   const next=await this.write(repo,'invoices',row,{status:new Money(row.total).isZero()?'paid':'issued',number,issuedAt:snapshot.issuedAt,issuedBy:actor.id,snapshot,documentId:doc.id,paidAmount:money('0',row.currency),creditedAmount:money('0',row.currency),balance:row.total});
   await this.emit(repo,actor,'invoice.issued',{invoiceId:row.id,documentId:doc.id,patientId:row.patientId});await this.audit(repo,actor,'invoices.issued',next);return next;
  });
 }
 private async creditInvoice(data:Data,actor:Actor):Promise<Row>{
  requireRole(actor,['owner','admin','accountant']);const id=`credit-${hash([actor.organizationId,data.idempotencyKey]).slice(0,40)}`;
  return this.db.transaction([`${actor.organizationId}:invoice:${data.invoiceId}`],async repo=>{const invoice=await this.authorized(repo,'invoices',data.invoiceId,actor);const existing=await repo.get<Row>('creditNotes',id);if(existing){assert(sameHash(existing.requestHash,data),'IDEMPOTENCY_CONFLICT','Credit key used for another request',409);return existing;}
   assert(['issued','partially-paid','paid','credited'].includes(invoice.status),'STATE','Only issued invoices can be credited',409);
   const value=new Money(money(data.amount,invoice.currency,'Invalid credit amount'));assert(value.gt(0),'MONEY','Invalid credit amount');assert(value.lte(invoice.balance),'CREDIT_EXCEEDS_BALANCE','Credit exceeds unpaid balance; record any required refund first',409);const balance=new Money(invoice.balance).minus(value);const credited=new Money(invoice.creditedAmount||'0').plus(value);
   const credit=await this.insert(repo,'creditNotes',{branchId:invoice.branchId,patientId:invoice.patientId,invoiceId:invoice.id,invoiceNumber:invoice.number,currency:invoice.currency,amount:value.toFixed(moneyDigits(invoice.currency)),reason:data.reason,issuedBy:actor.id,requestHash:hash(data)},actor,id);
   const document=await this.insert(repo,'documents',{branchId:invoice.branchId,patientId:invoice.patientId,kind:'credit-note',title:`Credit note ${invoice.number}`,sourceId:credit.id,snapshot:{number:credit.id,issuedAt:credit.createdAt,invoiceNumber:invoice.number,currency:invoice.currency,total:credit.amount,reason:data.reason,business:invoice.snapshot.business,patient:invoice.snapshot.patient,template:invoice.snapshot.template,renderVersion:1},released:true,ownerId:actor.id},actor);
   await this.write(repo,'invoices',invoice,{balance:balance.toFixed(moneyDigits(invoice.currency)),creditedAmount:credited.toFixed(moneyDigits(invoice.currency)),status:balance.isZero()?'credited':invoice.status});await this.audit(repo,actor,'invoice.credited',credit);await this.emit(repo,actor,'invoice.credited',{invoiceId:invoice.id,creditNoteId:credit.id,documentId:document.id});return credit;
  });
 }
 private async recordPayment(data:Data,actor:Actor):Promise<Row>{
  requireRole(actor,['owner','admin','accountant']);const id=`manual-${hash([actor.organizationId,data.idempotencyKey]).slice(0,40)}`;
  return this.db.transaction([`${actor.organizationId}:invoice:${data.invoiceId}`,`${actor.organizationId}:payment:${id}`],async repo=>{
   // A replay returns the original payment even after the invoice was later paid off, credited or refunded.
   const invoice=await this.authorized(repo,'invoices',data.invoiceId,actor);const existing=await repo.get<Row>('payments',id);if(existing){assert(sameHash(existing.requestHash,data),'IDEMPOTENCY_CONFLICT','Idempotency key was used for a different payment',409);return existing;}
   assert(['issued','partially-paid','paid'].includes(invoice.status),'STATE','Issue invoice before recording payments',409);
   const fixed=money(data.amount,invoice.currency,'Payment amount must be positive and use currency precision'),value=new Money(fixed);assert(value.gt(0),'MONEY','Payment amount must be positive and use currency precision');assert(value.lte(invoice.balance),'OVERPAYMENT','Payment exceeds invoice balance',409);
   const payment=await this.insert(repo,'payments',{invoiceId:invoice.id,patientId:invoice.patientId,branchId:invoice.branchId,currency:invoice.currency,amount:fixed,method:data.method,reference:data.reference??'',status:'succeeded',refundedAmount:money('0',invoice.currency),recordedBy:actor.id,requestHash:hash(data),idempotencyKey:data.idempotencyKey},actor,id);
   const balance=new Money(invoice.balance).minus(value),paid=new Money(invoice.paidAmount).plus(value);await this.write(repo,'invoices',invoice,{balance:balance.toFixed(moneyDigits(invoice.currency)),paidAmount:paid.toFixed(moneyDigits(invoice.currency)),status:balance.isZero()?'paid':'partially-paid'});
   await this.emit(repo,actor,'payment.recorded',{paymentId:payment.id,invoiceId:invoice.id});await this.audit(repo,actor,'payments.recorded',payment);return payment;
  });
 }
 private async refund(data:Data,actor:Actor):Promise<Row>{
  requireRole(actor,['owner','admin','accountant']);const payment=await this.get('payments',data.paymentId,actor);const id=`refund-${hash([actor.organizationId,data.idempotencyKey]).slice(0,40)}`;
  return this.db.transaction([`${actor.organizationId}:invoice:${payment.invoiceId}`,`${actor.organizationId}:payment:${payment.id}`],async repo=>{
   const current=await this.authorized(repo,'payments',data.paymentId,actor);const invoice=await this.record(repo,'invoices',current.invoiceId,actor);const prior=await repo.get<Row>('refunds',id);if(prior){assert(sameHash(prior.requestHash,data),'IDEMPOTENCY_CONFLICT','Idempotency key was used for another refund',409);return prior;}
   assert(['cash','bank'].includes(current.method),'PROVIDER_REFUND','Provider payments require a verified provider refund');const value=new Money(money(data.amount,current.currency,'Invalid refund amount'));assert(value.gt(0),'MONEY','Invalid refund amount');const refunded=new Money(current.refundedAmount||'0').plus(value);assert(refunded.lte(current.amount),'OVER_REFUND','Refund exceeds refundable amount',409);
   const refund=await this.insert(repo,'refunds',{paymentId:current.id,invoiceId:invoice.id,patientId:invoice.patientId,branchId:invoice.branchId,currency:invoice.currency,amount:value.toFixed(moneyDigits(invoice.currency)),reason:data.reason,status:'succeeded',recordedBy:actor.id,requestHash:hash(data)},actor,id);
   await this.write(repo,'payments',current,{refundedAmount:refunded.toFixed(moneyDigits(invoice.currency)),status:refunded.eq(current.amount)?'refunded':'partially-refunded'});
   const paid=new Money(invoice.paidAmount).minus(value);await this.write(repo,'invoices',invoice,{paidAmount:paid.toFixed(moneyDigits(invoice.currency)),balance:new Money(invoice.balance).plus(value).toFixed(moneyDigits(invoice.currency)),status:paid.isZero()?'issued':'partially-paid'});
   await this.emit(repo,actor,'payment.refunded',{paymentId:current.id,refundId:refund.id});await this.audit(repo,actor,'refunds.recorded',refund);return refund;
  });
 }
 private async payrollSnapshot(repo:Repository,data:Data,actor:Actor):Promise<Data[]>{
  assert(new Set(data.employeeIds).size===data.employeeIds.length,'VALIDATION','Duplicate employee in payroll');const slips:Data[]=[];
  for(const employeeId of data.employeeIds){const employee=await this.record(repo,'employees',employeeId,actor);assert(employee.active&&employee.branchId===data.branchId,'VALIDATION','Employee inactive or from another branch');const salary=employee.salary;const adjustments=data.adjustments.filter((v:Data)=>v.employeeId===employeeId);const earnings=[{label:'Base salary',amount:salary.base},...salary.earnings,...adjustments.filter((v:Data)=>v.kind==='earning').map((v:Data)=>({label:v.label,amount:v.amount}))];const deductions=[...salary.deductions,...adjustments.filter((v:Data)=>v.kind==='deduction').map((v:Data)=>({label:v.label,amount:v.amount}))];
   for(const line of [...earnings,...deductions])money(line.amount,salary.currency,'Payroll amounts must use the salary currency precision');const gross=earnings.reduce((sum:Decimal,line:Data)=>sum.plus(line.amount),new Money(0));const totalDeductions=deductions.reduce((sum:Decimal,line:Data)=>sum.plus(line.amount),new Money(0));const net=gross.minus(totalDeductions);assert(net.gte(0),'VALIDATION','Deductions exceed gross salary');const dp=moneyDigits(salary.currency);slips.push({employeeId,userId:employee.userId??null,employeeName:employee.name,jobTitle:employee.jobTitle,currency:salary.currency,period:data.period,earnings,deductions,gross:gross.toFixed(dp),totalDeductions:totalDeductions.toFixed(dp),net:net.toFixed(dp)});
  }
  assert(data.adjustments.every((v:Data)=>data.employeeIds.includes(v.employeeId)),'VALIDATION','Adjustment refers to an employee outside this pay run');return slips;
 }
 private async approvePayroll(data:{id:string;expectedVersion:number},actor:Actor):Promise<Row>{
  requireRole(actor,['owner','admin','hr']);const initial=await this.get('payroll',data.id,actor);
  return this.transition('payroll',data,actor,['owner','admin','hr'],async(repo,row)=>{assert(row.status==='draft','STATE','Pay run already approved',409);
   assert(row.employeeIds.length<=MAX_PAYROLL_EMPLOYEES,'VALIDATION',`Split pay runs larger than ${MAX_PAYROLL_EMPLOYEES} employees before approval`);
   // Drafts created before createdBy was recorded fall back to their creation audit entry.
   const creator=row.createdBy??(await this.rows(repo,'audit',actor,{resourceId:row.id,action:'payroll.created'}))[0]?.actorId;
   await this.separateDuties(repo,actor,creator===actor.id,['owner','admin','hr'],row.branchId,'A different administrator or HR user must approve a pay run you created');
   const other=await this.rows(repo,'payroll',actor,{branchId:row.branchId,period:row.period});assert(!other.some(r=>r.id!==row.id&&r.status!=='draft'&&r.employeeIds.some((id:string)=>row.employeeIds.includes(id))),'DUPLICATE_PAYROLL','Employee already included in approved payroll for this period',409);
   const business=await this.record(repo,'settings','business',actor);let template:Data={kind:'payslip',renderVersion:1};if(row.templateId){const t=await this.record(repo,'templates',row.templateId,actor);assert(t.kind==='payslip'&&t.publishedSnapshot,'STATE','A published payslip template is required');template=t.publishedSnapshot;}
   const documents:Row[]=[];for(const slip of row.slips){const document=await this.insert(repo,'documents',{branchId:row.branchId,userId:slip.userId,kind:'payslip',title:`Payslip ${row.period}`,sourceId:row.id,employeeId:slip.employeeId,snapshot:{...slip,business:business.value,template,renderVersion:1},released:true,ownerId:actor.id},actor);documents.push(document);if(slip.userId)await this.notification(repo,actor,slip.userId,'hr','Your payslip is available',document.id,row.branchId);}
   await this.emit(repo,actor,'payroll.approved',{payrollId:row.id,documentIds:documents.map(d=>d.id)});return {status:'approved',approvedAt:now(),approvedBy:actor.id,documentIds:documents.map(d=>d.id),businessSnapshot:business.value,templateSnapshot:template};
  },[`${actor.organizationId}:payroll:${initial.branchId}:${initial.period}`]);
 }
 private async publishPage(data:{id:string;expectedVersion:number},actor:Actor):Promise<Row>{
  return this.transition('pages',data,actor,['owner','admin','editor'],async(repo,row)=>{
   const verifiedReview=!!row.reviewedBy&&sameHash(row.reviewedContentHash,{title:row.title,content:row.content,citations:row.citations??[]});
   if(row.kind==='medical')assert(verifiedReview,'VALIDATION','Medical education requires clinical review of this content revision');
   const routes=await this.rows(repo,'pageRoutes',actor);const claimed=routes.find(r=>r.locale===row.locale&&r.slug===row.slug);assert(!claimed||claimed.pageId===row.id,'SLUG_CONFLICT','This URL is already used by another page',409);
   const snapshots=Object.fromEntries(Object.keys(schemas.pages.shape).filter(k=>k!=='reviewedBy'&&row[k]!==undefined).map(k=>[k,row[k]]));const reviewerName=verifiedReview?(row.reviewerName??(await this.record(repo,'users',row.reviewedBy,actor)).name):undefined;const snapshot={...snapshots,id:row.id,version:row.version,publishedAt:now(),renderVersion:1,...(verifiedReview?{reviewedBy:row.reviewedBy,reviewer:{name:reviewerName},reviewedAt:row.reviewedAt}:{})};
   for(const route of routes.filter(r=>r.pageId===row.id&&(r.slug!==row.slug||r.locale!==row.locale)))await this.write(repo,'pageRoutes',route,{status:'redirect',redirectSlug:row.slug,redirectLocale:row.locale});
   if(claimed)await this.write(repo,'pageRoutes',claimed,{status:'active',redirectSlug:null,redirectLocale:null});else await this.insert(repo,'pageRoutes',{pageId:row.id,locale:row.locale,slug:row.slug,status:'active'},actor);
   await this.insert(repo,'publications',{kind:'page',pageId:row.id,snapshot,publishedBy:actor.id},actor);await this.emit(repo,actor,'page.published',{pageId:row.id,slug:row.slug,locale:row.locale});return {status:'published',publishedSnapshot:snapshot,publishedVersion:row.version,publishedAt:snapshot.publishedAt,publishedBy:actor.id};
  },[`${actor.organizationId}:pages`]);
 }
 private async sendMessage(data:Data,actor:Actor):Promise<Row>{
  const id=`message-${hash([actor.organizationId,actor.id,data.idempotencyKey]).slice(0,40)}`;
  return this.db.transaction([`${actor.organizationId}:conversations:${data.conversationId}`],async repo=>{
   const thread=await this.authorized(repo,'conversations',data.conversationId,actor);assert(data.body.length>0||data.attachmentIds.length>0,'VALIDATION','Message cannot be empty');const existing=await repo.get<Row>('messages',id);if(existing){assert(sameHash(existing.requestHash,data),'IDEMPOTENCY_CONFLICT','Message key was used for different content',409);return existing;}
   for(const fileId of data.attachmentIds){const file=await this.record(repo,'files',fileId,actor);assert(file.scanStatus==='clean'&&file.ownerId===actor.id,'FORBIDDEN','Attachment must be your clean uploaded file',403);assert(!file.patientId||file.patientId===thread.patientId,'FORBIDDEN','Attachment belongs to another patient',403);assert(!['clinical','payroll'].includes(file.scope),'FORBIDDEN','Upload a separate conversation attachment; clinical and payroll files retain their access scope',403);assert(!file.conversationId||file.conversationId===thread.id,'FORBIDDEN','Attachment is already bound to another conversation',403);await this.write(repo,'files',file,{scope:'conversation',conversationId:thread.id});}
   const message=await this.insert(repo,'messages',{conversationId:thread.id,branchId:thread.branchId,senderId:actor.id,senderName:actor.name,body:data.body,attachmentIds:data.attachmentIds,status:'stored',requestHash:hash(data)},actor,id);
   await this.write(repo,'conversations',thread,{lastMessageAt:message.createdAt,lastMessageId:message.id,readAt:{...thread.readAt,[actor.id]:message.createdAt}});
   for(const userId of thread.participantIds.filter((v:string)=>v!==actor.id))await this.notification(repo,actor,userId,'messages','You have a new message',thread.id,thread.branchId);
   await this.emit(repo,actor,'chat.message',{messageId:message.id,conversationId:thread.id,participantIds:thread.participantIds});await this.audit(repo,actor,'messages.sent',message);return message;
  });
 }
}
