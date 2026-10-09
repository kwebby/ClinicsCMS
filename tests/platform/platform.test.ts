/* Author: ramanpal singh | URL: https://kwebby.com */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createServer, type Server } from 'node:http';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import yazl from 'yazl';
import sharp from 'sharp';
import { PublicAssetService } from '../../packages/platform/src/public-assets.js';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
import { Actor } from '../../packages/contracts/src/index.js';
import { bootstrapTheme, ThemeService, validateThemeZip } from '../../packages/platform/src/themes.js';
import { ClamAvScanner, LocalFileStorage, MalwareScanner, detectMime } from '../../packages/platform/src/files.js';
import { buildSeo, buildSitemap, buildSitemapReport, jsonLdScript } from '../../packages/platform/src/seo.js';
import { renderBlockNote } from '../../packages/platform/src/content.js';
import { renderFinancialHtml } from '../../packages/platform/src/pdf.js';
import { ANALYZER_POLICY, analyzePublicWebsiteLocal, inspectHtml, isPublicAddress, runPublicTool } from '../../packages/platform/src/tools.js';
import { AiDraftService } from '../../packages/platform/src/ai.js';
import { createAdmission, entity } from '../../packages/platform/src/common.js';
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
  for(const ip of ['127.0.0.1','10.0.0.1','172.16.0.1','192.168.1.1','169.254.169.254','100.64.0.1','198.18.0.1','192.0.2.1','192.0.0.8','192.88.99.1','203.0.113.9','198.51.100.7','224.0.0.1','255.255.255.255','0.1.2.3','::1','fc00::1','fe80::1','::ffff:127.0.0.1','2001:db8::1','2001::1','2002:7f00:1::','3fff::1'])expect(isPublicAddress(ip),ip).toBe(false);
  for(const ip of ['8.8.8.8','192.0.1.1','192.0.3.1','192.2.0.1','192.169.0.1','172.32.0.1','100.128.0.1','2606:4700:4700::1111'])expect(isPublicAddress(ip),ip).toBe(true);
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

describe('website analyzer network and parsing bounds',()=>{
 let server:Server,port=0;const timers=new Set<NodeJS.Timeout>();
 const resolve=async(host:string)=>host==='clinic.example'?[{address:'127.0.0.1',family:4}]:host==='internal.example'?[{address:'10.0.0.5',family:4}]:[];
 const local={resolve,allowAddress:(address:string)=>address==='127.0.0.1'||isPublicAddress(address),allowPort:()=>true};
 const page='<!doctype html><html><head><title>Riverside Clinic</title><meta name="description" content="Care"><meta name="viewport" content="width=device-width"><meta property="og:title" content="Riverside"><script type="application/ld+json">{"@type":"MedicalClinic"}</script><script>document.write("<h1>")</script></head><body><h1>Welcome</h1><a href="/book-appointment">Book</a><a href="tel:+15550100">Call</a></body></html>';
 beforeAll(async()=>{
  server=createServer((req,res)=>{
   if(req.url==='/redirect'){res.writeHead(302,{Location:`http://internal.example:${port}/`}).end();return;}
   if(req.url==='/large'){res.writeHead(200,{'Content-Type':'text/html'}).end('x'.repeat(4096));return;}
   if(req.url==='/slow'){res.writeHead(200,{'Content-Type':'text/html'});const timer=setInterval(()=>res.write('<p>'),50);timers.add(timer);res.on('close',()=>{clearInterval(timer);timers.delete(timer);});return;}
   res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(page);
  });
  await new Promise<void>(done=>server.listen(0,'127.0.0.1',done));port=(server.address() as {port:number}).port;
 });
 afterAll(async()=>{for(const timer of timers)clearInterval(timer);server.closeAllConnections();await new Promise(done=>server.close(done));});
 it('fetches through the pinned lookup Node uses for every connection and scores the page',async()=>{
  const result=await analyzePublicWebsiteLocal(`http://clinic.example:${port}/`,local);
  expect(result.url).toBe(`http://clinic.example:${port}/`);
  expect(result.checks).toEqual({https:false,title:true,description:true,mobileViewport:true,mainHeading:true,bookingLink:true,contactLink:true,structuredData:true,socialTags:true});
 });
 it('revalidates redirect targets, caps bytes and enforces one overall deadline',async()=>{
  await expect(analyzePublicWebsiteLocal(`http://clinic.example:${port}/redirect`,local)).rejects.toMatchObject({code:'ANALYZER_ADDRESS'});
  await expect(analyzePublicWebsiteLocal(`http://clinic.example:${port}/large`,{...local,maxBytes:1024})).rejects.toThrow('size limit');
  const started=Date.now();await expect(analyzePublicWebsiteLocal(`http://clinic.example:${port}/slow`,{...local,deadlineMs:300})).rejects.toMatchObject({code:'ANALYZER_TIMEOUT'});expect(Date.now()-started).toBeLessThan(3000);
  await expect(analyzePublicWebsiteLocal('http://clinic.example/',{...local,resolve:()=>new Promise(()=>{}),deadlineMs:200})).rejects.toMatchObject({code:'ANALYZER_TIMEOUT'});
 });
 it('keeps production defaults: public addresses and default ports only',async()=>{
  expect(ANALYZER_POLICY.allowAddress).toBe(isPublicAddress);expect(Object.isFrozen(ANALYZER_POLICY)).toBe(true);
  await expect(analyzePublicWebsiteLocal(`http://127.0.0.1:${port}/`)).rejects.toMatchObject({code:'ANALYZER_URL'});
  await expect(analyzePublicWebsiteLocal('http://127.0.0.1/')).rejects.toMatchObject({code:'ANALYZER_ADDRESS'});
  await expect(analyzePublicWebsiteLocal('http://[::1]/')).rejects.toMatchObject({code:'ANALYZER_ADDRESS'});
 });
 it('inspects hostile 2 MiB documents in linear time',()=>{
  const size=2*1024*1024,started=performance.now();
  for(const unit of ['<script>','<title','<meta ','<a href="','<a ','<','<style>x'])inspectHtml(unit.repeat(Math.ceil(size/unit.length)));
  inspectHtml(`<a ${'x="'.repeat(size/2)}>`);
  expect(performance.now()-started).toBeLessThan(2000);
  expect(inspectHtml('<script>"<h1>"</script><h1>x</h1>').mainHeading).toBe(true);expect(inspectHtml('<script><h1>never closed').mainHeading).toBe(false);
 });
});

