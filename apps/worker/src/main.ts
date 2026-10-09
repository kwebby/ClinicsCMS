/* Author: ramanpal singh | URL: https://kwebby.com */
import 'dotenv/config';
import { access } from 'node:fs/promises';
import { join } from 'node:path';
import { Queue,Worker } from 'bullmq';
import { Redis } from 'ioredis';
import { createDatabase } from '../../../packages/persistence/src/index.js';
import { IntegrationService } from '../../api/src/integrations.js';
import { Secrets,installationId,organizationId } from '../../api/src/security.js';
import { OutboxProcessor } from './processor.js';
import { ClinicScheduler } from './scheduler.js';
import { OutboxDispatcher,failureInfo,retentionDays } from './outbox.js';
if(process.env.MAINTENANCE_MODE==='true')throw new Error('Worker startup blocked during maintenance');
try{await access(join(process.env.PRIVATE_STORAGE_ROOT??'.runtime/files','.restore-incomplete'));throw new Error('Worker startup blocked: data restore is incomplete');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
const db=createDatabase();await db.initialize();
const connection=new Redis(process.env.REDIS_URL??'redis://127.0.0.1:6379',{maxRetriesPerRequest:null});
const queue=new Queue('clinic-outbox',{connection:connection as any,prefix:installationId()});
const processor=new OutboxProcessor(db,new IntegrationService(db,new Secrets()),connection);
const log=(event:string,error:unknown,extra:Record<string,unknown>={})=>console.error(JSON.stringify({event,...extra,...failureInfo(error)}));
const worker=new Worker('clinic-outbox',async job=>processor.process(String(job.data.id)),{connection:connection as any,prefix:installationId(),concurrency:4,autorun:false});
worker.on('failed',(job,error)=>log('job.failed',error,{id:job?.id}));worker.on('error',error=>log('worker.connection-error',error));
if(process.env.OUTBOUND_WORKERS_ENABLED==='true')void worker.run().catch(error=>log('worker.run-failed',error));
const scheduler=new ClinicScheduler(db,organizationId());
const dispatcher=new OutboxDispatcher(db,organizationId(),id=>queue.add('deliver',{id},{jobId:id,removeOnComplete:true,removeOnFail:true}),{retentionDays:retentionDays()});
let stopped=false,polling=false,lastSchedule=0;
/** Scheduling, pruning and dispatch fail independently: one failing step never stops the others. */
async function dispatch(){if(stopped||polling||process.env.OUTBOUND_WORKERS_ENABLED!=='true')return;polling=true;try{
 if(Date.now()-lastSchedule>=60000){lastSchedule=Date.now();try{await scheduler.tick();}catch(error){log('scheduler.tick-failed',error);}try{await dispatcher.prune();}catch(error){log('outbox.prune-failed',error);}}
 try{await dispatcher.dispatch();}catch(error){log('outbox.dispatch-failed',error);}
}finally{polling=false;}}
const timer=setInterval(()=>void dispatch(),5000);await dispatch();console.log(`ClinicsCMS worker started; outbound ${process.env.OUTBOUND_WORKERS_ENABLED==='true'?'enabled':'disabled'}`);
async function stop(){stopped=true;clearInterval(timer);await worker.close();await queue.close();await connection.quit();await db.close();process.exit(0);}process.on('SIGTERM',()=>void stop());process.on('SIGINT',()=>void stop());
