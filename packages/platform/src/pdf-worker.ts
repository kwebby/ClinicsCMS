/* Author: ramanpal singh | URL: https://kwebby.com */
import { createServer } from 'node:http';
import { mkdir, chmod, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { renderFinancialPdfLocal } from './pdf.js';
import { DomainError } from '../../contracts/src/index.js';
const socketPath=process.env.PDF_RENDERER_SOCKET??'/run/clinic-pdf/renderer.sock';
await mkdir(dirname(socketPath),{recursive:true,mode:0o700});await rm(socketPath,{force:true});
let busy=false;
const server=createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/render'){res.writeHead(404).end();return;}
 if(busy){res.writeHead(503).end();return;}
 busy=true;
 try{let size=0;const chunks:Buffer[]=[];for await(const part of req){size+=part.length;if(size>1024*1024)throw new DomainError('DOCUMENT_SIZE','Request too large',413);chunks.push(part);}const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));const pdf=await renderFinancialPdfLocal(payload.document,payload.template);res.writeHead(200,{'Content-Type':'application/pdf','Cache-Control':'no-store'}).end(pdf);}
 catch(error){res.writeHead(error instanceof DomainError?error.status:500,{'Content-Type':'application/json'}).end(JSON.stringify({error:'PDF rendering failed'}));}
 finally{busy=false;}
});
server.requestTimeout=35000;server.headersTimeout=10000;server.listen(socketPath,()=>{void chmod(socketPath,0o600);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{void rm(socketPath,{force:true}).finally(()=>process.exit(0));}));
