/* Author: ramanpal singh | URL: https://kwebby.com */
import { z } from 'zod';
import { DomainError } from '../../contracts/src/index.js';
import { websiteSettingsSchema } from '../../contracts/src/website.js';

const id = z.string().min(1).max(100).regex(/^[A-Za-z0-9_-]+$/);
const text = z.string().trim().min(1).max(500);
const note = z.string().trim().max(10000);
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(v => Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0,10) === v, 'Invalid date');
const datetime = z.string().datetime({ offset: true });
const time = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
const decimal = z.string().regex(/^\d{1,12}(?:\.\d{1,6})?$/);
const currency = z.string().regex(/^[A-Z]{3}$/);
const timezone = z.string().max(100).refine(value => { try { new Intl.DateTimeFormat('en', { timeZone:value }); return true; } catch { return false; } }, 'Invalid timezone');
const locale = z.string().max(30).refine(value => { try { return Intl.getCanonicalLocales(value).length === 1; } catch { return false; } });
const email = z.string().email().max(254);
const phone = z.string().max(40);
const object = z.record(z.string(), z.unknown());
const httpsUrl = z.string().max(2048).url().refine(value => new URL(value).protocol === 'https:', 'HTTPS URL required');
const blocks = z.array(object).max(2000).superRefine((value, ctx) => {
  const encoded = JSON.stringify(value);
  if (new TextEncoder().encode(encoded).length > 200*1024) ctx.addIssue({code:'custom',message:'Document exceeds the portable 200 KiB limit; split it into separate documents',params:{httpStatus:413}});
  // Keep canonical editor JSON lossless; disallow executable nodes/properties and unsafe links before persistence.
  const visit = (node: unknown, depth: number): void => {
    if (depth > 30) { ctx.addIssue({code:'custom',message:'Document nesting exceeds limit'}); return; }
    if (Array.isArray(node)) { node.forEach(v => visit(v,depth+1)); return; }
    if (!node || typeof node !== 'object') return;
    for (const [key, val] of Object.entries(node)) {
      if (/^(?:__proto__|prototype|constructor|html|innerHTML|srcDoc|on(?:click|load|error|mouse.*|key.*|focus|blur|submit))$/.test(key)) ctx.addIssue({code:'custom',message:'Executable document properties are not allowed'});
      if ((key === 'href' || key === 'url' || key === 'src') && typeof val === 'string' && val && !/^(?:https:\/\/|\/api\/v1\/files\/|\/api\/v1\/public\/assets\/|mailto:|tel:|#)/i.test(val)) ctx.addIssue({code:'custom',message:'Unsafe document URL'});
      visit(val,depth+1);
    }
  }; visit(value,0);
});
const mediaUrls=(value:unknown):string[]=>{const urls:string[]=[];const visit=(v:any)=>{if(Array.isArray(v))v.forEach(visit);else if(v&&typeof v==='object'){if(['image','video','audio','file'].includes(v.type)&&v.props?.url)urls.push(String(v.props.url));Object.values(v).forEach(visit);}};visit(value);return urls;};
const clinicalBlocks=blocks.refine(value=>mediaUrls(value).every(url=>/^\/api\/v1\/files\/[A-Za-z0-9_-]+$/.test(url)),'Clinical media must use a protected clinic upload');
const publicBlocks=blocks.refine(value=>mediaUrls(value).every(url=>/^\/api\/v1\/public\/assets\/[A-Za-z0-9_-]+$/.test(url)),'Public media must use a separately approved public asset');
const branch = { branchId:id };
const patient = { ...branch, patientId:id };
const observations = z.object({bloodPressure:z.string().max(50).optional(),pulse:z.number().min(0).max(500).optional(),temperature:z.number().min(20).max(50).optional(),weight:z.number().min(0).max(1000).optional(),height:z.number().min(0).max(300).optional()}).strict();
const salaryItems = z.array(z.object({label:text,amount:decimal}).strict()).max(50);
const seo = z.object({title:z.string().max(120).optional(),description:z.string().max(400).optional(),canonical:httpsUrl.optional(),indexable:z.boolean().optional(),socialTitle:z.string().max(120).optional(),socialDescription:z.string().max(400).optional(),socialImage:z.string().max(2048).regex(/^(https:\/\/|\/api\/v1\/public\/assets\/)/).optional(),socialImageAlt:z.string().max(300).optional(),schemaTypes:z.array(z.enum(['WebSite','WebPage','MedicalClinic','Person','IndividualPhysician','Service','Offer','MedicalWebPage','Article','BlogPosting','FAQPage','AboutPage','ContactPage','CollectionPage','ItemList','WebApplication','Organization','SoftwareApplication','BreadcrumbList'])).max(10).optional(),schema:object.optional(),translations:z.array(z.object({locale,slug:z.string().regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/)}).strict()).max(30).optional()}).strict();
export const settingsSchemas:Record<string,z.ZodType> = {
  business:z.object({clinicName:text,name:text.optional(),country:z.string().length(2),currency,timezone,locale,address:note,email,phone,businessIds:z.record(z.string().max(50),z.string().max(150)).default({}),legalName:text.optional(),website:httpsUrl.optional(),logoFileId:id.optional(),bankDetails:note.optional(),fiscalYearStart:z.number().int().min(1).max(12).default(1),invoicePrefix:z.string().regex(/^[A-Z0-9-]{1,20}$/).default('INV'),taxLabel:z.string().max(80).optional(),publicBooking:z.boolean().default(true)}).strict(),
  localization:z.object({country:z.string().length(2),currency,timezone,locale,dateFormat:z.enum(['DD/MM/YYYY','MM/DD/YYYY','YYYY-MM-DD']),fiscalYearStart:z.number().int().min(1).max(12),features:z.object({ai:z.boolean(),publicTools:z.boolean(),onlinePayments:z.boolean(),payroll:z.boolean()}).strict()}).strict(),
  notifications:z.object({defaultEmail:z.boolean(),quietStart:time.optional(),quietEnd:time.optional(),timezone,retryLimit:z.number().int().min(1).max(10).default(5),escalationMinutes:z.number().int().min(5).max(10080).default(60)}).strict(),
  website:websiteSettingsSchema,
  'ai-policy':z.object({enabled:z.boolean(),clinicalDataAllowed:z.boolean(),provider:z.enum(['openai','openai-compatible','disabled']),model:z.string().max(100),dailyQuota:z.number().int().min(0).max(10000),retentionApproved:z.boolean()}).strict(),
};

export const schemas = {
  patients:z.object({...branch,name:text,dateOfBirth:date.optional(),email:email.optional(),phone:phone.optional(),address:note.optional(),allergies:z.array(text).max(100).default([]),medicines:z.array(text).max(100).default([]),emergencyContact:z.object({name:text,phone,relationship:text}).strict().optional()}).strict(),
  appointments:z.object({...patient,doctorId:id,startsAt:datetime,endsAt:datetime,reason:note.optional(),kind:z.enum(['consultation','follow-up','walk-in']).default('consultation')}).strict(),
  availability:z.object({...branch,doctorId:id,weekday:z.number().int().min(0).max(6),startTime:time,endTime:time,timezone,slotMinutes:z.number().int().min(5).max(240)}).strict(),
  leave:z.object({...branch,employeeId:id,startsAt:datetime,endsAt:datetime,reason:note.optional()}).strict(),
  encounters:z.object({...patient,appointmentId:id.optional(),doctorId:id,content:clinicalBlocks,observations:observations.optional(),diagnosis:z.array(text).max(100).optional(),followUpAt:datetime.optional()}).strict(),
  prescriptions:z.object({...patient,encounterId:id,medications:z.array(z.object({name:text,dose:text,route:text,frequency:text,duration:text,instructions:note.optional()}).strict()).min(1).max(50),instructions:note.optional()}).strict(),
  results:z.object({...patient,title:text,reviewerId:id,coveringReviewerId:id.optional(),fileId:id.optional(),critical:z.boolean().default(false),dueAt:datetime.optional()}).strict(),
  referrals:z.object({...patient,encounterId:id.optional(),destination:text,reason:note,assignedTo:id.optional()}).strict(),
  tasks:z.object({...branch,title:text,assignedTo:id,patientId:id.optional(),dueAt:datetime.optional(),priority:z.enum(['normal','high','urgent']).default('normal'),category:z.enum(['administrative','clinical','finance']).default('administrative'),description:note.optional()}).strict(),
  leads:z.object({...branch,name:text,email:email.optional(),phone:phone.optional(),source:text,interest:note.optional(),assignedTo:id.optional(),callbackAt:datetime.optional(),marketingConsent:z.boolean().default(false),attribution:z.object({utmSource:text.optional(),utmMedium:text.optional(),utmCampaign:text.optional(),referrer:z.string().max(2048).optional()}).strict().optional(),notes:blocks.default([])}).strict(),
  employees:z.object({...branch,userId:id.optional(),name:text,email,jobTitle:text,role:z.enum(['doctor','nurse','receptionist','manager','accountant','hr','editor','employee']).default('employee'),registrationNumber:z.string().max(100).optional(),specialty:text.optional(),publicProfile:z.boolean().default(false),salary:z.object({currency,base:decimal,earnings:salaryItems.default([]),deductions:salaryItems.default([])}).strict(),joinedOn:date.optional()}).strict(),
  services:z.object({...branch,name:text,description:note.optional(),price:decimal,currency,durationMinutes:z.number().int().min(5).max(480),public:z.boolean().default(false),taxRate:decimal.default('0')}).strict(),
  invoices:z.object({...patient,currency,lines:z.array(z.object({description:text,quantity:decimal,unitPrice:decimal,taxRate:decimal.default('0'),discount:decimal.default('0')}).strict()).min(1).max(200),notes:blocks.default([]),dueAt:datetime.optional(),templateId:id.optional()}).strict(),
  payroll:z.object({...branch,period:z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/),employeeIds:z.array(id).min(1).max(500),adjustments:z.array(z.object({employeeId:id,label:text,amount:decimal,kind:z.enum(['earning','deduction'])}).strict()).max(1000).default([]),templateId:id.optional()}).strict(),
  templates:z.object({branchId:id.optional(),name:text,kind:z.enum(['invoice','payslip']),content:blocks.default([]),design:z.object({accent:z.string().regex(/^#[\da-fA-F]{6}$/),font:z.enum(['system','serif','mono']),showLogo:z.boolean(),columns:z.array(z.enum(['description','quantity','unitPrice','discount','tax','total'])).min(1).max(6),footer:note.optional(),terms:note.optional()}).strict()}).strict(),
  pages:z.object({branchId:id.optional(),title:text,slug:z.string().regex(/^[a-z0-9]+(?:[-/][a-z0-9]+)*$/).max(250),kind:z.enum(['home','location','doctor','service','medical','article','faq','about','contact','directory','tool','vendor']),locale,content:publicBlocks,seo:seo.optional(),reviewedBy:id.optional(),citations:z.array(z.object({title:text,url:httpsUrl}).strict()).max(100).optional()}).strict(),
  conversations:z.object({...branch,title:text,kind:z.enum(['staff','patient-service','clinical']),participantIds:z.array(id).min(1).max(100),patientId:id.optional(),assignedTo:id.optional()}).strict(),
  consents:z.object({...patient,purpose:z.enum(['care','marketing','ai','caregiver','reminders']),granted:z.boolean(),versionLabel:text,source:text}).strict(),
  settings:z.object({key:z.enum(['business','localization','notifications','website','ai-policy']),value:object}).strict(),
};
export type Creatable = keyof typeof schemas;
export const actionSchemas = {
  version:z.object({id,expectedVersion:z.number().int().positive()}).strict(),
  status:z.object({id,expectedVersion:z.number().int().positive(),status:z.enum(['arrived','in-progress','completed','cancelled','no-show'])}).strict(),
  taskStatus:z.object({id,expectedVersion:z.number().int().positive(),status:z.enum(['open','in-progress','blocked','completed']),note:note.optional()}).strict(),
  reschedule:z.object({id,expectedVersion:z.number().int().positive(),startsAt:datetime,endsAt:datetime,doctorId:id.optional()}).strict(),
  encounterSave:z.object({id,expectedVersion:z.number().int().positive(),content:clinicalBlocks,observations:observations.optional(),diagnosis:z.array(text).max(100).optional(),followUpAt:datetime.optional()}).strict(),
  amend:z.object({id,expectedVersion:z.number().int().positive(),content:clinicalBlocks,reason:text}).strict(),
  review:z.object({id,expectedVersion:z.number().int().positive(),summary:note,actionRequired:z.boolean()}).strict(),
  contact:z.object({id,expectedVersion:z.number().int().positive(),outcome:z.enum(['attempted','communicated']),note}).strict(),
  note:z.object({id,expectedVersion:z.number().int().positive(),note}).strict(),
  optionalNote:z.object({id,expectedVersion:z.number().int().positive(),note:note.optional()}).strict(),
  reassign:z.object({id,expectedVersion:z.number().int().positive(),reviewerId:id,coveringReviewerId:id.optional()}).strict(),
  leaveApprove:z.object({id,expectedVersion:z.number().int().positive(),approved:z.boolean()}).strict(),
  leadTransition:z.object({id,expectedVersion:z.number().int().positive(),stage:z.enum(['new','contacted','qualified','booked','closed']),closureReason:note.optional(),appointmentId:id.optional()}).strict(),
  leadContact:z.object({id,expectedVersion:z.number().int().positive(),note,outcome:text,callbackAt:datetime.optional()}).strict(),
  payment:z.object({invoiceId:id,amount:decimal,method:z.enum(['cash','bank']),reference:text.optional(),idempotencyKey:z.string().min(8).max(100)}).strict(),
  refund:z.object({paymentId:id,amount:decimal,reason:text,idempotencyKey:z.string().min(8).max(100)}).strict(),
  payrollPay:z.object({id,expectedVersion:z.number().int().positive(),reference:text}).strict(),
  restore:z.object({id,expectedVersion:z.number().int().positive(),revisionId:id}).strict(),
  message:z.object({conversationId:id,body:z.string().trim().max(10000),attachmentIds:z.array(id).max(10).default([]),idempotencyKey:z.string().min(8).max(100)}).strict(),
  transfer:z.object({id,expectedVersion:z.number().int().positive(),assignedTo:id,participantIds:z.array(id).min(1).max(100)}).strict(),
  read:z.object({id}).strict(),
  intake:z.object({patientId:id,appointmentId:id.optional(),content:clinicalBlocks,allergies:z.array(text).max(100).optional(),medicines:z.array(text).max(100).optional()}).strict(),
  prescriptionSave:z.object({id,expectedVersion:z.number().int().positive(),medications:schemas.prescriptions.shape.medications,instructions:note.optional()}).strict(),
  credit:z.object({invoiceId:id,amount:decimal,reason:text,idempotencyKey:z.string().min(8).max(100)}).strict(),
  preferences:z.object({categories:z.array(z.enum(['security','operations','clinical','finance','hr','messages','appointments','content'])).max(8),email:z.boolean(),inApp:z.boolean(),quietStart:time.optional(),quietEnd:time.optional(),timezone}).strict(),
};
export function parse<T>(schema:z.ZodType<T>,input:unknown):T { const parsed=schema.safeParse(input); if(!parsed.success) {const oversized=parsed.error.issues.some(issue=>issue.code==='custom'&&issue.params?.httpStatus===413);throw new DomainError(oversized?'DOCUMENT_TOO_LARGE':'VALIDATION',parsed.error.issues.map(v=>`${v.path.join('.')}: ${v.message}`).join('; '),oversized?413:400);} return parsed.data; }
export { blocks, id, decimal, currency, mediaUrls };
