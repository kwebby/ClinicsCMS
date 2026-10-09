/* Author: ramanpal singh | URL: https://kwebby.com */
import { mkdir, open, rm } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve } from 'node:path';
import sharp from 'sharp';
import { Actor, Database, assert } from '../../contracts/src/index.js';
import { entity, id, requireRoles } from './common.js';
import { ClamAvScanner, MalwareScanner, detectMime, privateRead, scanBuffer, segment } from './files.js';

/** Explicit public-media upload; deliberately has no API for promoting a private or clinical file. */
export class PublicAssetService {
 private readonly root:string;private readonly scanner:MalwareScanner;
 constructor(private readonly db:Database,options:{root:string;scanner?:MalwareScanner}){this.root=resolve(options.root);this.scanner=options.scanner??new ClamAvScanner();}
 async upload(input:{bytes:Buffer;mime:string;alt:string},actor:Actor){
  requireRoles(actor,['owner','admin','editor']);
  assert(input.bytes.length>0&&input.bytes.length<=10*1024*1024,'ASSET_SIZE','Public image must be between 1 byte and 10 MiB');
  assert(typeof input.alt==='string'&&input.alt.trim().length>0&&input.alt.length<=300,'ASSET_ALT','Provide an image description of up to 300 characters');
  const mime=detectMime(input.bytes);assert(mime&&['image/png','image/jpeg','image/webp'].includes(mime)&&mime===input.mime,'ASSET_TYPE','Only matching PNG, JPEG, and WebP public images are accepted');
  await scanBuffer(input.bytes,this.scanner);
  let bytes:Buffer,width:number,height:number;
  try{
   const image=sharp(input.bytes,{limitInputPixels:40_000_000,animated:false}),metadata=await image.metadata();
   assert(metadata.width&&metadata.height&&(!metadata.pages||metadata.pages===1),'ASSET_IMAGE','Use a single-frame public image');
   const output=await image.rotate().resize({width:2400,height:2400,fit:'inside',withoutEnlargement:true}).webp({quality:85}).toBuffer({resolveWithObject:true});bytes=output.data;width=output.info.width;height=output.info.height;
  }catch(error){if(error instanceof Error&&error.name==='DomainError')throw error;assert(false,'ASSET_IMAGE','Image could not be safely decoded');}
  // Re-encoding removes EXIF/location metadata, appended payloads and untrusted image container structures.
  const assetId=id(),directory=join(this.root,'public-assets',segment(actor.organizationId));await mkdir(directory,{recursive:true,mode:0o700});
  const path=join(directory,assetId),handle=await open(path,'wx',0o600);try{await handle.writeFile(bytes);}finally{await handle.close();}
  const record=entity(actor.organizationId,{mime:'image/webp',size:bytes.length,width,height,alt:input.alt.trim(),sha256:createHash('sha256').update(bytes).digest('hex'),status:'published',uploadedBy:actor.id,url:`/api/v1/public/assets/${assetId}`},assetId);
  try{await this.db.put('publicAssets',record);}catch(error){await rm(path,{force:true});throw error;}
  return {id:record.id,url:record.url,mime:record.mime,width,height,alt:record.alt};
 }
 async logoDataUri(assetId:string,organizationId:string):Promise<string>{
  const asset=await this.read(assetId,organizationId);
  const bytes=await sharp(asset.bytes,{limitInputPixels:40_000_000}).resize({width:320,height:160,fit:'inside',withoutEnlargement:true}).webp({quality:80}).toBuffer();
  assert(bytes.length<=128*1024,'LOGO_SIZE','Logo exceeds the financial-document image budget');return `data:image/webp;base64,${bytes.toString('base64')}`;
 }
 async read(assetId:string,organizationId:string){
  const record=await this.db.get('publicAssets',assetId);assert(record&&record.organizationId===organizationId&&record.status==='published','NOT_FOUND','Public image not found',404);
  const bytes=await privateRead(join(this.root,'public-assets',segment(organizationId),segment(record.id)));assert(createHash('sha256').update(bytes).digest('hex')===record.sha256,'ASSET_INTEGRITY','Public image failed integrity verification',500);
  return {bytes,mime:'image/webp',sha256:record.sha256,alt:record.alt,width:record.width,height:record.height};
 }
}
