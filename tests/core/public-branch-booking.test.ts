/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach,expect,it,vi } from 'vitest';
import { PublicController } from '../../apps/api/src/controllers.js';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import { entity } from '../../packages/platform/src/common.js';
const request={get:(name:string)=>name==='origin'?'https://clinic.example':undefined,ip:'127.0.0.1'} as any;
const inquiry={name:'Sample Patient',phone:'+911234567890',date:'2026-12-01',contactConsent:true};
const locations=[{branchId:'main',primary:false},{branchId:'north',primary:true}];
function setup(published:typeof locations=locations){
 vi.stubEnv('ALLOWED_ORIGINS','https://clinic.example');
 const db=new MemoryDatabase(),controller=new PublicController({db,org:'clinic',limiter:{take:async()=>{}},themes:{publicSite:async()=>({settings:{website:{locations:published}}})}} as any);
 return {db,controller};
}
afterEach(()=>vi.unstubAllEnvs());
it('routes explicit and default booking inquiries to a published branch without reserving a slot',async()=>{
 const {db,controller}=setup();
 expect((await controller.booking({...inquiry,branchId:'main'},request) as any).data).toMatchObject({received:true,reserved:false,branchId:'main'});
 expect((await controller.booking(inquiry,request) as any).data.branchId).toBe('north');
 const leads=await db.list('leads');expect(new Set(leads.map(lead=>lead.branchId))).toEqual(new Set(['main','north']));
 for(const lead of leads)expect((lead.requestedAppointment as any).branchId).toBe(lead.branchId);
 expect(await db.list('outbox')).toHaveLength(2);expect(await db.list('appointments')).toHaveLength(0);
});
it('rejects unknown or draft-only branches and preserves the main-branch fallback for old installations',async()=>{
 const {db,controller}=setup([]);
 await db.put('settings',entity('clinic',{key:'website',value:{locations:[{branchId:'draft-only',primary:true}]}},'website'));
 await expect(controller.booking({...inquiry,branchId:'draft-only'},request)).rejects.toMatchObject({code:'BOOKING_BRANCH'});
 await expect(controller.booking({...inquiry,branchId:'unknown'},request)).rejects.toMatchObject({code:'BOOKING_BRANCH'});
 expect(await db.list('leads')).toHaveLength(0);expect(await db.list('outbox')).toHaveLength(0);
 expect((await controller.booking(inquiry,request) as any).data.branchId).toBe('main');
});
it('accepts only public services and active public clinicians in the requested branch',async()=>{
 const {db,controller}=setup();
 await db.put('services',entity('clinic',{public:true,branchId:'north'},'north-service'));
 await db.put('services',entity('clinic',{public:true,branchId:'main'},'main-service'));
 await db.put('services',entity('clinic',{public:false,branchId:'north'},'private-service'));
 await db.put('services',entity('other',{public:true,branchId:'north'},'foreign-service'));
 await db.put('users',entity('clinic',{roles:['doctor'],status:'active',branchIds:['north']},'doctor'));
 await db.put('employees',entity('clinic',{userId:'doctor',publicProfile:true,active:true},'profile'));
 await db.put('availability',entity('clinic',{doctorId:'doctor',branchId:'north',public:true},'availability'));
 for(const serviceId of ['main-service','private-service','foreign-service','missing'])await expect(controller.booking({...inquiry,branchId:'north',serviceId},request)).rejects.toMatchObject({code:'BOOKING_SERVICE'});
 await expect(controller.booking({...inquiry,branchId:'main',doctorId:'doctor'},request)).rejects.toMatchObject({code:'BOOKING_DOCTOR'});
 await expect(controller.booking({...inquiry,branchId:'north',doctorId:'missing'},request)).rejects.toMatchObject({code:'BOOKING_DOCTOR'});
 expect(await db.list('leads')).toHaveLength(0);
 expect((await controller.booking({...inquiry,branchId:'north',serviceId:'north-service',doctorId:'doctor'},request) as any).data.received).toBe(true);
 const profile=(await db.get('employees','profile'))!;await db.put('employees',{...profile,publicProfile:false,version:2},1);
 await expect(controller.booking({...inquiry,branchId:'north',doctorId:'doctor'},request)).rejects.toMatchObject({code:'BOOKING_DOCTOR'});
 expect(await db.list('leads')).toHaveLength(1);
});
it('filters public time suggestions to the selected branch and rejects unpublished branch queries',async()=>{
 const {db,controller}=setup();
 const future=new Date(Date.now()+7*86400000),date=future.toISOString().slice(0,10),weekday=new Date(date+'T00:00:00Z').getUTCDay();
 await db.put('employees',entity('clinic',{userId:'doctor',publicProfile:true,active:true},'profile'));
 for(const [branchId,startTime,endTime] of [['main','09:00','10:00'],['north','14:00','15:00']])await db.put('availability',entity('clinic',{doctorId:'doctor',branchId,public:true,weekday,timezone:'UTC',startTime,endTime,slotMinutes:30},branchId));
 const north=(await controller.availability('doctor',date,'north',request) as any).data;
 expect(north).toHaveLength(2);expect(north.every((slot:any)=>slot.startsAt.startsWith(`${date}T14:`))).toBe(true);
 const main=(await controller.availability('doctor',date,'main',request) as any).data;
 expect(main).toHaveLength(2);expect(main.every((slot:any)=>slot.startsAt.startsWith(`${date}T09:`))).toBe(true);
 await expect(controller.availability('doctor',date,'draft-only',request)).rejects.toMatchObject({code:'BOOKING_BRANCH'});
});
