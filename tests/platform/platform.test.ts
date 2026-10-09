/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yazl from 'yazl';
import sharp from 'sharp';
import { PublicAssetService } from '../../packages/platform/src/public-assets.js';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import { Actor } from '../../packages/contracts/src/index.js';
import { bootstrapTheme, ThemeService, validateThemeZip } from '../../packages/platform/src/themes.js';
import { LocalFileStorage, MalwareScanner } from '../../packages/platform/src/files.js';
import { buildSeo, buildSitemap, jsonLdScript } from '../../packages/platform/src/seo.js';
import { renderBlockNote } from '../../packages/platform/src/content.js';
import { renderFinancialHtml } from '../../packages/platform/src/pdf.js';
import { isPublicAddress, runPublicTool } from '../../packages/platform/src/tools.js';
import { AiDraftService } from '../../packages/platform/src/ai.js';
import { entity } from '../../packages/platform/src/common.js';
const owner:Actor={id:'owner',organizationId:'clinic',roles:['owner'],patientIds:[],branchIds:['main'],name:'Owner',email:'owner@example.test'};
const doctor:Actor={...owner,id:'doctor',roles:['doctor']};
const patient:Actor={...owner,id:'patient',roles:['patient'],patientIds:['patient-a']};
const cleanScanner:MalwareScanner={scan:async()=>{}};
const directories:string[]=[];
async function directory(){const path=await mkdtemp(join(tmpdir(),'clinic-platform-test-'));directories.push(path);return path;}
async function zip(entries:{name:string;data:Buffer;mode?:number}[]) {const archive=new yazl.ZipFile();for(const entry of entries)archive.addBuffer(entry.data,entry.name,{mode:entry.mode});archive.end();const chunks:Buffer[]=[];for await(const chunk of archive.outputStream)chunks.push(Buffer.from(chunk));return Buffer.concat(chunks);}
async function themeZip(){return zip([{name:'theme.json',data:Buffer.from(JSON.stringify(bootstrapTheme()))}]);}
afterEach(async()=>{vi.unstubAllGlobals();while(directories.length)await rm(directories.pop()!,{recursive:true,force:true});});

