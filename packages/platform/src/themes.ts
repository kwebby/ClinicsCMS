/* Author: ramanpal singh | URL: https://kwebby.com */
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, open, rename, rm } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import yauzl from 'yauzl';
import yazl from 'yazl';
import sharp from 'sharp';
import { z } from 'zod';
import { validLocationSlug } from '../../contracts/src/website.js';
import { Actor, Database, Entity, assert } from '../../contracts/src/index.js';
import { entity, id, inOrganization, requireRoles } from './common.js';
import { ClamAvScanner, MalwareScanner, detectMime, privateRead, scanBuffer, segment } from './files.js';

export const THEME_LIMITS = {compressedBytes:25*1024*1024, expandedBytes:100*1024*1024, entries:1000, fileBytes:20*1024*1024, ratio:100};
const color = z.string().regex(/^#[0-9a-fA-F]{6}$/);
const slug = z.string().regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).max(80);
const layout = z.object({id:slug, type:z.enum(['hero','services','doctors','article','faq','contact','tool','testimonials','cta','footer']), variant:z.enum(['default','split','centered','compact']).default('default'), heading:z.string().max(160).optional(), text:z.string().max(2000).optional(), image:z.string().regex(/^assets\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp)$/).optional()}).strict();
export const themeManifestSchema = z.object({
 formatVersion:z.literal(1), name:z.string().min(1).max(100), slug, version:z.string().regex(/^\d+\.\d+\.\d+$/), description:z.string().max(500).default(''), author:z.string().max(120).default(''), license:z.string().min(1).max(120),
 tokens:z.object({primary:color,secondary:color,background:color,text:color,muted:color,radius:z.number().min(0).max(32),fontFamily:z.enum(['system','sans','serif']),baseFontSize:z.number().int().min(14).max(22),maxWidth:z.number().int().min(960).max(1600)}).strict(),
 layouts:z.record(z.enum(['home','page','article','service','doctor','contact','tool']),z.array(layout).max(40)),
 navigation:z.array(z.object({label:z.string().min(1).max(60),href:z.string().regex(/^\/(?!\/)[A-Za-z0-9/_-]*$/)}).strict()).max(20).default([]),
 preview:z.string().regex(/^assets\/[A-Za-z0-9_./-]+\.(png|jpe?g|webp)$/).optional()
}).strict();
export type ThemeManifest = z.infer<typeof themeManifestSchema>;
export interface ValidatedTheme {manifest:ThemeManifest;files:Map<string,Buffer>;sha256:string;}
function validArchivePath(name:string) {
 assert(name.length<=200 && !name.includes('\\') && !name.includes('\0') && !name.startsWith('/') && !name.split('/').some(part=>part==='..'||part==='.'||part===''), 'THEME_PATH','Invalid archive path');
 assert(name==='theme.json'||/^assets\/[A-Za-z0-9_/-]+\.(png|jpg|jpeg|webp|woff2)$/.test(name), 'THEME_FILE','Theme contains an unsupported file');
}
export async function validateThemeZip(bytes:Buffer, scanner:MalwareScanner=new ClamAvScanner()):Promise<ValidatedTheme> {
 assert(bytes.length>0 && bytes.length<=THEME_LIMITS.compressedBytes,'THEME_SIZE','Theme ZIP exceeds the 25 MiB limit');
 await scanBuffer(bytes,scanner);
 const files = new Map<string,Buffer>(); let total=0,count=0;
 await new Promise<void>((accept,reject)=> {
  yauzl.fromBuffer(bytes,{lazyEntries:true,validateEntrySizes:true,decodeStrings:true},(error,zip)=> {
   if(error||!zip) {reject(error??new Error('Invalid ZIP'));return;}
   let failed=false;
   const fail=(cause:unknown)=>{if(failed)return;failed=true;zip.close();reject(cause);};
   zip.on('error',fail); zip.on('end',()=>{if(!failed)accept();});
   zip.on('entry',(entry:yauzl.Entry)=>{ void (async()=>{
    assert(++count<=THEME_LIMITS.entries,'THEME_ENTRIES','Too many archive entries');
    const mode=(entry.externalFileAttributes>>>16)&0xffff;
    assert((mode&0o170000)!==0o120000,'THEME_SYMLINK','Theme links are forbidden');
    assert((entry.generalPurposeBitFlag&1)===0,'THEME_ENCRYPTED','Encrypted archives are forbidden');
    if(entry.fileName.endsWith('/')) {const directory=entry.fileName.slice(0,-1); assert(/^assets(?:\/[A-Za-z0-9_-]+)*$/.test(directory),'THEME_PATH','Invalid theme directory');zip.readEntry();return;}
    validArchivePath(entry.fileName);
    assert(!files.has(entry.fileName),'THEME_DUPLICATE','Duplicate archive path');
    assert(entry.uncompressedSize<=THEME_LIMITS.fileBytes && entry.uncompressedSize/(entry.compressedSize||1)<=THEME_LIMITS.ratio,'THEME_BOMB','Unsafe archive compression ratio or entry size');
    total+=entry.uncompressedSize;assert(total<=THEME_LIMITS.expandedBytes,'THEME_BOMB','Expanded ZIP exceeds 100 MiB');
    const stream=await new Promise<Readable>((res,rej)=>zip.openReadStream(entry,(err,data)=>err||!data?rej(err):res(data)));
    const chunks:Buffer[]=[];let size=0;
    for await (const chunk of stream) {size+=chunk.length;assert(size<=entry.uncompressedSize && size<=THEME_LIMITS.fileBytes,'THEME_BOMB','Entry exceeds declared size');chunks.push(chunk);}
    assert(size===entry.uncompressedSize,'THEME_SIZE','Archive entry size mismatch');files.set(entry.fileName,Buffer.concat(chunks));zip.readEntry();
   })().catch(fail); });
   zip.readEntry();
  });
 });
 const raw=files.get('theme.json');assert(raw && raw.length<=128*1024,'THEME_MANIFEST','A theme.json manifest under 128 KiB is required');
 let parsed:unknown;try{parsed=JSON.parse(raw.toString('utf8'));}catch{assert(false,'THEME_MANIFEST','Invalid theme JSON');}
 const result=themeManifestSchema.safeParse(parsed);assert(result.success,'THEME_MANIFEST','Theme manifest is not valid');
 for(const [name,contents] of files) {
  if(name==='theme.json')continue;
  const mime=detectMime(contents);
  const expected=name.endsWith('.woff2')?'font/woff2':name.endsWith('.png')?'image/png':name.endsWith('.webp')?'image/webp':'image/jpeg';
  assert(mime===expected,'THEME_ASSET','Theme asset content does not match its extension');
  if(mime?.startsWith('image/')) {let metadata:{width?:number;height?:number};try{metadata=await sharp(contents,{limitInputPixels:40_000_000}).metadata();}catch{assert(false,'THEME_IMAGE','Invalid theme image');}assert(metadata.width&&metadata.height&&metadata.width*metadata.height<=40_000_000,'THEME_IMAGE','Theme image exceeds pixel budget');}
 }
 const manifest=result.data;
 for(const blocks of Object.values(manifest.layouts))for(const block of blocks??[])if(block.image)assert(files.has(block.image),'THEME_ASSET','Referenced image is missing');
 if(manifest.preview)assert(files.has(manifest.preview),'THEME_ASSET','Preview image is missing');
 return {manifest,files,sha256:createHash('sha256').update(bytes).digest('hex')};
}
export function bootstrapTheme():ThemeManifest {return themeManifestSchema.parse({formatVersion:1,name:'Careline',slug:'careline',version:'1.0.0',description:'A calm, accessible clinic website',author:'ClinicsCMS',license:'MIT',tokens:{primary:'#18756B',secondary:'#D1E9E3',background:'#FAFBF8',text:'#172B29',muted:'#586E69',radius:16,fontFamily:'sans',baseFontSize:16,maxWidth:1200},layouts:{home:[{id:'welcome',type:'hero',variant:'split',heading:'Care that fits your life'},{id:'care',type:'services'},{id:'team',type:'doctors'},{id:'visit',type:'contact'},{id:'footer',type:'footer'}],page:[{id:'content',type:'article'}],article:[],service:[],doctor:[],contact:[],tool:[]},navigation:[{label:'Our care',href:'/services'},{label:'Doctors',href:'/doctors'},{label:'Plan your visit',href:'/contact'}]});}
export class ThemeService {
 private readonly root:string;private readonly scanner:MalwareScanner;
 constructor(private readonly db:Database,options:{root:string;scanner?:MalwareScanner}) {this.root=resolve(options.root);this.scanner=options.scanner??new ClamAvScanner();}
 async importZip(bytes:Buffer,actor:Actor) {
  requireRoles(actor,['owner','admin','editor']);
  const validated=await validateThemeZip(bytes,this.scanner),themeId=id(),base=join(this.root,'themes',segment(actor.organizationId));
  await mkdir(base,{recursive:true,mode:0o700});const temporary=await mkdtemp(join(base,'.quarantine-'));
  try {
   for(const [name,data] of validated.files) {const path=join(temporary,name);await mkdir(join(path,'..'),{recursive:true,mode:0o700});const handle=await open(path,'wx',0o600);try{await handle.writeFile(data);}finally{await handle.close();}}
   await rename(temporary,join(base,themeId));
   const record=entity(actor.organizationId,{manifest:validated.manifest,sha256:validated.sha256,scanStatus:'clean',status:'validated',uploadedBy:actor.id,assets:[...validated.files].filter(([name])=>name!=='theme.json').map(([path,bytes])=>({path,mime:detectMime(bytes),size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')}))},themeId);
   try{return await this.db.put('themes',record);}catch(error){await rm(join(base,themeId),{recursive:true,force:true});throw error;}
  }finally{await rm(temporary,{recursive:true,force:true});}
 }
 async preview(themeId:string,actor:Actor) {requireRoles(actor,['owner','admin','editor']);const record=await this.db.get('themes',themeId);inOrganization(record,actor);return record;}
 async exportZip(themeId:string,actor:Actor):Promise<Buffer> {
  const record=await this.preview(themeId,actor),archive=new yazl.ZipFile();
  archive.addBuffer(Buffer.from(JSON.stringify(record.manifest,null,2)),'theme.json');
  for(const asset of record.assets as {path:string;sha256:string}[]) {const data=await privateRead(join(this.root,'themes',segment(actor.organizationId),segment(themeId),asset.path));assert(createHash('sha256').update(data).digest('hex')===asset.sha256,'THEME_INTEGRITY','Theme asset failed integrity check',500);archive.addBuffer(data,asset.path);}
  archive.end();const chunks:Buffer[]=[];for await(const chunk of archive.outputStream)chunks.push(Buffer.isBuffer(chunk)?chunk:Buffer.from(chunk));return Buffer.concat(chunks);
 }
 async activate(themeId:string,actor:Actor,expectedPublicationId?:string) {
  requireRoles(actor,['owner','admin','editor']);const theme=await this.preview(themeId,actor);
  assert(theme.scanStatus==='clean'&&theme.status==='validated','THEME_INVALID','Theme has not passed validation');
  const publicationId=id(),directory=join(this.root,'publications',segment(actor.organizationId),publicationId);
  await mkdir(directory,{recursive:true,mode:0o700});
  try{return await this.db.transaction([`site-publication:${actor.organizationId}`,`${actor.organizationId}:pages`,`${actor.organizationId}:settings`],async tx=> {
   const pointerId=`site-publication:${actor.organizationId}`,pointer=await tx.get('settings',pointerId);
   if(expectedPublicationId!==undefined)assert((pointer?.publicationId??'')===expectedPublicationId,'VERSION_CONFLICT','Website publication changed; refresh before publishing',409);
   const settings=await tx.list('settings',{eq:{organizationId:actor.organizationId},limit:1000});
   const pages=await tx.list('pages',{eq:{organizationId:actor.organizationId},limit:1000});
   const contentSnapshots:{id:string;version:number;path:string;sha256:string}[]=[];
   for(const page of pages){
    if(!page.publishedSnapshot||page.status==='archived')continue;
    const snapshot=page.publishedSnapshot as Record<string,unknown>;
    const allowed=['id','version','title','slug','kind','locale','content','seo','citations','publishedAt','renderVersion','reviewedBy','reviewedAt','reviewer','branchId'];
    const safe=Object.fromEntries(allowed.filter(key=>snapshot[key]!==undefined).map(key=>[key,snapshot[key]]));
    const bytes=Buffer.from(JSON.stringify(safe));assert(bytes.length<=1024*1024,'PUBLICATION_SIZE','Published page exceeds the one MiB snapshot budget');
    const filename=`${segment(page.id)}.json`,temporary=join(directory,`${id()}.tmp`);
    const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(bytes);}finally{await handle.close();}await rename(temporary,join(directory,filename));
    contentSnapshots.push({id:page.id,version:Number(snapshot.version??page.publishedVersion??page.version),path:filename,sha256:createHash('sha256').update(bytes).digest('hex')});
   }
   const business=(settings.find(row=>row.key==='business'||row.id==='business')?.value??{}) as Record<string,unknown>;
   const website=(settings.find(row=>row.key==='website'||row.id==='website')?.value??{}) as Record<string,unknown>;
   const locationSlugs=new Set(((website.locations??[]) as {slug:string}[]).map(location=>location.slug));
   for(const slug of locationSlugs)assert(validLocationSlug(slug),'SLUG_CONFLICT','Location URL conflicts with an application route',409);
   for(const page of pages)assert(!locationSlugs.has(String(page.slug)),'SLUG_CONFLICT','Location URL conflicts with a CMS page',409);
   for(const route of await tx.list('pageRoutes',{eq:{organizationId:actor.organizationId},limit:1000}))assert(!locationSlugs.has(String(route.slug)),'SLUG_CONFLICT','Location URL conflicts with a permanent page route',409);
   const publicBusiness=Object.fromEntries(['clinicName','name','country','currency','timezone','locale','address','email','phone','website','publicBooking','logoFileId'].filter(key=>business[key]!==undefined).map(key=>[key,business[key]]));
   const publicWebsite=Object.fromEntries(['siteName','origin','description','locale','socialImage','socialImageAlt','socialHandles','searchConsoleVerification','navigation','homepage','branding','locations','header','footer'].filter(key=>website[key]!==undefined).map(key=>[key,website[key]]));
   const publication=entity(actor.organizationId,{kind:'site',themeId,manifest:theme.manifest,settingsRevisions:settings.filter(row=>['business','website'].includes(String(row.key??row.id))).map(row=>({id:row.id,version:row.version})),publicSettings:{business:publicBusiness,website:publicWebsite},contentSnapshots,publishedBy:actor.id,previousPublicationId:pointer?.publicationId??null},publicationId);
   await tx.put('publications',publication);
   const next=pointer?{...pointer,publicationId:publication.id,version:pointer.version+1,updatedAt:new Date().toISOString()}:entity(actor.organizationId,{publicationId:publication.id},pointerId);
   await tx.put('settings',next,pointer?.version);return publication;
  });}catch(error){await rm(directory,{recursive:true,force:true});throw error;}
 }
 async rollback(actor:Actor,expectedPublicationId?:string) {
  requireRoles(actor,['owner','admin','editor']);
  return this.db.transaction([`site-publication:${actor.organizationId}`],async tx=> {
   const pointer=await tx.get('settings',`site-publication:${actor.organizationId}`);assert(pointer,'NO_PUBLICATION','No publication to roll back');
   if(expectedPublicationId!==undefined)assert(pointer.publicationId===expectedPublicationId,'VERSION_CONFLICT','Website publication changed',409);
   const current=await tx.get('publications',String(pointer.publicationId));assert(current?.previousPublicationId,'NO_PREVIOUS_PUBLICATION','No previous publication to restore');
   const previous=await tx.get('publications',String(current.previousPublicationId));assert(previous&&previous.organizationId===actor.organizationId,'NOT_FOUND','Previous publication not found',404);
   await tx.put('settings',{...pointer,publicationId:previous.id,version:pointer.version+1,updatedAt:new Date().toISOString()},pointer.version);return previous;
  });
 }
 async publicSite(organizationId:string) {
  const pointer=await this.db.get('settings',`site-publication:${organizationId}`);
  if(!pointer)return {manifest:bootstrapTheme(),publicationId:null,pages:null,settings:null};
  const publication=await this.db.get('publications',String(pointer.publicationId));assert(publication?.organizationId===organizationId,'PUBLICATION_MISSING','Website publication unavailable',503);
  const pages:Record<string,unknown>[]=[];
  for(const snapshot of (publication.contentSnapshots??[]) as {id:string;path:string;sha256:string}[]){
   assert(snapshot.path===`${segment(snapshot.id)}.json`,'PUBLICATION_INTEGRITY','Invalid publication snapshot path',500);
   const bytes=await privateRead(join(this.root,'publications',segment(organizationId),segment(publication.id),snapshot.path));
   assert(createHash('sha256').update(bytes).digest('hex')===snapshot.sha256,'PUBLICATION_INTEGRITY','Publication snapshot failed integrity check',500);pages.push(JSON.parse(bytes.toString('utf8')));
  }
  return {manifest:publication.manifest,publicationId:publication.id,themeId:publication.themeId,pages,settings:publication.publicSettings as {business:Record<string,unknown>;website:Record<string,unknown>}};
 }
 async asset(themeId:string,path:string,organizationId:string,actor?:Actor) {
  validArchivePath(path);assert(path!=='theme.json','NOT_FOUND','Asset not found',404);
  const theme=await this.db.get('themes',themeId);assert(theme?.organizationId===organizationId,'NOT_FOUND','Asset not found',404);
  if(actor){inOrganization(theme,actor);requireRoles(actor,['owner','admin','editor']);}else{const site=await this.publicSite(organizationId);assert('themeId' in site&&site.themeId===themeId,'NOT_FOUND','Asset not published',404);}
  const asset=(theme.assets as {path:string;mime:string;sha256:string}[]).find(asset=>asset.path===path);assert(asset,'NOT_FOUND','Asset not found',404);
  const bytes=await privateRead(join(this.root,'themes',segment(organizationId),segment(themeId),path));assert(createHash('sha256').update(bytes).digest('hex')===asset.sha256,'THEME_INTEGRITY','Asset failed integrity check',500);return{bytes,mime:asset.mime};
 }
}
