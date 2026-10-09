/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach,expect,it } from 'vitest';
import { mkdtemp,rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yazl from 'yazl';
import { ClinicService } from '../../packages/core/src/service.js';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import { websiteSettingsSchema,websiteLinkSchema,defaultHomepageSections,type WebsiteSettings } from '../../packages/contracts/src/website.js';
import type { Actor } from '../../packages/contracts/src/index.js';
import { ThemeService,bootstrapTheme } from '../../packages/platform/src/themes.js';
import { buildSeo } from '../../packages/platform/src/seo.js';
import { entity } from '../../packages/platform/src/common.js';
import { PublicController } from '../../apps/api/src/controllers.js';
const owner:Actor={id:'owner',organizationId:'clinic',roles:['owner'],branchIds:['main'],patientIds:[],name:'Owner',email:'owner@example.test'};
const editor:Actor={...owner,id:'editor',roles:['editor']};
function settings():WebsiteSettings{return websiteSettingsSchema.parse({siteName:'Neighbourhood Clinic',origin:'https://clinic.example',description:'Local care',locale:'en-IN',navigation:[{label:'Call',href:'tel:+911234567890'}],homepage:{sections:defaultHomepageSections()},branding:{headingFont:'lora',bodyFont:'source-sans-3'},locations:[{id:'main-public',branchId:'main',name:'Neighbourhood Clinic — Central',slug:'locations/central',primary:true,phone:'+911234567890',displayPhone:'+91 12345 67890',address:{streetAddress:'12 Care Road',addressLocality:'Delhi',addressRegion:'Delhi',postalCode:'110001',addressCountry:'IN'},timezone:'Asia/Kolkata',hours:[{day:1,closed:false,opens:'09:00',closes:'17:00'},{day:0,closed:true}],exceptions:[{date:'2026-12-25',closed:true}],latitude:28.6,longitude:77.2,mapsUrl:'https://maps.google.com/?q=12+Care+Road',googleBusinessProfileUrl:'https://maps.google.com/?cid=123'}]});}
const directories:string[]=[];
afterEach(async()=>{while(directories.length)await rm(directories.pop()!,{recursive:true,force:true});});
async function themeZip(){const archive=new yazl.ZipFile();archive.addBuffer(Buffer.from(JSON.stringify(bootstrapTheme())),'theme.json');archive.end();const chunks:Buffer[]=[];for await(const chunk of archive.outputStream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
it('accepts old website settings and bounded new fields, rejecting executable or ambiguous content',()=>{
 expect(websiteSettingsSchema.parse({siteName:'Clinic',origin:'https://clinic.example',description:'Care',locale:'en'}).homepage).toBeUndefined();
 for(const href of ['javascript:alert(1)','//evil.example','/\\evil.example','/%2f%2fevil.example','https://user:pass@example.com/','mailto:a@example.com?bcc=evil@example.com','/../secret','https://example.com/\n<script>'])expect(websiteLinkSchema.safeParse(href).success,href).toBe(false);
 for(const href of ['/booking?service=care','https://example.com/care','tel:+911234567890','mailto:care@example.com'])expect(websiteLinkSchema.safeParse(href).success,href).toBe(true);
 const content=settings();expect(websiteSettingsSchema.safeParse({...content,homepage:{sections:[...content.homepage!.sections,content.homepage!.sections[0]]}}).success).toBe(false);
 expect(websiteSettingsSchema.safeParse({...content,branding:{bodyFont:'arbitrary-css'}}).success).toBe(false);
 expect(websiteSettingsSchema.safeParse({...content,locations:[{...content.locations![0],primary:false}]}).success).toBe(false);
 expect(websiteSettingsSchema.safeParse({...content,locations:[{...content.locations![0],hours:[{day:1,closed:false,opens:'17:00',closes:'09:00'}]}]}).success).toBe(false);
 expect(websiteSettingsSchema.safeParse({...content,locations:[{...content.locations![0],longitude:undefined}]}).success).toBe(false);
 expect(websiteSettingsSchema.safeParse({...content,locations:[{...content.locations![0],displayPhone:'+91 00000 00000'}]}).success).toBe(false);
});
it('allows website-only editor changes and rejects stale saves or other settings escalation',async()=>{
 const db=new MemoryDatabase(),service=new ClinicService(db),record=await service.create('settings',{key:'website',value:settings()},editor);
 const updated=await service.update('settings','website',{expectedVersion:record.version,value:{...settings(),siteName:'Revised public name'}},editor);
 expect((updated.value as WebsiteSettings).siteName).toBe('Revised public name');
 await expect(service.update('settings','website',{expectedVersion:record.version,value:settings()},editor)).rejects.toMatchObject({status:409});
 await expect(service.create('settings',{key:'business',value:{}},editor)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(service.update('settings','business',{expectedVersion:1,value:{}},editor)).rejects.toMatchObject({code:'FORBIDDEN'});
 await expect(service.update('settings','website',{expectedVersion:updated.version,key:'business',value:{}},editor)).rejects.toMatchObject({code:'IMMUTABLE'});
 await expect(service.create('settings',{key:'website',value:settings()},{...owner,roles:['patient']})).rejects.toMatchObject({code:'FORBIDDEN'});
});
it('requires separately approved organization-owned public images for every content slot',async()=>{
 const db=new MemoryDatabase(),service=new ClinicService(db),content=settings();
 content.homepage!.sections[0].image={assetId:'private-file',alt:'Clinic reception'};
 await db.put('files',entity('clinic',{status:'published',mime:'image/webp'},'private-file'));
 await expect(service.create('settings',{key:'website',value:content},editor)).rejects.toMatchObject({code:'NOT_FOUND'});
 await db.put('publicAssets',entity('other',{status:'published',mime:'image/webp'},'private-file'));
 await expect(service.create('settings',{key:'website',value:content},editor)).rejects.toMatchObject({code:'NOT_FOUND'});
 const foreign=(await db.get('publicAssets','private-file'))!;
 await db.put('publicAssets',{...foreign,organizationId:'clinic',version:2},1);
 expect((await service.create('settings',{key:'website',value:content},editor)).id).toBe('website');
 content.homepage!.sections[1].cards=[{id:'card',heading:'Care',image:{assetId:'unknown',alt:'Unknown'}}];
 await expect(service.update('settings','website',{expectedVersion:1,value:content},editor)).rejects.toMatchObject({code:'NOT_FOUND'});
});
it('freezes website content, fonts and canonical NAP until publication and restores exact previous state',async()=>{
 const db=new MemoryDatabase(),service=new ClinicService(db),root=await mkdtemp(join(tmpdir(),'clinic-website-'));directories.push(root);
 const themes=new ThemeService(db,{root,scanner:{scan:async()=>{}}}),theme=await themes.importZip(await themeZip(),owner);
 const record=await service.create('settings',{key:'website',value:settings()},editor);
 await db.put('settings',entity('clinic',{key:'business',value:{clinicName:'Legal Clinic',bankDetails:'SECRET',logoFileId:'public-logo'}},'business'));
 const first=await themes.activate(theme.id,owner,'');
 const changed=settings();changed.homepage!.sections[0].heading='A revised welcome';changed.locations![0].phone='+919876543210';changed.locations![0].displayPhone='+91 98765 43210';changed.branding!.headingFont='manrope';
 await service.update('settings','website',{expectedVersion:record.version,value:changed},editor);
 let site=await themes.publicSite('clinic');expect(site.settings?.website).toMatchObject({homepage:{sections:[expect.objectContaining({heading:'Personal care, close to home.'}),...settings().homepage!.sections.slice(1)]},branding:{headingFont:'lora'}});
 expect(site.settings?.business.bankDetails).toBeUndefined();expect(site.settings?.business.logoFileId).toBe('public-logo');
 const second=await themes.activate(theme.id,editor,first.id);site=await themes.publicSite('clinic');expect((site.settings?.website.locations as any[])[0].phone).toBe('+919876543210');
 await expect(themes.activate(theme.id,owner,first.id)).rejects.toMatchObject({status:409});
 await themes.rollback(editor,second.id);site=await themes.publicSite('clinic');expect((site.settings?.website.locations as any[])[0].phone).toBe('+911234567890');expect((site.settings?.website.branding as any).headingFont).toBe('lora');
});
it('projects public brand and primary-location NAP without legal finance data',async()=>{
 const db=new MemoryDatabase(),content=settings();await db.put('settings',entity('clinic',{value:{clinicName:'Legal Clinic',address:'Legal Office',phone:'old',bankDetails:'SECRET'}},'business'));await db.put('settings',entity('clinic',{value:{...content,providerSecret:'SECRET'}},'website'));
 const controller=new PublicController({db,org:'clinic',themes:{publicSite:async()=>({settings:{website:{...content,providerSecret:'SECRET'},business:{clinicName:'Legal Clinic',bankDetails:'SECRET'}},pages:[],manifest:bootstrapTheme()})}} as any),result=await controller.site() as any;
 expect(result.data.name).toBe(content.siteName);expect(result.data.phone).toBe('+911234567890');expect(result.data.address.addressLocality).toBe('Delhi');expect(result.data.branding.headingFont).toBe('lora');expect(JSON.stringify(result)).not.toContain('SECRET');
});
it('generates a distinct branch schema from the exact canonical location record',()=>{
 const content=settings(),location=content.locations![0],site={url:'https://clinic.example',name:content.siteName,description:content.description,locations:content.locations};
 const seo=buildSeo({slug:location.slug,title:'Central clinic',type:'branch'},site),graph=(seo.jsonLd as any)['@graph'],branch=graph.find((node:any)=>node['@type']==='MedicalClinic');
 expect(branch['@id']).toBe('https://clinic.example/locations/central#clinic');expect(branch.telephone).toBe(location.phone);expect(branch.address).toMatchObject(location.address);expect(branch.geo).toMatchObject({latitude:28.6,longitude:77.2});expect(branch.openingHoursSpecification).toHaveLength(1);expect(branch.specialOpeningHoursSpecification[0]).toMatchObject({validFrom:'2026-12-25',opens:'00:00',closes:'00:00'});
 expect((buildSeo({slug:location.slug,title:'Central clinic',type:'branch',schemaTypes:['MedicalClinic']},site).jsonLd as any)['@graph'][0]['@id']).toBe(branch['@id']);
});

it('keeps website settings private until the first explicit website publication',async()=>{
 const db=new MemoryDatabase();await db.put('settings',entity('clinic',{value:settings()},'website'));await db.put('settings',entity('clinic',{value:{clinicName:'Basic Clinic'}},'business'));
 const controller=new PublicController({db,org:'clinic',themes:{publicSite:async()=>({settings:null,pages:[],manifest:bootstrapTheme()})}} as any),result=await controller.site() as any;
 expect(result.data.name).toBe('Basic Clinic');expect(result.data.homepage).toBeUndefined();expect(result.data.branding).toBeUndefined();expect(result.data.locations).toEqual([]);expect(result.data.website).toEqual({});
});
it('reserves application routes and prevents page/location URL collisions in either save order',async()=>{
 const db=new MemoryDatabase(),service=new ClinicService(db),content=settings();
 for(const slug of ['workspace','workspace/patients','booking','tools/report','locations'])expect(websiteSettingsSchema.safeParse({...content,locations:[{...content.locations![0],slug}]}).success,slug).toBe(false);
 expect(websiteSettingsSchema.safeParse(content).success).toBe(true);
 await service.create('pages',{title:'Existing page',slug:'existing',kind:'about',locale:'en',content:[]},editor);
 const collision=settings();collision.locations![0].slug='existing';await expect(service.create('settings',{key:'website',value:collision},editor)).rejects.toMatchObject({code:'SLUG_CONFLICT'});
 await service.create('settings',{key:'website',value:content},editor);
 await expect(service.create('pages',{title:'Location clone',slug:content.locations![0].slug,kind:'location',locale:'en',content:[]},editor)).rejects.toMatchObject({code:'SLUG_CONFLICT'});
});
