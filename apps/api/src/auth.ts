/* Author: ramanpal singh | URL: https://kwebby.com */
import { randomBytes } from 'node:crypto';
import { hash, compare } from 'bcryptjs';
import { Redis } from 'ioredis';
import * as OTPAuth from 'otpauth';
import { z } from 'zod';
import type { Request,Response } from 'express';
import { type Database, type Entity, type Actor, type Role, type Repository, DomainError, assert } from '../../../packages/contracts/src/index.js';
import { newId } from '../../../packages/core/src/index.js';
import { digest,token,equal,Secrets,RateLimiter,assertOrigin,setSessionCookie,sessionCookie,publicOrigin,installationId,organizationId as defaultOrganization } from './security.js';
import { listAll } from './paging.js';

export interface User extends Entity, Actor { passwordHash:string; status:'active'|'disabled'; emailVerified:boolean; mfaEnabled:boolean; mfaSecret?:string; lastMfaStep?:number; recoveryHashes?:string[]; sessionVersion:number; }
interface Session { userId:string; csrfToken:string; version:number; expiresAt:number; mfaVerified:boolean; }
const email=z.email().max(254).transform(v=>v.toLowerCase().trim());
const password=z.string().min(12).max(128);
const roleSchema=z.enum(['admin','manager','doctor','nurse','receptionist','accountant','hr','editor','employee']);
export function entity(organizationId:string,id:string=newId()):Entity{const now=new Date().toISOString();return {id,organizationId,version:1,createdAt:now,updatedAt:now};}
export const asActor=(u:User):Actor=>({id:u.id,organizationId:u.organizationId,name:u.name,email:u.email,roles:u.roles,branchIds:u.branchIds,patientIds:u.patientIds});
/** Failed sign-ins per address and client (strict) and per address from anywhere (ceiling against distributed guessing), per 15 minutes. */
export const LOGIN_FAILURE_LIMITS={client:10,account:100,seconds:900};
export class AuthService {
 readonly limiter:RateLimiter; private prefix:string; private onRevoke?: (userId:string)=>void;
 constructor(readonly db:Database,readonly redis:Redis,readonly secrets:Secrets){this.prefix=`clinic:${installationId()}:sessions:`;this.limiter=new RateLimiter(redis,`${this.prefix}rate:`);}
 setRevoker(fn:(id:string)=>void){this.onRevoke=fn;}
 private async createUser(tx:Repository,input:{name:string;email:string;passwordHash:string;roles:Role[];organizationId:string;emailVerified?:boolean;branchIds?:string[]}):Promise<User>{
  const indexId=digest(input.email);assert(!await tx.get('userEmails',indexId),'EMAIL_EXISTS','An account cannot be created with these details',409);
  const user:User={...entity(input.organizationId),name:input.name,email:input.email,passwordHash:input.passwordHash,roles:input.roles,emailVerified:!!input.emailVerified,status:'active',branchIds:input.branchIds??['main'],patientIds:[],mfaEnabled:false,sessionVersion:1};
  await tx.put('users',user);await tx.put('userEmails',{...entity(input.organizationId,indexId),userId:user.id});return user;
 }
 async status(){return {configured:(await this.db.list('users',{limit:1})).length>0,registrationEnabled:process.env.REGISTRATION_ENABLED!=='false'};}
 async bootstrap(input:unknown,req:Request,res:Response){
  await this.limiter.take(`bootstrap:${req.ip}`,5,3600);assertOrigin(req);
  const data=z.object({token:z.string().min(32),name:z.string().min(2).max(120),email,password,clinicName:z.string().min(2).max(120),timezone:z.string().default('UTC'),currency:z.string().regex(/^[A-Z]{3}$/).default('USD')}).strict().parse(input);
  assert(process.env.BOOTSTRAP_TOKEN&&equal(data.token,process.env.BOOTSTRAP_TOKEN),'BOOTSTRAP_TOKEN','Invalid installation token',403);
  new Intl.DateTimeFormat('en',{timeZone:data.timezone});
  const passwordHash=await hash(data.password,12);const organizationId=defaultOrganization();
  const user=await this.db.transaction(['installation-bootstrap'],async tx=>{
   assert((await tx.list('users',{limit:1})).length===0,'CONFIGURED','The installation is already configured',409);
   const u=await this.createUser(tx,{name:data.name,email:data.email,passwordHash,roles:['owner'],organizationId,emailVerified:true});
   await tx.put('settings',{...entity(organizationId,'business'),key:'business',value:{clinicName:data.clinicName,locale:'en',country:'ZZ',currency:data.currency,timezone:data.timezone,address:'',email:data.email,phone:'',businessIds:{}}});
   await tx.put('audit',{...entity(organizationId),actorId:u.id,action:'installation.bootstrap',targetId:u.id});return u;
  });return this.issueSession(user,res,false);
 }
 async register(input:unknown,req:Request,res:Response){
  assertOrigin(req);assert(process.env.REGISTRATION_ENABLED!=='false','DISABLED','Registration is unavailable',403);await this.limiter.take(`register:${req.ip}`,8,3600);
  const data=z.object({name:z.string().min(2).max(120),email,password}).strict().parse(input);assert((await this.status()).configured,'NOT_CONFIGURED','Clinic setup is incomplete',503);
  const passwordHash=await hash(data.password,12);const organizationId=defaultOrganization();
  const user=await this.db.transaction([`email:${digest(data.email)}`],async tx=>await tx.get('userEmails',digest(data.email))?null:this.createUser(tx,{...data,passwordHash,roles:['patient'],organizationId}));
  // An existing address gets the same response as a new account, so registration cannot reveal which addresses have accounts; the address owner is told by email instead.
  if(!user){if(await this.limiter.hit(`exists-notice:${data.email}`,3600)===1)await this.queueMail(organizationId,data.email,'account.exists',{url:`${publicOrigin()}/reset-password`});return this.unlinkedSession(data,organizationId,res);}
  await this.createMailToken(user,'verify-email');return this.issueSession(user,res,true);
 }
 async login(input:unknown,req:Request,res:Response){
  assertOrigin(req);const data=z.object({email,password:z.string().max(128),totp:z.string().max(100).optional()}).strict().parse(input);
  // Only failed attempts count toward lockout, so other people's guesses cannot lock an account owner out below the account-wide ceiling.
  const client=`login-fail:${data.email}:${req.ip}`,account=`login-fail-email:${data.email}`;
  await this.limiter.take(`login-ip:${req.ip}`,40,900);await this.limiter.check(client,LOGIN_FAILURE_LIMITS.client);await this.limiter.check(account,LOGIN_FAILURE_LIMITS.account);
  const failed=async(error:DomainError):Promise<never>=>{await this.limiter.hit(client,LOGIN_FAILURE_LIMITS.seconds);await this.limiter.hit(account,LOGIN_FAILURE_LIMITS.seconds);throw error;};
  const index=await this.db.get('userEmails',digest(data.email));const user=index?await this.db.get<User>('users',String(index.userId)):null;
  // Compare against a valid fixed bcrypt hash for unknown accounts to reduce timing disclosure.
  const valid=await compare(data.password,user?.passwordHash??'$2b$12$C6UzMDM.H6dfI/f/IKcEe.4UGTUTGrHslhsETNcAN6jybpiTpdd.G');
  if(!user||!valid||user.status!=='active')return failed(new DomainError('CREDENTIALS','Invalid credentials',401));
  if(user.mfaEnabled){assert(data.totp,'MFA_REQUIRED','Enter your authenticator or recovery code',401);try{await this.verifyMfa(user,data.totp);}catch(error){if(error instanceof DomainError&&error.code==='MFA_CODE')return failed(error);throw error;}}
  return this.issueSession(user,res,user.mfaEnabled||user.roles.every(r=>r==='patient'));
 }
 private async issueSession(user:User,res:Response,mfaVerified:boolean){const raw=token();const session:Session={userId:user.id,csrfToken:token(),version:user.sessionVersion,expiresAt:Date.now()+12*3600000,mfaVerified};await this.redis.set(this.prefix+digest(raw),JSON.stringify(session),'EX',1800);setSessionCookie(res,raw,12*3600000);return {user:asActor(user),csrfToken:session.csrfToken,expiresAt:new Date(session.expiresAt).toISOString(),mfaRequired:this.mfaRequired(user,session)};}
 /** Same response shape as a new registration, but backed by no stored session: the cookie never authenticates. */
 private unlinkedSession(data:{name:string;email:string},organizationId:string,res:Response){const expiresAt=Date.now()+12*3600000;setSessionCookie(res,token(),12*3600000);return {user:{id:newId(),organizationId,name:data.name,email:data.email,roles:['patient'] as Role[],branchIds:['main'],patientIds:[] as string[]},csrfToken:token(),expiresAt:new Date(expiresAt).toISOString(),mfaRequired:false};}
 private mfaRequired(u:User,s:Session){return process.env.REQUIRE_STAFF_MFA!=='false'&&u.roles.some(r=>r!=='patient')&&!s.mfaVerified;}
 private async load(raw?:string):Promise<{user:User;session:Session;key:string}|null>{if(!raw||raw.length>100)return null;const key=this.prefix+digest(raw);const value=await this.redis.get(key);if(!value)return null;let session:Session;try{session=JSON.parse(value);}catch{return null;}const user=await this.db.get<User>('users',session.userId);if(!user||user.status!=='active'||user.sessionVersion!==session.version||session.expiresAt<Date.now()){await this.redis.del(key);return null;}return {user,session,key};}
 async resolve(raw?:string):Promise<{user:User;session:Session}|null>{const found=await this.load(raw);if(!found)return null;await this.redis.expire(found.key,Math.min(1800,Math.ceil((found.session.expiresAt-Date.now())/1000)));return {user:found.user,session:found.session};}
 /** Re-checks a session (revocation, disablement, expiry, MFA) without extending its idle timeout. */
 async peek(raw?:string):Promise<Actor|null>{const found=await this.load(raw);return found&&!this.mfaRequired(found.user,found.session)?asActor(found.user):null;}
 async session(req:Request){const found=await this.resolve(sessionCookie(req));assert(found,'UNAUTHENTICATED','Please sign in',401);return {user:asActor(found.user),csrfToken:found.session.csrfToken,expiresAt:new Date(found.session.expiresAt).toISOString(),mfaRequired:this.mfaRequired(found.user,found.session)};}
 async require(req:Request,options:{allowMfaPending?:boolean;mutation?:boolean}={}):Promise<Actor>{const found=await this.resolve(sessionCookie(req));assert(found,'UNAUTHENTICATED','Please sign in',401);if(!options.allowMfaPending)assert(!this.mfaRequired(found.user,found.session),'MFA_ENROLLMENT_REQUIRED','Set up an authenticator before accessing clinic data',403);if(options.mutation??!['GET','HEAD','OPTIONS'].includes(req.method)){assertOrigin(req);assert(equal(req.get('x-csrf-token')??'',found.session.csrfToken),'CSRF','Your security token is invalid. Refresh and try again.',403);}return asActor(found.user);}
 async logout(req:Request,res:Response){const actor=await this.require(req,{allowMfaPending:true});const raw=sessionCookie(req);if(raw)await this.redis.del(this.prefix+digest(raw));setSessionCookie(res,'',0);this.onRevoke?.(actor.id);return {signedOut:true};}
 async mfaBegin(req:Request){const actor=await this.require(req,{allowMfaPending:true});const u=await this.db.get<User>('users',actor.id);assert(u&&!u.mfaEnabled,'MFA_ENABLED','MFA is already enabled',409);assert(u.emailVerified,'EMAIL_UNVERIFIED','Verify your email address before setting up two-step verification',403);const secret=new OTPAuth.Secret({size:20});const otp=new OTPAuth.TOTP({issuer:'ClinicsCMS',label:actor.email,algorithm:'SHA1',digits:6,period:30,secret});await this.redis.set(`${this.prefix}enroll:${actor.id}`,this.secrets.encrypt(secret.base32),'EX',600);return {secret:secret.base32,uri:otp.toString()};}
 async mfaConfirm(input:unknown,req:Request){const actor=await this.require(req,{allowMfaPending:true});await this.limiter.take(`mfa-confirm:${actor.id}`,10,600);const {code}=z.object({code:z.string().regex(/^\d{6}$/)}).strict().parse(input);const pending=await this.redis.get(`${this.prefix}enroll:${actor.id}`);assert(pending,'MFA_EXPIRED','Restart authenticator setup',409);const secret=this.secrets.decrypt(pending);const otp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(secret)});const delta=otp.validate({token:code,window:1});assert(delta!==null,'MFA_CODE','Invalid authenticator code',401);const step=Math.floor(Date.now()/30000)+delta;const recoveryCodes=Array.from({length:8},()=>randomBytes(12).toString('hex'));
  await this.db.transaction([`user:${actor.id}`],async tx=>{const u=await tx.get<User>('users',actor.id);assert(u&&!u.mfaEnabled,'MFA_ENABLED','MFA is already enabled',409);assert(u.emailVerified,'EMAIL_UNVERIFIED','Verify your email address before setting up two-step verification',403);await tx.put('users',{...u,mfaEnabled:true,mfaSecret:this.secrets.encrypt(secret),lastMfaStep:Math.max(step,u.lastMfaStep??0),recoveryHashes:recoveryCodes.map(digest),version:u.version+1,updatedAt:new Date().toISOString()},u.version);});
  await this.redis.del(`${this.prefix}enroll:${actor.id}`);const raw=sessionCookie(req)!;const found=await this.resolve(raw);if(found){found.session.mfaVerified=true;await this.redis.set(this.prefix+digest(raw),JSON.stringify(found.session),'EX',1800);}return {enabled:true,recoveryCodes};
 }
 private async verifyMfa(user:User,code:string){await this.db.transaction([`user:${user.id}`],async tx=>{const current=await tx.get<User>('users',user.id);assert(current?.mfaSecret,'MFA_CODE','Invalid authenticator code',401);const h=digest(code);const recovery=current.recoveryHashes?.includes(h);let last=current.lastMfaStep;
  if(!recovery){const otp=new OTPAuth.TOTP({secret:OTPAuth.Secret.fromBase32(this.secrets.decrypt(current.mfaSecret))});const delta=otp.validate({token:code,window:1});const step=Math.floor(Date.now()/30000)+(delta??0);assert(delta!==null&&step>(current.lastMfaStep??0),'MFA_CODE','Invalid or already used authenticator code',401);last=step;}
  await tx.put('users',{...current,lastMfaStep:last,recoveryHashes:recovery?current.recoveryHashes?.filter(x=>x!==h):current.recoveryHashes,version:current.version+1,updatedAt:new Date().toISOString()},current.version);
 });}
 async team(actor:Actor){assert(actor.roles.some(r=>['owner','admin','manager','doctor','nurse','receptionist','accountant','hr'].includes(r)),'FORBIDDEN','Team access is restricted',403);const users=await listAll<User>(this.db,'users',{organizationId:actor.organizationId});const admin=actor.roles.some(r=>['owner','admin'].includes(r));return users.filter(u=>admin||(u.roles.some(r=>r!=='patient')&&(u.branchIds.some(branch=>actor.branchIds.includes(branch))||u.roles.some(r=>['owner','admin'].includes(r))))).map(u=>admin?({...asActor(u),status:u.status,mfaEnabled:u.mfaEnabled}):({id:u.id,name:u.name,email:u.email,roles:u.roles,branchIds:u.branchIds.filter(branch=>actor.branchIds.includes(branch)),status:u.status}));}
 async invite(input:unknown,actor:Actor){assert(actor.roles.some(r=>['owner','admin'].includes(r)),'FORBIDDEN','Only administrators can invite staff',403);const data=z.object({name:z.string().min(2).max(120),email,roles:z.array(roleSchema).min(1).max(8),branchIds:z.array(z.string().min(1).max(100)).min(1).max(20)}).strict().parse(input);const raw=token();const item={...entity(actor.organizationId,digest(raw)),...data,invitedBy:actor.id,expiresAt:new Date(Date.now()+72*3600000).toISOString(),used:false};await this.db.put('invitations',item);await this.queueMail(actor.organizationId,data.email,'staff.invitation',{url:`${publicOrigin()}/accept-invite?token=${raw}`,name:data.name});return {invited:true,id:item.id};}
 async acceptInvite(input:unknown,req:Request,res:Response){assertOrigin(req);await this.limiter.take(`accept:${req.ip}`,10,3600);const data=z.object({token:z.string().min(32).max(100),password}).strict().parse(input);const passwordHash=await hash(data.password,12);
  const invitationId=digest(data.token),preview=await this.db.get('invitations',invitationId);assert(preview,'INVITATION','Invitation is invalid or expired',400);
  const result=await this.db.transaction([`invitation:${invitationId}`,`email:${digest(String(preview.email))}`],async tx=>{
   const inv=await tx.get('invitations',invitationId);assert(inv&&!inv.used&&Date.parse(String(inv.expiresAt))>Date.now(),'INVITATION','Invitation is invalid or expired',400);
   const roles=inv.roles as Role[],branchIds=inv.branchIds as string[],index=await tx.get('userEmails',digest(String(inv.email)));let user:User;
   if(index){
    // The invitation proves control of the address, so it may claim an unverified self-registered account with that address. Verified accounts keep their owner.
    const existing=await tx.get<User>('users',String(index.userId));assert(existing&&!existing.emailVerified&&existing.organizationId===inv.organizationId&&existing.roles.every(r=>r==='patient'),'EMAIL_EXISTS','An account cannot be created with these details',409);
    const {mfaSecret:_secret,lastMfaStep:_step,recoveryHashes:_recovery,...rest}=existing;
    user=await tx.put<User>('users',{...rest,name:String(inv.name),passwordHash,roles,branchIds,patientIds:[],emailVerified:true,status:'active',mfaEnabled:false,sessionVersion:existing.sessionVersion+1,version:existing.version+1,updatedAt:new Date().toISOString()},existing.version);
    await tx.put('audit',{...entity(inv.organizationId),actorId:user.id,action:'invitation.claimed-unverified-account',targetId:user.id,invitationId:inv.id});
   }else user=await this.createUser(tx,{name:String(inv.name),email:String(inv.email),passwordHash,roles,branchIds,organizationId:inv.organizationId,emailVerified:true});
   await tx.put('invitations',{...inv,used:true,version:inv.version+1,updatedAt:new Date().toISOString()},inv.version);return {user,claimed:!!index};
  });
  if(result.claimed)this.onRevoke?.(result.user.id);return this.issueSession(result.user,res,false);
 }
 async changeUser(input:unknown,actor:Actor){assert(actor.roles.some(r=>['owner','admin'].includes(r)),'FORBIDDEN','Administrator access required',403);const data=z.object({id:z.string(),status:z.enum(['active','disabled']).optional(),roles:z.array(roleSchema).min(1).optional(),branchIds:z.array(z.string()).min(1).optional(),patientIds:z.array(z.string()).optional()}).strict().parse(input);await this.db.transaction([`user:${data.id}`],async tx=>{const u=await tx.get<User>('users',data.id);assert(u&&u.organizationId===actor.organizationId&&!u.roles.includes('owner'),'FORBIDDEN','This account cannot be changed here',403);if(data.roles?.some(r=>!u.roles.includes(r)))assert(u.emailVerified,'EMAIL_UNVERIFIED','The account email must be verified before staff roles are granted',409);if(data.patientIds)for(const id of data.patientIds){const p=await tx.get('patients',id);assert(p&&p.organizationId===actor.organizationId,'PATIENT','Invalid patient linkage');}const next={...u,...data,sessionVersion:u.sessionVersion+1,version:u.version+1,updatedAt:new Date().toISOString()};await tx.put('users',next,u.version);await tx.put('audit',{...entity(actor.organizationId),actorId:actor.id,action:'user.permissions',targetId:u.id});});this.onRevoke?.(data.id);return {updated:true};}
 async revokeSessions(req:Request){const actor=await this.require(req,{allowMfaPending:true});await this.db.transaction([`user:${actor.id}`],async tx=>{const user=await tx.get<User>('users',actor.id);assert(user,'ACCOUNT','Account not found',404);await tx.put('users',{...user,sessionVersion:user.sessionVersion+1,version:user.version+1,updatedAt:new Date().toISOString()},user.version);});this.onRevoke?.(actor.id);return {revoked:true};}
 private async queueMail(org:string,to:string,template:string,data:Record<string,unknown>){await this.db.put('outbox',{...entity(org),type:'email.send',status:'pending',payload:{to,template,data},attempts:0,nextAttemptAt:new Date().toISOString()});}
 private async createMailToken(user:User,purpose:string){const raw=token();await this.db.put('authTokens',{...entity(user.organizationId,digest(raw)),userId:user.id,purpose,expiresAt:new Date(Date.now()+3600000).toISOString(),used:false});await this.queueMail(user.organizationId,user.email,purpose,{url:`${publicOrigin()}/${purpose}?token=${raw}`});}
 async requestReset(input:unknown,req:Request){assertOrigin(req);await this.limiter.take(`reset:${req.ip}`,5,3600);const data=z.object({email}).strict().parse(input);
  // Respond before the account lookup and mail queueing, so response timing does not reveal whether the address is registered.
  void this.queueReset(data.email).catch(error=>console.error(JSON.stringify({event:'auth.reset-queue-failed',errorType:error instanceof Error?error.name:'unknown'})));
  return {message:'If the address is registered, instructions will be sent.'};}
 private async queueReset(address:string){const ix=await this.db.get('userEmails',digest(address));const u=ix?await this.db.get<User>('users',String(ix.userId)):null;if(u)await this.createMailToken(u,'reset-password');}
 async consumeToken(input:unknown,req:Request){assertOrigin(req);await this.limiter.take(`token:${req.ip}`,15,3600);const data=z.object({token:z.string().min(32).max(100),password:password.optional()}).strict().parse(input);const passwordHash=data.password?await hash(data.password,12):undefined;const userId=await this.db.transaction([`token:${digest(data.token)}`],async tx=>{const t=await tx.get('authTokens',digest(data.token));assert(t&&!t.used&&Date.parse(String(t.expiresAt))>Date.now(),'TOKEN','Token is invalid or expired');const u=await tx.get<User>('users',String(t.userId));assert(u,'TOKEN','Invalid account');if(t.purpose==='reset-password')assert(passwordHash,'PASSWORD','A new password is required');await tx.put('users',{...u,...(t.purpose==='reset-password'?{passwordHash,sessionVersion:u.sessionVersion+1}:{emailVerified:true}),version:u.version+1,updatedAt:new Date().toISOString()},u.version);await tx.put('authTokens',{...t,used:true,version:t.version+1,updatedAt:new Date().toISOString()},t.version);return u.id;});this.onRevoke?.(userId);return {completed:true};}
}
