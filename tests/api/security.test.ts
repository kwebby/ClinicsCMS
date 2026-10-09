/* Author: ramanpal singh | URL: https://kwebby.com */
import { describe,it,expect,beforeAll,afterAll,vi } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { Redis } from 'ioredis';
import { Secrets,equal,RateLimiter,digest,installationId } from '../../apps/api/src/security.js';
import { enrichOpenApi } from '../../apps/api/src/openapi.js';
import { AuthService } from '../../apps/api/src/auth.js';
import { ClinicGateway,SOCKET_AUTH_TTL_MS } from '../../apps/api/src/gateway.js';
import { MemoryDatabase } from '../../packages/persistence/src/memory.js';
describe('secret boundaries',()=>{
 it('authenticates encrypted settings and rejects tampering',()=>{const s=new Secrets(randomBytes(32).toString('base64'));const encrypted=s.encrypt('synthetic integration secret');expect(encrypted).not.toContain('synthetic');expect(s.decrypt(encrypted)).toBe('synthetic integration secret');const parts=encrypted.split('.');const ciphertext=Buffer.from(parts[2],'base64url');ciphertext[0]^=1;parts[2]=ciphertext.toString('base64url');expect(()=>s.decrypt(parts.join('.'))).toThrow();expect(()=>new Secrets('weak')).toThrow();});
 it('rejects shortened authentication tags and malformed encrypted envelopes',()=>{const s=new Secrets(randomBytes(32).toString('base64'));const encrypted=s.encrypt('settings');const [iv,tag,data]=encrypted.split('.');for(const length of [0,4,8,12,15])expect(()=>s.decrypt([iv,Buffer.from(tag,'base64url').subarray(0,length).toString('base64url'),data].join('.'))).toThrow();expect(()=>s.decrypt(`${encrypted}.extra`)).toThrow();expect(()=>s.decrypt([Buffer.alloc(8).toString('base64url'),tag,data].join('.'))).toThrow();expect(s.decrypt(s.encrypt(''))).toBe('');});
 it('compares variable-byte strings without throwing',()=>{expect(equal('é','aa')).toBe(false);expect(equal('test','test')).toBe(true);expect(equal('test','TEST')).toBe(false);});
});