describe('runtime dependency loading',()=>{
 it('loads the browser driver only when a PDF is rendered locally',()=>{
  const script="import {createRequire} from 'node:module';const loaded=()=>Object.keys(createRequire(import.meta.url).cache).some(key=>/[\\\\/]playwright(-core)?[\\\\/]/.test(key));await import('./packages/platform/src/index.ts');const startup=loaded();await import('playwright-core');process.stdout.write(JSON.stringify({startup,afterImport:loaded()}));";
  const result=spawnSync(process.execPath,['--import','tsx','--input-type=module','-e',script],{cwd:join(import.meta.dirname,'../..'),encoding:'utf8',timeout:60000});
  expect(result.status,result.stderr).toBe(0);expect(JSON.parse(result.stdout)).toEqual({startup:false,afterImport:true});
 },60000);
});

describe('theme assets are rebuilt before publication',()=>{
 const manifest={name:'theme.json',data:Buffer.from(JSON.stringify(bootstrapTheme()))};
 const woff2=(patch:(bytes:Buffer)=>void=()=>{})=>{const bytes=Buffer.alloc(64);bytes.write('wOF2',0,'latin1');bytes.writeUInt32BE(0x00010000,4);bytes.writeUInt32BE(64,8);bytes.writeUInt16BE(1,12);bytes.writeUInt32BE(16,20);patch(bytes);return bytes;};
 it('re-encodes images without EXIF/GPS metadata or appended payloads',async()=>{
  const original=await sharp({create:{width:16,height:10,channels:3,background:'#18756b'}}).jpeg().withExif({IFD0:{ImageDescription:'GPS 51.5 -0.12 private'}}).toBuffer();
  const tampered=Buffer.concat([original,Buffer.from('APPENDED-PAYLOAD')]);expect((await sharp(tampered).metadata()).exif).toBeDefined();
  const validated=await validateThemeZip(await zip([manifest,{name:'assets/photo.jpg',data:tampered}]),cleanScanner),stored=validated.files.get('assets/photo.jpg')!;
  expect(stored.includes('APPENDED-PAYLOAD')).toBe(false);expect(stored.includes('private')).toBe(false);const metadata=await sharp(stored).metadata();expect(metadata.exif).toBeUndefined();expect([metadata.format,metadata.width,metadata.height]).toEqual(['jpeg',16,10]);
  const service=new ThemeService(new MemoryDatabase(),{root:await directory(),scanner:cleanScanner}),theme=await service.importZip(await zip([manifest,{name:'assets/photo.jpg',data:tampered}]),owner);
  expect((await service.asset(theme.id,'assets/photo.jpg','clinic',owner)).bytes.equals(stored)).toBe(true);
 });
 it('validates the WOFF2 header instead of trusting the signature',async()=>{
  expect(detectMime(woff2())).toBe('font/woff2');
  for(const broken of [woff2(bytes=>bytes.writeUInt32BE(65,8)),woff2(bytes=>bytes.writeUInt32BE(0x12345678,4)),woff2(bytes=>bytes.writeUInt16BE(0,12)),woff2(bytes=>bytes.writeUInt16BE(1,14)),woff2(bytes=>bytes.writeUInt32BE(64,20)),woff2(bytes=>{bytes.writeUInt32BE(60,28);bytes.writeUInt32BE(10,32);}),Buffer.from('wOF2')])expect(detectMime(broken)).toBeNull();
  expect((await validateThemeZip(await zip([manifest,{name:'assets/font.woff2',data:woff2()}]),cleanScanner)).files.has('assets/font.woff2')).toBe(true);
  await expect(validateThemeZip(await zip([manifest,{name:'assets/font.woff2',data:woff2(bytes=>bytes.writeUInt32BE(1000,8))}]),cleanScanner)).rejects.toMatchObject({code:'THEME_ASSET'});
 });
});

