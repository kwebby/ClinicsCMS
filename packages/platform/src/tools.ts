/* Author: ramanpal singh | URL: https://kwebby.com */
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { assert } from '../../contracts/src/index.js';
import { z } from 'zod';

export type ToolAudience='patient'|'business';
export const PUBLIC_TOOLS=[
 {slug:'visit-preparation',audience:'patient',title:'Prepare for your visit'},
 {slug:'questions-for-doctor',audience:'patient',title:'Questions for your doctor'},
 {slug:'caregiver-planner',audience:'patient',title:'Caregiver and accessibility planner'},
 {slug:'record-checklist',audience:'patient',title:'Organize your health records'},
 {slug:'visit-budget',audience:'patient',title:'Plan your visit budget'},
 {slug:'no-show-calculator',audience:'business',title:'No-show cost calculator'},
 {slug:'admin-workload',audience:'business',title:'Administrative workload estimator'},
 {slug:'operations-scorecard',audience:'business',title:'Clinic operations scorecard'},
 {slug:'queue-planner',audience:'business',title:'Queue and staffing planner'},
 {slug:'website-analyzer',audience:'business',title:'Booking website analyzer'}
] as const;
const count=z.number().int().min(0).max(1_000_000);
function parse<T>(schema:z.ZodType<T>,input:unknown):T {const value=schema.safeParse(input);assert(value.success,'TOOL_INPUT','Please check the tool inputs');return value.data;}
export function runPublicTool(tool:string,input:unknown,context:{audience:ToolAudience;currency?:string;serviceFees?:Record<string,number>}) {
 const definition=PUBLIC_TOOLS.find(item=>item.slug===tool);assert(definition&&definition.audience===context.audience,'NOT_FOUND','Tool not available',404);
 let summary='',items:string[]=[],values:Record<string,string|number|boolean>={};
 switch(tool) {
  case 'visit-preparation': {
   const data=parse(z.object({visitType:z.enum(['first','followup','routine']).default('first'),needsInterpreter:z.boolean().default(false),bringingReports:z.boolean().default(false)}).strict(),input);
   items=['Check the clinic location, time, and booking confirmation.','Bring identification and your current medicines list.','Write down the questions you want to discuss.','Ask the clinic about any preparation instructions.'];
   if(data.visitType==='followup')items.push('Bring the previous visit summary and any requested reports.');
   if(data.needsInterpreter)items.push('Contact the clinic to arrange language assistance.');if(data.bringingReports)items.push('Organize reports by date and bring the originals or accessible digital copies.');summary='Your visit preparation checklist';break;
  }
  case 'questions-for-doctor': {
   const data=parse(z.object({topic:z.enum(['general','followup','medicine']).default('general')}).strict(),input);
   items=['What are the next steps after this visit?','Which changes should prompt me to contact the clinic?','When should I book a follow-up?'];
   if(data.topic==='medicine')items.push('What is the purpose of this medicine?','How should I take it, and what should I do if I miss a dose?','What side effects or interactions should I discuss with you?');
   if(data.topic==='followup')items.push('What has changed since my last visit?','Are additional tests or appointments needed?');summary='Questions to bring to your consultation';break;
  }
  case 'caregiver-planner': {
   const data=parse(z.object({mobilitySupport:z.boolean().default(false),interpreter:z.boolean().default(false),accompanyingAdult:z.boolean().default(true)}).strict(),input);
   items=['Confirm the patient’s consent to your involvement.','Ask the clinic what identity or caregiver authorization is needed.','Record the appointment location, time, and transport plan.'];if(data.mobilitySupport)items.push('Confirm step-free access, seating, and mobility assistance with the clinic.');if(data.interpreter)items.push('Arrange an interpreter before the appointment.');if(data.accompanyingAdult)items.push('Agree which questions the patient wants you to help ask.');summary='Your caregiver visit plan';break;
  }
  case 'record-checklist':parse(z.object({}).strict(),input);items=['Current medicine list with dose and schedule.','Allergies and relevant reactions.','Previous consultation summaries.','Test results in date order.','Referral letters and appointment instructions.','Emergency contact and authorized caregiver details.'];summary='A simple health-record checklist';break;
  case 'visit-budget': {
   const data=parse(z.object({serviceIds:z.array(z.string()).min(1).max(20),transportCost:z.number().min(0).max(1_000_000).default(0)}).strict(),input);let totalMinor=0;
   for(const serviceId of data.serviceIds){const fee=context.serviceFees?.[serviceId];assert(typeof fee==='number'&&Number.isFinite(fee)&&fee>=0,'SERVICE_FEE','A selected service does not have a published fee');totalMinor+=Math.round(fee*100);}
   values={serviceTotal:totalMinor/100,transportCost:data.transportCost,estimatedTotal:(totalMinor+Math.round(data.transportCost*100))/100,currency:context.currency??'USD'};summary='Estimate using the clinic’s published fees';items=['Confirm the final services and charges with the clinic.','Additional services, tests, or taxes may change the final amount.'];break;
  }
  case 'no-show-calculator': {
   const data=parse(z.object({appointmentsPerMonth:count,noShowPercent:z.number().min(0).max(100),averageFee:z.number().min(0).max(1_000_000)}).strict(),input);
   const missed=data.appointmentsPerMonth*data.noShowPercent/100;values={estimatedMissedAppointments:Math.round(missed*10)/10,monthlyGrossBookingValue:Math.round(missed*data.averageFee*100)/100,currency:context.currency??'USD'};summary='Estimated gross booking value associated with missed visits';items=['This estimate is not a profit or recoverable-revenue forecast.','Compare against actual no-shows, reschedules, and filled cancellations.'];break;
  }
  case 'admin-workload': {
   const data=parse(z.object({visitsPerDay:count,minutesPerVisit:z.number().min(0).max(120),workingDays:count,staffHourlyCost:z.number().min(0).max(100000).default(0)}).strict(),input);
   const hours=data.visitsPerDay*data.minutesPerVisit*data.workingDays/60;values={monthlyHours:Math.round(hours*10)/10,estimatedStaffCost:Math.round(hours*data.staffHourlyCost*100)/100,currency:context.currency??'USD'};summary='Administrative workload based on your inputs';items=['Measure a typical week to validate time estimates.','Automation savings require observation after deployment.'];break;
  }
  case 'operations-scorecard': {
   const data=parse(z.object({reminders:z.boolean(),resultsOwnership:z.boolean(),paymentReconciliation:z.boolean(),rolePermissions:z.boolean(),testedBackups:z.boolean()}).strict(),input);
   const entries=Object.entries(data);values={score:entries.filter(([,value])=>value).length*20,total:100};const advice:Record<string,string>={reminders:'Establish a consent-aware appointment reminder process.',resultsOwnership:'Assign a reviewer and absence coverage to each result.',paymentReconciliation:'Reconcile collected payments with issued invoices.',rolePermissions:'Limit each role to the records and actions it needs.',testedBackups:'Run a clean-environment recovery exercise.'};items=entries.filter(([,value])=>!value).map(([key])=>advice[key]);summary='Your self-reported operations checklist';break;
  }
  case 'queue-planner': {
   const data=parse(z.object({arrivalsPerHour:z.number().min(0).max(10000),averageMinutes:z.number().positive().max(240),clinicians:z.number().int().min(1).max(100),targetUtilization:z.number().min(0.5).max(0.95).default(0.8)}).strict(),input);
   const capacity=data.clinicians*60/data.averageMinutes;values={nominalHourlyCapacity:Math.round(capacity*10)/10,utilizationPercent:Math.round(data.arrivalsPerHour/capacity*100),suggestedClinicians:Math.max(1,Math.ceil(data.arrivalsPerHour*data.averageMinutes/(60*data.targetUtilization)))};summary='Capacity estimate for appointment planning';items=['This estimate does not predict wait times.','Account for visit variability, breaks, emergencies, and clinician skills.'];break;
  }
  default:assert(false,'ASYNC_TOOL','Use the website analyzer endpoint for this tool');
 }
 return{tool,audience:context.audience,summary,items,values,clinicalAdvice:false,emailPolicy:{resultAvailableWithoutEmail:context.audience==='patient',detailedReportRequiresEmail:context.audience==='business',marketingConsentRequiredSeparately:true,marketingConsentDefault:false}};
}
export function isPublicAddress(address:string):boolean {
 const family=isIP(address);
 if(family===4){const parts=address.split('.').map(Number),[a,b,c]=parts;return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&(b===168||b===0||b===2))||(a===198&&(b===18||b===19||b===51&&c===100))||(a===203&&b===0&&c===113));}
 if(family===6){const normalized=address.toLowerCase();if(normalized.includes('.'))return false;const first=Number.parseInt(normalized.split(':')[0],16),second=Number.parseInt(normalized.split(':')[1]||'0',16);return first>=0x2000&&first<=0x3fff&&first!==0x2002&&!(first===0x2001&&(second<=0x1ff||second===0xdb8));}
 return false;
}
async function fetchBounded(url:URL,redirects=0):Promise<{html:string;url:string}> {
 assert(['https:','http:'].includes(url.protocol)&&!url.username&&!url.password&&!url.hash&&(!url.port||url.port==='443'&&url.protocol==='https:'||url.port==='80'&&url.protocol==='http:'),'ANALYZER_URL','Only public HTTP(S) website URLs are supported');
 assert(!/(^|\.)(localhost|local|internal|test|invalid)$/.test(url.hostname),'ANALYZER_URL','Private websites cannot be analyzed');
 const hostname=url.hostname.replace(/^\[|\]$/g,'');
 const addresses=isIP(hostname)?[{address:hostname,family:isIP(hostname)}]:await lookup(hostname,{all:true,verbatim:true});
 assert(addresses.length>0&&addresses.every(item=>isPublicAddress(item.address)),'ANALYZER_ADDRESS','Website resolves to a restricted network');
 const address=addresses[0];
 const response=await new Promise<{status:number;location?:string;html:string}>((accept,reject)=>{
  const request=(url.protocol==='https:'?httpsRequest:httpRequest)(url,{method:'GET',headers:{'User-Agent':'ClinicsCMS-WebsiteAnalyzer/1.0','Accept':'text/html','Accept-Encoding':'identity'},lookup:((_host:string,_options:unknown,callback:(error:Error|null,address:string,family:number)=>void)=>callback(null,address.address,address.family)) as never,timeout:8000},res=>{
   const status=res.statusCode??0;
   if(status>=300&&status<400){res.resume();accept({status,location:res.headers.location,html:''});return;}
   if(status!==200||!String(res.headers['content-type']??'').toLowerCase().includes('text/html')||res.headers['content-encoding']&&res.headers['content-encoding']!=='identity'){res.resume();reject(new Error('Website did not return a supported HTML response'));return;}
   let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>2*1024*1024){request.destroy(new Error('Website exceeds the analyzer size limit'));return;}chunks.push(chunk);});res.on('end',()=>accept({status,html:Buffer.concat(chunks).toString('utf8')}));res.on('error',reject);
  });request.on('error',reject);request.on('timeout',()=>request.destroy(new Error('Website request timed out')));request.end();
 });
 if(response.status>=300&&response.status<400){assert(redirects<3&&response.location,'ANALYZER_REDIRECT','Too many or invalid redirects');return fetchBounded(new URL(response.location,url),redirects+1);}
 return {html:response.html,url:url.href};
}
export async function analyzePublicWebsiteLocal(value:string) {
 assert(typeof value==='string'&&value.length<=2048,'ANALYZER_URL','Invalid website URL');let url:URL;try{url=new URL(value);}catch{assert(false,'ANALYZER_URL','Enter a full website URL');}
 const {html,url:finalUrl}=await fetchBounded(url);
 const visible=html.replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi,'').replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi,'');
 const checks={https:finalUrl.startsWith('https:'),title:/<title\b[^>]*>[^<]{1,200}<\/title>/i.test(html),description:/<meta\b[^>]*\bname\s*=\s*["']description["']/i.test(html),mobileViewport:/<meta\b[^>]*\bname\s*=\s*["']viewport["']/i.test(html),mainHeading:/<h1\b/i.test(visible),bookingLink:/<a\b[^>]*href\s*=\s*["'][^"']*(book|appointment|schedule)[^"']*["']/i.test(visible),contactLink:/href\s*=\s*["'](?:tel:|mailto:|[^"']*contact)/i.test(visible),structuredData:/<script\b[^>]*type\s*=\s*["']application\/ld\+json["']/i.test(html),socialTags:/<meta\b[^>]*property\s*=\s*["']og:title["']/i.test(html)};
 return {url:finalUrl,checks,score:Math.round(Object.values(checks).filter(Boolean).length/Object.keys(checks).length*100),scope:'One public HTML page; heuristic observations, not a technical SEO or security certification.',fetchedAt:new Date().toISOString()};
}

export async function analyzePublicWebsite(value:string) {
 const socketPath=process.env.ANALYZER_SOCKET;
 assert(socketPath||process.env.NODE_ENV!=='production','ANALYZER_ISOLATION','Production website analysis requires the isolated worker socket',503);
 if(!socketPath)return analyzePublicWebsiteLocal(value);
 assert(typeof value==='string'&&value.length<=2048,'ANALYZER_URL','Invalid website URL');
 const payload=JSON.stringify({url:value});
 return new Promise<Awaited<ReturnType<typeof analyzePublicWebsiteLocal>>>((accept,reject)=>{
  const req=httpRequest({socketPath,path:'/analyze',method:'POST',headers:{'Content-Type':'application/json','Content-Length':Buffer.byteLength(payload)},timeout:40000},res=>{
   let size=0;const chunks:Buffer[]=[];res.on('data',(chunk:Buffer)=>{size+=chunk.length;if(size>32768){req.destroy(new Error('Analyzer response exceeds budget'));return;}chunks.push(chunk);});
   res.on('end',()=>{try{const body=JSON.parse(Buffer.concat(chunks).toString('utf8'));if(res.statusCode!==200){reject(new Error('Website analysis failed'));return;}accept(body);}catch(error){reject(error);}});res.on('error',reject);
  });req.on('error',reject);req.on('timeout',()=>req.destroy(new Error('Website analyzer timed out')));req.end(payload);
 });
}
