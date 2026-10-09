/* Author: ramanpal singh | URL: https://kwebby.com */
import { createServer } from 'node:http';
import { mkdir, chmod, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderFinancialPdfLocal } from './pdf.js';
import { DomainError } from '../../contracts/src/index.js';
import { boundedIntegerSetting, createAdmission } from './common.js';
const socketPath=process.env.PDF_RENDERER_SOCKET??'/run/clinic-pdf/renderer.sock';
await mkdir(dirname(socketPath),{recursive:true,mode:0o700});await rm(socketPath,{force:true});
// One Chromium render at a time; a short bounded queue absorbs bursts before callers see 503.
const admission=createAdmission(1,boundedIntegerSetting('PDF_RENDER_QUEUE_SIZE',4,0,32),boundedIntegerSetting('PDF_RENDER_QUEUE_TIMEOUT_MS',10000,100,30000));
const busy=(res:import('node:http').ServerResponse)=>res.writeHead(503,{'Content-Type':'application/json','Retry-After':'5'}).end(JSON.stringify({error:'PDF renderer is busy'}));
const server=createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/render'){res.writeHead(404).end();return;}
 if(!admission.canQueue()){busy(res);return;}
 let release:(()=>void)|null=null;const disconnected=new AbortController();res.on('close',()=>disconnected.abort());
 try{let size=0;const chunks:Buffer[]=[];for await(const part of req){size+=part.length;if(size>1024*1024)throw new DomainError('DOCUMENT_SIZE','Request too large',413);chunks.push(part);}const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));
  release=await admission.acquire(disconnected.signal);if(!release){if(!res.headersSent&&!disconnected.signal.aborted)busy(res);return;}
  const pdf=await renderFinancialPdfLocal(payload.document,payload.template);res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'}).end(pdf);}
 catch(error){res.writeHead(error instanceof DomainError?error.status:500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'PDF rendering failed'}));}
 finally{release?.();}
});
server.requestTimeout=35000;server.headersTimeout=10000;server.listen(socketPath,()=>{void chmod(socketPath,0o600);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{void rm(socketPath,{force:true}).finally(()=>process.exit(0));}));