describe('website publication at scale',()=>{
 const website=(slug:string)=>entity('clinic',{key:'website',value:{locations:[{slug,branchId:'main',name:'Main'}]}},'website');
 it('publishes every page past any single list page and finds late slug conflicts',async()=>{
  const db=new MemoryDatabase(),service=new ThemeService(db,{root:await directory(),scanner:cleanScanner}),theme=await service.importZip(await themeZip(),owner);
  for(let index=0;index<1205;index++){const pageId=`page-${String(index).padStart(5,'0')}`;await db.put('pages',entity('clinic',{status:'published',slug:`article-${index}`,publishedSnapshot:{id:pageId,version:1,title:`Article ${index}`,slug:`article-${index}`,content:[]}},pageId));}
  await db.put('settings',website('article-1204'));
  await expect(service.activate(theme.id,owner)).rejects.toMatchObject({code:'SLUG_CONFLICT'});
  await db.put('settings',{...website('downtown'),version:2},1);
  for(let index=0;index<1100;index++)await db.put('pageRoutes',entity('clinic',{slug:index===1099?'uptown':`old-${index}`,status:'redirect'},`route-${String(index).padStart(5,'0')}`));
  const publication=await service.activate(theme.id,owner);expect((publication.contentSnapshots as unknown[]).length).toBe(1205);
  const site=await service.publicSite('clinic');expect(site.pages).toHaveLength(1205);
  await db.put('settings',{...website('uptown'),version:3},2);await expect(service.activate(theme.id,owner)).rejects.toMatchObject({code:'SLUG_CONFLICT'});
 },60000);
 it('serves anonymous requests from a frozen per-publication cache invalidated by publish and rollback',async()=>{
  const db=new MemoryDatabase(),root=await directory(),service=new ThemeService(db,{root,scanner:cleanScanner}),theme=await service.importZip(await themeZip(),owner);
  await db.put('pages',entity('clinic',{status:'published',publishedSnapshot:{id:'home-page',version:1,title:'First',slug:'home',content:[]}},'home-page'));
  const first=await service.activate(theme.id,owner),site=await service.publicSite('clinic');
  expect(Object.isFrozen(site.pages![0])).toBe(true);expect(()=>{(site.pages![0] as Record<string,unknown>).title='changed';}).toThrow();
  const publicationDirectory=join(root,'publications','clinic',first.id);for(const file of await readdir(publicationDirectory))await rm(join(publicationDirectory,file));
  expect(await service.publicSite('clinic')).toBe(site);await expect(service.asset(theme.id,'assets/missing.png','clinic')).rejects.toMatchObject({code:'NOT_FOUND',message:'Asset not found'});
  const page=(await db.get('pages','home-page'))!;await db.put('pages',{...page,version:2,publishedSnapshot:{id:'home-page',version:2,title:'Second',slug:'home',content:[]}},1);
  await service.activate(theme.id,owner,first.id);expect((await service.publicSite('clinic')).pages?.[0].title).toBe('Second');
  await service.rollback(owner);await expect(service.publicSite('clinic')).rejects.toMatchObject({code:'ENOENT'});
 });
});

