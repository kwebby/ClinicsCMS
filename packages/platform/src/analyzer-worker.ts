/* Author: ramanpal singh | URL: https://kwebby.com */
import { createServer } from 'node:http';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { dirname } from 'node:path';
import { analyzePublicWebsiteLocal } from './tools.js';
import { DomainError } from '../../contracts/src/index.js';
const socketPath=process.env.ANALYZER_SOCKET??'/run/clinic-analyzer/analyzer.sock';
await mkdir(dirname(socketPath),{recursive:true,mode:0o700});await rm(socketPath,{force:true});
let inflight=0;
const server=createServer(async(req,res)=>{
 if(req.method!=='POST'||req.url!=='/analyze'){res.writeHead(404).end();return;}
 if(inflight>=2){res.writeHead(503).end();return;}inflight++;
 try{let size=0;const chunks:Buffer[]=[];for await(const part of req){size+=part.length;if(size>4096)throw new DomainError('REQUEST_SIZE','Request exceeds analyzer budget',413);chunks.push(part);}const payload=JSON.parse(Buffer.concat(chunks).toString('utf8'));const result=await analyzePublicWebsiteLocal(payload.url);res.writeHead(200,{'Content-Type':'application/json','Cache-Control':'no-store'}).end(JSON.stringify(result));}
 catch(error){res.writeHead(error instanceof DomainError?error.status:502,{'Content-Type':'application/json'}).end(JSON.stringify({error:'Website could not be analyzed'}));}
 finally{inflight--;}
});
server.requestTimeout=40000;server.headersTimeout=5000;server.listen(socketPath,()=>{void chmod(socketPath,0o600);});
for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{void rm(socketPath,{force:true}).finally(()=>process.exit(0));}));
