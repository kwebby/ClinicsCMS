/* Author: ramanpal singh | URL: https://kwebby.com */
import 'dotenv/config';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Queue,Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createDatabase } from '../../../packages/persistence/src/index.js';
import { IntegrationService } from '../../api/src/integrations.js';
import { Secrets } from '../../api/src/security.js';
import { OutboxProcessor } from './processor.js';
import { ClinicScheduler,allRecords } from './scheduler.js';
if(process.env.MAINTENANCE_MODE==='true')throw new Error('Worker startup blocked during maintenance');
try{await access(join(process.env.PRIVATE_STORAGE_ROOT??'.runtime/files','.restore-incomplete'));throw new Error('Worker startup blocked: data restore is incomplete');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const db=createDatabase();await db.initialize();
const connection=new Redis(process.env.REDIS_URL??'redis://127.0.0.1:6379',{maxRetriesPerRequest:null});
const queue=new Queue('clinic-outbox',{connection:connection as any,prefix:process.env.INSTALLATION_ID??'local'});
const processor=new OutboxProcessor(db,new IntegrationService(db,new Secrets()),connection);
const worker=new Worker('clinic-outbox',async job=>processor.process(String(job.data.id)),{connection:connection as any,prefix:process.env.INSTALLATION_ID??'local',concurrency:4,autorun:false});
worker.on('failed',job=>console.error(JSON.stringify({event:'job.failed',id:job?.id})));worker.on('error',()=>console.error(JSON.stringify({event:'worker.connection-error'})));
if(process.env.OUTBOUND_WORKERS_ENABLED==='true')void worker.run().catch(()=>console.error(JSON.stringify({event:'worker.run-failed'})));
const scheduler=new ClinicScheduler(db,process.env.ORGANIZATION_ID??'clinic');
let stopped=false,polling=false,lastSchedule=0;
async function dispatch(){if(stopped||polling||process.env.OUTBOUND_WORKERS_ENABLED!=='true')return;polling=true;try{if(Date.now()-lastSchedule>=60000){await scheduler.tick();lastSchedule=Date.now();}const rows=await allRecords(db,'outbox',{organizationId:process.env.ORGANIZATION_ID??'clinic'});for(const row of rows){if((row.status==='pending'&&Date.parse(String(row.nextAttemptAt))<=Date.now())||(row.status==='processing'&&Date.parse(String(row.leaseUntil))<Date.now()))await queue.add('deliver',{id:row.id},{jobId:row.id,removeOnComplete:true,removeOnFail:true});}}catch{console.error(JSON.stringify({event:'outbox.dispatch-failed'}));}finally{polling=false;}}
const timer=setInterval(()=>void dispatch(),5000);await dispatch();console.log(`ClinicsCMS worker started; outbound ${process.env.OUTBOUND_WORKERS_ENABLED==='true'?'enabled':'disabled'}`);
async function stop(){stopped=true;clearInterval(timer);await worker.close();await queue.close();await connection.quit();await db.close();process.exit(0);}process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