describe.skipIf(!process.env.REDIS_TEST_URL)('rate limiter windows',()=>{
 let redis:Redis;
 beforeAll(()=>{redis=new Redis(process.env.REDIS_TEST_URL!,{maxRetriesPerRequest:1});});
 afterAll(async()=>{await redis?.quit();});
 it('counts and sets the window expiry atomically, admitting exactly the limit under concurrency',async()=>{
  const prefix=`test:${randomUUID()}:`,limiter=new RateLimiter(redis,prefix);
  const outcomes=await Promise.allSettled(Array.from({length:50},()=>limiter.take('burst',10,60)));
  expect(outcomes.filter(o=>o.status==='fulfilled')).toHaveLength(10);expect(outcomes.filter(o=>o.status==='rejected').every(o=>(o as PromiseRejectedResult).reason.status===429)).toBe(true);
  const key=prefix+digest('burst');const ttl=await redis.ttl(key);expect(ttl).toBeGreaterThan(0);expect(ttl).toBeLessThanOrEqual(60);
 });
 it('repairs a counter left without expiry and checks without counting',async()=>{
  const prefix=`test:${randomUUID()}:`,limiter=new RateLimiter(redis,prefix),key=prefix+digest('stuck');await redis.set(key,'5');expect(await redis.ttl(key)).toBe(-1);
  expect(await limiter.hit('stuck',30)).toBe(6);expect(await redis.ttl(key)).toBeGreaterThan(0);
  await limiter.check('stuck',7);await limiter.check('stuck',7);expect(await limiter.count('stuck')).toBe(6);await expect(limiter.check('stuck',6)).rejects.toMatchObject({status:429});
 });
});
describe('dependency failures and documentation',()=>{
 it('reports a rate-limit backend outage as 503, never as a client rate limit',async()=>{
  const down={eval:async()=>{throw new Error('connection refused');},get:async()=>{throw new Error('connection refused');}} as unknown as Redis;const limiter=new RateLimiter(down);
  await expect(limiter.take('anything',1,60)).rejects.toMatchObject({status:503,code:'RATE_LIMIT_UNAVAILABLE'});await expect(limiter.check('anything',1)).rejects.toMatchObject({status:503});
 });
 it('documents session and CSRF requirements on non-public auth routes',()=>{
  const op=()=>({responses:{}});const paths=Object.fromEntries(['login','register','status','accept-invite','reset-password','consume-token','bootstrap','invite','logout','mfa/begin','mfa/confirm','revoke-sessions','team','team/{id}','session'].map(name=>[`/api/v1/auth/${name}`,name==='team'||name==='session'?{get:op()}:name==='team/{id}'?{patch:op()}:{post:op()}]));
  const spec=enrichOpenApi({openapi:'3.0.0',info:{title:'t',version:'1'},paths} as any) as any;const secured=(path:string)=>{const methods=spec.paths[`/api/v1/auth/${path}`];const operation=methods.get??methods.post??methods.patch;return {session:!!operation.security,csrf:!!operation.parameters?.some((p:any)=>p.name==='X-CSRF-Token')};};
  for(const name of ['login','register','status','accept-invite','reset-password','consume-token','bootstrap'])expect(secured(name)).toEqual({session:false,csrf:false});
  for(const name of ['invite','logout','mfa/begin','mfa/confirm','revoke-sessions','team/{id}'])expect(secured(name)).toEqual({session:true,csrf:true});
  expect(secured('team')).toEqual({session:true,csrf:false});expect(secured('session')).toEqual({session:true,csrf:false});
 });
});
describe('long-lived socket authorization',()=>{
 const user={id:'staff',organizationId:'clinic',version:1,createdAt:'2026-10-09T00:00:00Z',updatedAt:'2026-10-09T00:00:00Z',name:'Staff',email:'staff@example.test',roles:['receptionist'],branchIds:['main'],patientIds:[],status:'active',emailVerified:true,mfaEnabled:true,sessionVersion:1,passwordHash:'x'};
 it('re-checks a session without extending its idle timeout and rejects revoked sessions',async()=>{
  const db=new MemoryDatabase();await db.put('users',user);const raw='raw-session-token';const store=new Map([[`clinic:${installationId()}:sessions:${digest(raw)}`,JSON.stringify({userId:'staff',csrfToken:'c',version:1,expiresAt:Date.now()+3600000,mfaVerified:true})]]);
  const redis={get:vi.fn(async(k:string)=>store.get(k)??null),expire:vi.fn(),del:vi.fn(async(k:string)=>store.delete(k))};const auth=new AuthService(db,redis as any,{} as any);
  expect((await auth.peek(raw))?.id).toBe('staff');expect(redis.expire).not.toHaveBeenCalled();
  await db.put('users',{...user,sessionVersion:2,version:2},1);expect(await auth.peek(raw)).toBeNull();expect(redis.del).toHaveBeenCalled();
 });
 it('reuses a socket authorization briefly, then re-validates and disconnects revoked sockets',async()=>{
  const actor={id:'staff',organizationId:'clinic',roles:['receptionist'],branchIds:['main'],patientIds:[],name:'Staff',email:'staff@example.test'};
  const peek=vi.fn(async()=>actor as any);const conversation={id:'c1',organizationId:'clinic',version:1,createdAt:'',updatedAt:'',participantIds:['staff'],branchId:'main'};
  const db={get:vi.fn(async()=>conversation)};const gateway=new ClinicGateway({auth:{peek},db} as any);
  const socket=(userId:string)=>({data:{userId,auth:{actor:{...actor,id:userId},checkedAt:Date.now()}},handshake:{headers:{cookie:'clinic-session=x'},auth:{}},emit:vi.fn(),disconnect:vi.fn()});
  const sockets=[socket('staff'),socket('other'),socket('staff')];gateway.server={sockets:{sockets:new Map(sockets.map((s,i)=>[String(i),s]))}} as any;
  await gateway.broadcast(JSON.stringify({type:'message.created',payload:{conversationId:'c1'}}));
  expect(db.get).toHaveBeenCalledTimes(1);expect(peek).not.toHaveBeenCalled();expect(sockets[0].emit).toHaveBeenCalledWith('message',{conversationId:'c1'});expect(sockets[1].emit).not.toHaveBeenCalled();
  peek.mockResolvedValue(null as any);expect(await gateway.actor(sockets[0] as any,Date.now()+SOCKET_AUTH_TTL_MS+1)).toBeNull();expect(peek).toHaveBeenCalledTimes(1);expect(sockets[0].disconnect).toHaveBeenCalledWith(true);
 });
});