describe('untrusted ZIP boundaries',()=>{
 it('round-trips a declarative theme and enforces publication authorization',async()=>{
  const db=new MemoryDatabase(),service=new ThemeService(db,{root:await directory(),scanner:cleanScanner});
  await expect(service.importZip(await themeZip(),patient)).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.put('pages',entity('clinic',{status:'published',publishedSnapshot:{id:'home-page',version:1,title:'Original title',slug:'home',content:[]}},'home-page'));
  await db.put('settings',entity('clinic',{key:'business',value:{clinicName:'Original clinic',bankDetails:'private-account'}},'business'));
  const first=await service.importZip(await themeZip(),owner),publication=await service.activate(first.id,owner,'');
  expect((await service.publicSite('clinic')).pages?.[0].title).toBe('Original title');
  expect((await service.publicSite('clinic')).settings?.business.bankDetails).toBeUndefined();
  const page=(await db.get('pages','home-page'))!;await db.put('pages',{...page,version:2,publishedSnapshot:{id:'home-page',version:2,title:'Updated title',slug:'home',content:[]}},1);
  expect((await service.publicSite('clinic')).pages?.[0].title).toBe('Original title');
  expect((await service.publicSite('clinic')).themeId).toBe(first.id);
  const exported=await service.exportZip(first.id,owner);expect((await validateThemeZip(exported,cleanScanner)).manifest.name).toBe('Careline');
  const second=await service.importZip(await themeZip(),owner);await service.activate(second.id,owner,publication.id);
  await expect(service.activate(first.id,owner,publication.id)).rejects.toMatchObject({code:'VERSION_CONFLICT'});
  expect((await service.publicSite('clinic')).pages?.[0].title).toBe('Updated title');
  await service.rollback(owner);expect((await service.publicSite('clinic')).themeId).toBe(first.id);expect((await service.publicSite('clinic')).pages?.[0].title).toBe('Original title');
  await expect(service.preview(first.id,{...owner,organizationId:'other'})).rejects.toMatchObject({code:'NOT_FOUND'});
 });
 it('rejects arbitrary executable files, forged image extensions, symlinks and archive bombs',async()=>{
  const manifest={name:'theme.json',data:Buffer.from(JSON.stringify(bootstrapTheme()))};
  await expect(validateThemeZip(await zip([manifest,{name:'assets/malware.js',data:Buffer.from('alert(1)')}]),cleanScanner)).rejects.toMatchObject({code:'THEME_FILE'});
  await expect(validateThemeZip(await zip([manifest,{name:'assets/photo.png',data:Buffer.from('<svg onload=alert(1)>')}]),cleanScanner)).rejects.toMatchObject({code:'THEME_ASSET'});
  await expect(validateThemeZip(await zip([manifest,{name:'assets/photo.png',data:Buffer.from('/etc/passwd'),mode:0o120777}]),cleanScanner)).rejects.toMatchObject({code:'THEME_SYMLINK'});
  await expect(validateThemeZip(await zip([manifest,{name:'assets/bomb.png',data:Buffer.alloc(1000000)}]),cleanScanner)).rejects.toMatchObject({code:'THEME_BOMB'});
 });
 it('rejects traversal after archive-name corruption and fail-closes scanner errors',async()=>{
  const bytes=await zip([{name:'assets/foo.png',data:Buffer.from('invalid')}]);const corrupted=Buffer.from(bytes);let position=0;while((position=corrupted.indexOf('assets/foo.png',position))!==-1){corrupted.write('../xxx/foo.png',position,'ascii');position+=14;}
  await expect(validateThemeZip(corrupted,cleanScanner)).rejects.toBeDefined();
  await expect(validateThemeZip(await themeZip(),{scan:async()=>{throw new Error('scanner unavailable');}})).rejects.toThrow('scanner unavailable');
 });
 it('rejects arbitrary CSS, outside references and incomplete manifests',async()=>{
  const invalid={...bootstrapTheme(),css:'body{display:none}'};
  await expect(validateThemeZip(await zip([{name:'theme.json',data:Buffer.from(JSON.stringify(invalid))}]),cleanScanner)).rejects.toMatchObject({code:'THEME_MANIFEST'});
 });
});

