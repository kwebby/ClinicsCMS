/* Author: ramanpal singh | URL: https://kwebby.com */
import { performance } from 'node:perf_hooks';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

const args=process.argv.slice(2);
function option(name:string,fallback:string){const index=args.indexOf(name);if(index<0)return fallback;if(!args[index+1]||args[index+1].startsWith('--'))throw new Error(`${name} needs a value`);return args[index+1];}
const target=new URL(option('--url','http://127.0.0.1:4000/api/v1/health'));
if(!['127.0.0.1','[::1]'].includes(target.hostname)||!['http:','https:'].includes(target.protocol)||target.username||target.password||target.search||target.hash||target.pathname!=='/api/v1/health')throw new Error('This smoke load script only permits a literal loopback /api/v1/health URL without credentials or query parameters');
const requests=Number(option('--requests','100')),concurrency=Number(option('--concurrency','5'));
if(!Number.isInteger(requests)||requests<1||requests>1000||!Number.isInteger(concurrency)||concurrency<1||concurrency>10)throw new Error('Use 1–1000 requests and concurrency 1–10');
const destination=resolve(option('--output','.runtime/security/http-load.json'));
const latencies:number[]=[],statuses:Record<string,number>={};let cursor=0,failures=0;
const started=new Date().toISOString(),start=performance.now();
async function run(){while(cursor<requests){cursor++;const began=performance.now();try{const response=await fetch(target,{redirect:'error',signal:AbortSignal.timeout(5000),headers:{Accept:'application/json'}});statuses[String(response.status)]=(statuses[String(response.status)]??0)+1;const bytes=await response.arrayBuffer();if(bytes.byteLength>16384||!response.ok)failures++;}catch{statuses.networkError=(statuses.networkError??0)+1;failures++;}finally{latencies.push(performance.now()-began);}}}
await Promise.all(Array.from({length:concurrency},run));
const elapsed=performance.now()-start,ordered=[...latencies].sort((a,b)=>a-b),round=(n:number)=>Math.round(n*100)/100,percentile=(p:number)=>round(ordered[Math.max(0,Math.ceil(ordered.length*p)-1)]??0);
const evidence={kind:'local-loopback-health-smoke',target:target.href,startedAt:started,completedAt:new Date().toISOString(),requests,concurrency,httpStatusCounts:statuses,failures,elapsedMilliseconds:round(elapsed),requestsPerSecond:round(requests*1000/elapsed),latencyMilliseconds:{min:round(ordered[0]??0),mean:round(latencies.reduce((sum,value)=>sum+value,0)/latencies.length),p50:percentile(.5),p95:percentile(.95),p99:percentile(.99),max:round(ordered[ordered.length-1]??0)},limitations:'Single local health endpoint, one host and one small run. This is not production capacity, clinical workflow latency, network/proxy, or security certification.'};
await mkdir(dirname(destination),{recursive:true,mode:0o700});await writeFile(destination,JSON.stringify(evidence,null,2)+'\n',{mode:0o600});console.log(JSON.stringify(evidence,null,2));if(failures)process.exitCode=1;
