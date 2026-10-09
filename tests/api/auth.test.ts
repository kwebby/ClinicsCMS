/* Author: ramanpal singh | URL: https://kwebby.com */
import { describe,it,expect,beforeAll,afterAll,vi } from 'vitest';
import { randomBytes,randomUUID } from 'node:crypto';
import { createApp } from '../../apps/api/src/main.js';
import { Runtime } from '../../apps/api/src/runtime.js';
import { LOGIN_FAILURE_LIMITS } from '../../apps/api/src/auth.js';
import type { INestApplication } from '@nestjs/common';
import * as OTPAuth from 'otpauth';
const enabled=!!process.env.REDIS_TEST_URL;
describe.skipIf(!enabled)('HTTP security with isolated test sessions',()=>{
 let app:INestApplication,url:string,cookie:string,csrf:string,ownerId:string;
 const origin='http://localhost:3000',password='Unique test password 456!';
 const request=async(path:string,body?:unknown,options:{cookie?:string;csrf?:string;origin?:string;ip?:string;method?:string}={})=>{const response=await fetch(url+'/api/v1'+path,{method:options.method??(body===undefined?'GET':'POST'),headers:{'content-type':'application/json',origin:options.origin??origin,...((options.cookie??cookie)?{cookie:options.cookie??cookie}:{}),...((options.csrf??csrf)?{'x-csrf-token':options.csrf??csrf}:{}),...(options.ip?{'x-forwarded-for':options.ip}:{})},body:body===undefined?undefined:JSON.stringify(body)});return {response,result:await response.json() as any};};
 const sessionOf=(r:{response:Response;result:any})=>({cookie:r.response.headers.get('set-cookie')!.split(';')[0],csrf:r.result.data.csrfToken as string});
 const outbox=async()=>(await app.get(Runtime).db.list('outbox')) as any[];
 beforeAll(async()=>{process.env.DATABASE_DRIVER='memory';process.env.NODE_ENV='test';process.env.REDIS_URL=process.env.REDIS_TEST_URL;process.env.INSTALLATION_ID='test-'+randomUUID();process.env.APP_ENCRYPTION_KEY=randomBytes(32).toString('base64');process.env.BOOTSTRAP_TOKEN=randomBytes(32).toString('hex');process.env.REQUIRE_STAFF_MFA='false';process.env.PUBLIC_URL=origin;process.env.ALLOWED_ORIGINS=origin;process.env.TRUST_PROXY_HOPS='1';app=await createApp();await app.listen(0,'127.0.0.1');url=await app.getUrl();},20000);
 afterAll(async()=>{await app?.close();});
 it('bootstraps once and never exposes password material',async()=>{const r=await request('/auth/bootstrap',{token:process.env.BOOTSTRAP_TOKEN,name:'Test owner',email:'owner@example.test',password,clinicName:'Test clinic',timezone:'UTC',currency:'USD'});expect(r.response.status).toBe(201);cookie=r.response.headers.get('set-cookie')!.split(';')[0];csrf=r.result.data.csrfToken;ownerId=r.result.data.user.id;expect(r.result.data.user.passwordHash).toBeUndefined();const again=await request('/auth/bootstrap',{token:process.env.BOOTSTRAP_TOKEN,name:'Other owner',email:'second@example.test',password,clinicName:'Test clinic',timezone:'UTC',currency:'USD'});expect(again.response.status).toBe(409);});
 it('requires both CSRF and trusted origins for mutations',async()=>{expect((await request('/records/patients',{branchId:'main',name:'Test person'},{csrf:'wrong'})).response.status).toBe(403);expect((await request('/records/patients',{branchId:'main',name:'Test person'},{origin:'https://evil.example'})).response.status).toBe(403);});
 it('prevents privileged public registration and avoids identity auto-linking',async()=>{const escalation=await request('/auth/register',{name:'Patient',email:'p@example.test',password,roles:['owner']});expect(escalation.response.status).toBe(400);const r=await request('/auth/register',{name:'Patient',email:'p@example.test',password});expect(r.response.status).toBe(201);expect(r.result.data.user.roles).toEqual(['patient']);expect(r.result.data.user.patientIds).toEqual([]);const patientCookie=r.response.headers.get('set-cookie')!.split(';')[0];const denied=await request('/records/patients',{branchId:'main',name:'Someone else'},{cookie:patientCookie,csrf:r.result.data.csrfToken});expect(denied.response.status).toBe(403);const settings=await request('/integrations',undefined,{cookie:patientCookie});expect(settings.response.status).toBe(403);});
 it('publishes no draft content or configuration secrets',async()=>{const r=await request('/public/site');expect(r.response.status).toBe(200);expect(JSON.stringify(r.result)).not.toContain('password');expect(r.result.data.pages).toEqual([]);expect(r.response.headers.get('cache-control')).toContain('no-store');});
 it('enforces staff MFA gating when enabled',async()=>{process.env.REQUIRE_STAFF_MFA='true';expect((await request('/dashboard')).response.status).toBe(403);expect((await request('/auth/session')).result.data.mfaRequired).toBe(true);process.env.REQUIRE_STAFF_MFA='false';});
 it('enrolls MFA, rejects OTP replay, and consumes recovery codes once',async()=>{process.env.REQUIRE_STAFF_MFA='true';const setup=await request('/auth/mfa/begin',{});expect(setup.response.status).toBe(201);const otp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(setup.result.data.secret)});const enrollmentCode=otp.generate();const confirmed=await request('/auth/mfa/confirm',{code:enrollmentCode});expect(confirmed.response.status).toBe(201);expect(confirmed.result.data.recoveryCodes).toHaveLength(8);expect((await request('/dashboard')).response.status).toBe(200);expect((await request('/auth/login',{email:'owner@example.test',password})).response.status).toBe(401);const recovery=confirmed.result.data.recoveryCodes[0];expect((await request('/auth/login',{email:'owner@example.test',password,totp:recovery})).response.status).toBe(201);expect((await request('/auth/login',{email:'owner@example.test',password,totp:recovery})).response.status).toBe(401);expect((await request('/auth/login',{email:'owner@example.test',password,totp:enrollmentCode})).response.status).toBe(401);const fresh=otp.generate({timestamp:Date.now()+30000});expect((await request('/auth/login',{email:'owner@example.test',password,totp:fresh})).response.status).toBe(201);expect((await request('/auth/login',{email:'owner@example.test',password,totp:fresh})).response.status).toBe(401);});
 it('answers registration of an existing address exactly like a new account, without signing anyone in',async()=>{
  const fresh=await request('/auth/register',{name:'New patient',email:'new@example.test',password},{cookie:'',csrf:''});expect(fresh.response.status).toBe(201);
  const existing=await request('/auth/register',{name:'Someone',email:'p@example.test',password:'A different password 789!'},{cookie:'',csrf:''});expect(existing.response.status).toBe(201);
  expect(Object.keys(existing.result.data).sort()).toEqual(Object.keys(fresh.result.data).sort());expect(Object.keys(existing.result.data.user).sort()).toEqual(Object.keys(fresh.result.data.user).sort());expect(existing.result.data.user.roles).toEqual(['patient']);
  expect(existing.response.headers.get('set-cookie')).toContain('clinic-session=');expect((await request('/auth/session',undefined,{...sessionOf(existing)})).response.status).toBe(401);
  expect((await outbox()).filter(row=>row.payload?.template==='account.exists'&&row.payload?.to==='p@example.test')).toHaveLength(1);
  expect((await request('/auth/login',{email:'p@example.test',password},{cookie:'',csrf:''})).response.status).toBe(201);
  const patient=sessionOf(fresh);expect((await request('/auth/mfa/begin',{},patient)).result.error.code).toBe('EMAIL_UNVERIFIED');
  const promote=await request(`/auth/team/${fresh.result.data.user.id}`,{roles:['receptionist']},{method:'PATCH'});expect(promote.response.status).toBe(409);expect(promote.result.error.code).toBe('EMAIL_UNVERIFIED');
 });
 it('locks sign-in per address and client after failures only, with an account-wide ceiling',async()=>{
  const r=await request('/auth/register',{name:'Locked patient',email:'lock@example.test',password},{cookie:'',csrf:''});expect(r.response.status).toBe(201);
  const login=(ip:string,secret=password)=>request('/auth/login',{email:'lock@example.test',password:secret},{cookie:'',csrf:'',ip});
  for(let i=0;i<3;i++)expect((await login('198.51.100.7')).response.status).toBe(201);
  for(let i=0;i<10;i++)expect((await login('198.51.100.7','Wrong password value 000')).response.status).toBe(401);
  expect((await login('198.51.100.7')).response.status).toBe(429);
  expect((await login('198.51.100.8')).response.status).toBe(201);
  const limiter=app.get(Runtime).auth.limiter;while(await limiter.count('login-fail-email:lock@example.test')<LOGIN_FAILURE_LIMITS.account)await limiter.hit('login-fail-email:lock@example.test',LOGIN_FAILURE_LIMITS.seconds);
  expect((await login('198.51.100.9')).response.status).toBe(429);
 });
 it('lets an invitation claim an unverified self-registration and revokes its sessions',async()=>{
  const inviteToken=async(address:string)=>{const row=(await outbox()).reverse().find(item=>item.payload?.template==='staff.invitation'&&item.payload?.to===address);return new URL(row.payload.data.url).searchParams.get('token')!;};
  expect((await request('/auth/invite',{name:'Front desk',email:'claimed@example.test',roles:['receptionist'],branchIds:['main']})).response.status).toBe(201);
  const squatter=await request('/auth/register',{name:'Squatter',email:'claimed@example.test',password:'Squatter password 111!'},{cookie:'',csrf:''});expect(squatter.response.status).toBe(201);
  const accepted=await request('/auth/accept-invite',{token:await inviteToken('claimed@example.test'),password:'Staff password 2222!'},{cookie:'',csrf:''});expect(accepted.response.status).toBe(201);expect(accepted.result.data.user).toMatchObject({id:squatter.result.data.user.id,roles:['receptionist'],patientIds:[]});
  expect((await request('/auth/session',undefined,{...sessionOf(squatter)})).response.status).toBe(401);
  expect((await request('/auth/login',{email:'claimed@example.test',password:'Squatter password 111!'},{cookie:'',csrf:''})).response.status).toBe(401);
  expect((await request('/auth/login',{email:'claimed@example.test',password:'Staff password 2222!'},{cookie:'',csrf:''})).response.status).toBe(201);
  expect((await request('/auth/invite',{name:'Owner again',email:'owner@example.test',roles:['admin'],branchIds:['main']})).response.status).toBe(201);
  expect((await request('/auth/accept-invite',{token:await inviteToken('owner@example.test'),password:'Takeover password 333!'},{cookie:'',csrf:''})).response.status).toBe(409);
 });
 it('queues reset mail only for real accounts and answers both identically',async()=>{
  const real=await request('/auth/reset-password',{email:'p@example.test'},{cookie:'',csrf:''}),unknown=await request('/auth/reset-password',{email:'nobody@example.test'},{cookie:'',csrf:''});
  expect(real.response.status).toBe(unknown.response.status);expect(real.result).toEqual(unknown.result);
  await vi.waitFor(async()=>expect((await outbox()).some(row=>row.payload?.template==='reset-password'&&row.payload?.to==='p@example.test')).toBe(true));expect((await outbox()).some(row=>row.payload?.to==='nobody@example.test')).toBe(false);
 });
 it('revokes sessions server-side',async()=>{expect((await request('/auth/revoke-sessions',{})).response.status).toBe(201);expect((await request('/dashboard')).response.status).toBe(401);});
});