describe('private files',()=>{
 it('keeps files private and checks patient/branch membership at read time',async()=>{
  const db=new MemoryDatabase(),storage=new LocalFileStorage(db,{root:await directory(),scanner:cleanScanner});
  await db.put('patients',entity('clinic',{name:'Patient A',branchId:'main'},'patient-a'));
  const file=await storage.upload({bytes:Buffer.from('%PDF-1.7\nexample'),mime:'application/pdf',name:'../../report.pdf',patientId:'patient-a'},doctor);
  expect(file.originalName).toBe('report.pdf');expect(file.visibility).toBe('private');await expect(storage.read(file.id,patient)).rejects.toMatchObject({code:'FORBIDDEN'});
  await db.put('files',{...file,released:true,version:2},1);expect((await storage.read(file.id,patient)).record.id).toBe(file.id);
  await expect(storage.read(file.id,{...patient,id:'other',patientIds:['patient-b']})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(storage.read(file.id,{...doctor,id:'other-doctor',branchIds:['elsewhere']})).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(storage.upload({bytes:Buffer.from('<html>'),mime:'application/pdf',name:'report.pdf'},doctor)).rejects.toMatchObject({code:'FILE_TYPE'});
 });
});

describe('explicit public images',()=>{
 it('accepts only editors, strips metadata, and never promotes a private-file identifier',async()=>{
  const db=new MemoryDatabase(),assets=new PublicAssetService(db,{root:await directory(),scanner:cleanScanner});
  const image=await sharp({create:{width:20,height:12,channels:3,background:'#18756b'}}).withMetadata({orientation:6}).png().toBuffer();
  await expect(assets.upload({bytes:image,mime:'image/png',alt:'Clinic reception'},patient)).rejects.toMatchObject({code:'FORBIDDEN'});
  const uploaded=await assets.upload({bytes:image,mime:'image/png',alt:'Clinic reception'},owner);expect(uploaded.url).toBe(`/api/v1/public/assets/${uploaded.id}`);
  const file=await assets.read(uploaded.id,'clinic'),metadata=await sharp(file.bytes).metadata();expect(metadata.format).toBe('webp');expect(metadata.exif).toBeUndefined();expect(metadata.orientation).toBeUndefined();
  expect(await assets.logoDataUri(uploaded.id,'clinic')).toMatch(/^data:image\/webp;base64,/);
  await expect(assets.read(uploaded.id,'other')).rejects.toMatchObject({code:'NOT_FOUND'});await expect(assets.read('private-file-id','clinic')).rejects.toMatchObject({code:'NOT_FOUND'});
 });
});

describe('safe writing and search metadata',()=>{
 const site={url:'https://clinic.example',name:'Care clinic',description:'Local care',defaultSocialImage:'/share.png'};
 it('escapes all rich-text content, inline links and custom citation blocks',()=>{
  const html=renderBlockNote([{type:'heading',props:{level:2},content:[{type:'text',text:'<script>alert(1)</script>'}]},{type:'paragraph',content:[{type:'link',href:'javascript:alert(1)',content:[{text:'unsafe'}]}]},{type:'citation',props:{url:'https://example.com/',title:'Source <x>'}},{type:'image',props:{url:'https://tracker.example/pixel',caption:'x'}}]);
  expect(html).not.toContain('<script>');expect(html).not.toContain('javascript:');expect(html).not.toContain('tracker.example');expect(html).toContain('Source &lt;x&gt;');
 });
 it('generates canonical, schemas, social cards and reciprocal published languages',()=>{
  const seo=buildSeo({slug:'care',title:'Our care',type:'service',status:'published',price:500,currency:'INR',translations:[{locale:'hi',slug:'hi/care',published:true,reciprocal:true},{locale:'fr',slug:'fr/care',published:true,reciprocal:false}]},site);
  expect(seo.canonical).toBe('https://clinic.example/care');expect(seo.alternates.languages.hi).toBe('https://clinic.example/hi/care');expect(seo.alternates.languages.fr).toBeUndefined();expect(seo.openGraph.images[0].width).toBe(1200);expect(JSON.stringify(seo.jsonLd)).toContain('Offer');
  expect(()=>buildSeo({slug:'care',title:'Care',canonical:'https://evil.example/care'},site)).toThrow();
 });
 it('applies selected schema presets and rejects inapplicable claims without generating them',()=>{
  const seo=buildSeo({slug:'service',title:'Visit',type:'service',price:200,currency:'INR',schemaTypes:['WebPage','Service','Offer','Person']},site);
  expect(JSON.stringify(seo.jsonLd)).toContain('Service');expect(JSON.stringify(seo.jsonLd)).toContain('Offer');expect(JSON.stringify(seo.jsonLd)).not.toContain('Person');expect(seo.schemaWarnings).toContain('Person is not applicable to this page type');
  const minimal=buildSeo({slug:'article',title:'Article',type:'article',schemaTypes:['WebPage']},site);expect(JSON.stringify(minimal.jsonLd)).not.toContain('"@type":"Article"');
 });
 it('excludes unpublished/noindex/noncanonical URLs and escapes script terminators',()=>{
  const xml=buildSitemap([{slug:'care',title:'Care',status:'published'},{slug:'draft',title:'Draft',status:'draft'},{slug:'private',title:'Private',status:'published',indexable:false}],site);
  expect(xml).toContain('/care');expect(xml).not.toContain('/draft');expect(xml).not.toContain('/private');expect(jsonLdScript({text:'</script><script>alert(1)</script>'})).not.toContain('</script>');
 });
});

describe('financial document rendering',()=>{
 it('formats exact decimal snapshots and keeps user-supplied HTML inert',()=>{
  const html=renderFinancialHtml({kind:'invoice',snapshot:{number:'INV-001',issuedAt:'2026-10-09',currency:'INR',business:{legalName:'<script>x</script>'},patient:{name:'Test patient'},lines:[{description:'Consultation',quantity:'1',unitPrice:'999.99',total:'999.99'}],subtotal:'999.99',discountTotal:'0',taxTotal:'0',total:'999.99'}},{footer:'<img src=x onerror=alert(1)>'});
  expect(html).toContain('INR 999.99');expect(html).not.toContain('<script>x');expect(html).toContain('&lt;img');
 });
 it('renders credit notes and honors raster logo, font and invoice column settings',async()=>{
  const bytes=await sharp({create:{width:8,height:8,channels:3,background:'#ffffff'}}).webp().toBuffer(),logo=`data:image/webp;base64,${bytes.toString('base64')}`;
  const credit={kind:'credit-note' as const,snapshot:{number:'CN-001',issuedAt:'2026-10-09',invoiceNumber:'INV-001',currency:'USD',business:{clinicName:'Clinic'},patient:{name:'Patient'},total:'20.00',reason:'Service cancelled'}};
  const html=renderFinancialHtml(credit,{logoDataUri:logo,font:'mono'});expect(html).toContain('Credit note CN-001');expect(html).toContain('USD 20.00');expect(html).toContain('data:image/webp;base64,');expect(html).toContain('font-family:monospace');expect(renderFinancialHtml(credit,{logoDataUri:logo,showLogo:false})).not.toContain('<img src=');
  expect(()=>renderFinancialHtml(credit,{logoDataUri:'data:image/svg+xml;base64,PHN2Zz4='})).toThrow('template');
 });
 it('supports zero and three-decimal currencies without floating point math',()=>{
  const data={employeeName:'A',period:'2026-10',earnings:[{label:'Salary',amount:'100.125'}],deductions:[],gross:'100.125',totalDeductions:'0',net:'100.125',business:{clinicName:'Clinic'},currency:'KWD'};
  expect(renderFinancialHtml({kind:'payslip',snapshot:data})).toContain('KWD 100.125');
  expect(()=>renderFinancialHtml({kind:'payslip',snapshot:{...data,currency:'JPY'}})).toThrow('precision');
 });
});

describe('public tools and provider limits',()=>{
 it('rejects reserved, loopback, private, mapped and documentation addresses',()=>{
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','192.0.2.1','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2002:7f00:1::'])expect(isPublicAddress(ip),ip).toBe(false);
  expect(isPublicAddress('8.8.8.8')).toBe(true);expect(isPublicAddress('2606:4700:4700::1111')).toBe(true);
 });
 it('separates business tools from patients and keeps email consent optional for patient results',()=>{
  expect(()=>runPublicTool('no-show-calculator',{}, {audience:'patient'})).toThrow('not available');
  const result=runPublicTool('no-show-calculator',{appointmentsPerMonth:100,noShowPercent:10,averageFee:50},{audience:'business'});expect(result.values.monthlyGrossBookingValue).toBe(500);expect(result.emailPolicy.marketingConsentDefault).toBe(false);
  expect(runPublicTool('visit-preparation',{}, {audience:'patient'}).emailPolicy.resultAvailableWithoutEmail).toBe(true);
 });
 it('AI cannot run without configuration or clinical data permission',async()=>{
  const db=new MemoryDatabase();await expect(new AiDraftService(db,{model:'configured-model'}).draft('note',{text:'dictation'},doctor)).rejects.toMatchObject({code:'AI_NOT_CONFIGURED'});
  await expect(new AiDraftService(db,{apiKey:'secret',model:'configured-model'}).draft('note',{text:'dictation'},doctor)).rejects.toMatchObject({code:'AI_DATA_POLICY'});
 });
 it('reserves provider quota transactionally and always returns review-required drafts',async()=>{
  vi.stubGlobal('fetch',vi.fn(async()=>new Response(JSON.stringify({id:'provider-1',model:'configured-model',choices:[{message:{content:'Draft for review'}}],usage:{total_tokens:10}}),{status:200,headers:{'Content-Type':'application/json'}})));
  const service=new AiDraftService(new MemoryDatabase(),{apiKey:'secret',model:'configured-model',allowedClinicalData:true,monthlyTokenLimit:3000});
  const outcomes=await Promise.allSettled([service.draft('note',{text:'Patient attended.'},doctor),service.draft('note',{text:'Another dictation.'},doctor)]);
  expect(outcomes.filter(item=>item.status==='fulfilled')).toHaveLength(1);const success=outcomes.find(item=>item.status==='fulfilled') as PromiseFulfilledResult<any>;expect(success.value.status).toBe('review_required');expect(success.value.provenance.promptVersion).toBe('clinic-drafts/1');
 });
});