describe('upload scope and scanner outcomes',()=>{
 it('only links a patient to non-clinical uploads within the uploader\'s scope',async()=>{
  const db=new MemoryDatabase(),storage=new LocalFileStorage(db,{root:await directory(),scanner:cleanScanner}),pdf=Buffer.from('%PDF-1.7\nexample');
  await db.put('patients',entity('clinic',{name:'Patient A',branchId:'main'},'patient-a'));await db.put('patients',entity('clinic',{name:'Patient B',branchId:'north'},'patient-b'));
  const receptionist:Actor={...owner,id:'reception',roles:['receptionist']};
  await expect(storage.upload({bytes:pdf,mime:'application/pdf',name:'a.pdf',patientId:'patient-a',scope:'personal'},doctor)).rejects.toMatchObject({code:'FILE_SCOPE'});
  await expect(storage.upload({bytes:pdf,mime:'application/pdf',name:'a.pdf',patientId:'patient-a',scope:'payroll'},owner)).rejects.toMatchObject({code:'FILE_SCOPE'});
  await expect(storage.upload({bytes:pdf,mime:'application/pdf',name:'a.pdf',patientId:'patient-b',scope:'conversation'},receptionist)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(storage.upload({bytes:pdf,mime:'application/pdf',name:'a.pdf',patientId:'patient-b',scope:'conversation'},patient)).rejects.toMatchObject({code:'FORBIDDEN'});
  await expect(storage.upload({bytes:pdf,mime:'application/pdf',name:'a.pdf',patientId:'missing',scope:'conversation'},receptionist)).rejects.toMatchObject({code:'NOT_FOUND'});
  expect((await storage.upload({bytes:pdf,mime:'application/pdf',name:'a.pdf',patientId:'patient-a',scope:'conversation'},receptionist)).patientId).toBe('patient-a');
  expect((await storage.upload({bytes:pdf,mime:'application/pdf',name:'a.pdf',patientId:'patient-a',scope:'conversation'},patient)).patientId).toBe('patient-a');
 });
 it('reports scanner infrastructure failure separately from a malware verdict, failing closed either way',async()=>{
  const dir=await directory(),stub=async(name:string,code:number)=>{const path=join(dir,name);await writeFile(path,`#!/bin/sh\nexit ${code}\n`,{mode:0o755});return path;};
  const scan=(command:string)=>new LocalFileStorage(new MemoryDatabase(),{root:dir,scanner:new ClamAvScanner(command)}).upload({bytes:Buffer.from('%PDF-1.7\nexample'),mime:'application/pdf',name:'a.pdf'},owner);
  await expect(scan(await stub('infected',1))).rejects.toMatchObject({code:'FILE_SCAN_FAILED',status:422});
  await expect(scan(await stub('daemon-error',2))).rejects.toMatchObject({code:'SCANNER_UNAVAILABLE',status:503});
  await expect(scan(join(dir,'not-installed'))).rejects.toMatchObject({code:'SCANNER_UNAVAILABLE',status:503});
  expect((await scan(await stub('clean',0))).scanStatus).toBe('clean');
 });
});

describe('bounded render admission',()=>{
 it('queues a bounded number of waiters in order and refuses, times out or cancels the rest',async()=>{
  const admission=createAdmission(1,2,100),order:string[]=[];
  const first=(await admission.acquire())!;expect(admission.active).toBe(1);
  const second=admission.acquire().then(release=>{order.push('second');return release;}),third=admission.acquire().then(release=>{order.push('third');return release;});
  expect(admission.canQueue()).toBe(false);expect(await admission.acquire()).toBeNull();
  first();first();const secondRelease=(await second)!;expect(order).toEqual(['second']);secondRelease();(await third)!();expect(order).toEqual(['second','third']);expect(admission.active).toBe(0);
  const holder=(await admission.acquire())!;const started=Date.now();expect(await admission.acquire()).toBeNull();expect(Date.now()-started).toBeGreaterThanOrEqual(90);
  const controller=new AbortController(),cancelled=admission.acquire(controller.signal);controller.abort();expect(await cancelled).toBeNull();expect(admission.waiting).toBe(0);
  holder();expect(admission.active).toBe(0);
 });
});

describe('sitemap and custom schema policy',()=>{
 const site={url:'https://clinic.example',name:'Care clinic',description:'Local care'};
 it('skips and reports an invalid page instead of failing the whole sitemap',()=>{
  const pages=[{id:'care',slug:'care',title:'Care',status:'published'},{id:'broken',slug:'bad/../path',title:'Broken',status:'published'},{id:'schema',slug:'schema',title:'Schema',status:'published',customSchema:{'@type':'WebPage','@context':'https://evil.example'}}];
  const report=buildSitemapReport(pages,site);expect(report.xml).toContain('https://clinic.example/care');expect(report.skipped).toEqual([{id:'broken',slug:'bad/../path',code:'PAGE_SLUG'},{id:'schema',slug:'schema',code:'SCHEMA_CONTEXT'}]);
  const skipped:unknown[]=[];expect(buildSitemap(pages,site,items=>skipped.push(...items))).toBe(report.xml);expect(skipped).toHaveLength(2);
  expect(()=>buildSitemap(pages,{...site,url:'javascript:alert(1)'})).toThrow();
 });
 it('applies the page-type schema allowlist to custom schema',()=>{
  const product=buildSeo({slug:'about',title:'About',type:'about',customSchema:{'@type':'Product',name:'Miracle cure',aggregateRating:{'@type':'AggregateRating',ratingValue:5}}},site);
  expect(JSON.stringify(product.jsonLd)).not.toContain('Product');expect(JSON.stringify(product.jsonLd)).toContain('AboutPage');expect(product.schemaWarnings).toContain('Custom schema Product is not applicable to this page type');
  const graph=buildSeo({slug:'about',title:'About',type:'about',customSchema:{'@graph':[{'@type':'AboutPage',name:'About us'},{'@type':['Product','AboutPage'],name:'x'},{'@type':'BreadcrumbList',itemListElement:[]}]}},site);
  expect((graph.jsonLd as {'@graph':{'@type':unknown}[]})['@graph'].map(node=>node['@type'])).toEqual(['AboutPage','BreadcrumbList']);expect(graph.jsonLd['@context']).toBe('https://schema.org');
  expect(buildSeo({slug:'about',title:'About',type:'about',customSchema:{'@type':'AboutPage',name:'Custom'}},site).jsonLd).toMatchObject({'@type':'AboutPage',name:'Custom'});
 });
});

describe('AI quota reconciliation',()=>{
 const usage=async(db:MemoryDatabase)=>(await db.list('aiUsage'))[0]?.reservedTokens;
 const reply=(body:unknown,status=200)=>vi.fn(async()=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}}));
 it('settles to provider-reported tokens, refunds failures and falls back to the estimate',async()=>{
  const db=new MemoryDatabase(),service=new AiDraftService(db,{apiKey:'secret',model:'configured-model',allowedClinicalData:true,monthlyTokenLimit:10000});
  vi.stubGlobal('fetch',reply({choices:[{message:{content:'Draft'}}],usage:{total_tokens:42}}));
  const draft=await service.draft('note',{text:'Patient attended.'},doctor);expect(await usage(db)).toBe(42);expect(draft.provenance).toMatchObject({reportedTokens:42,chargedTokens:42});
  vi.stubGlobal('fetch',reply({error:'unavailable'},500));await expect(service.draft('note',{text:'Patient attended.'},doctor)).rejects.toMatchObject({code:'AI_PROVIDER_FAILED'});expect(await usage(db)).toBe(42);
  vi.stubGlobal('fetch',vi.fn(async()=>{throw new TypeError('network down');}));await expect(service.draft('note',{text:'Patient attended.'},doctor)).rejects.toThrow('network down');expect(await usage(db)).toBe(42);
  vi.stubGlobal('fetch',reply({choices:[{message:{content:'Draft'}}]}));await service.draft('note',{text:'Patient attended.'},doctor);expect(await usage(db)).toBe(42+Buffer.byteLength('Patient attended.')+2800);
  vi.stubGlobal('fetch',reply({choices:[{message:{content:''}}],usage:{total_tokens:7}}));await expect(service.draft('note',{text:'x'},doctor)).rejects.toMatchObject({code:'AI_RESPONSE'});expect(await usage(db)).toBe(42+Buffer.byteLength('Patient attended.')+2800+7);
 });
});
