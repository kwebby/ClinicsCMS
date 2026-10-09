/* Author: ramanpal singh | URL: https://kwebby.com */
import { createCipheriv, createDecipheriv, createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Request, Response } from 'express';
import { Redis } from 'ioredis';
import { DomainError } from '../../../packages/contracts/src/index.js';

export const digest=(value:string)=>createHash('sha256').update(value).digest('hex');
export const token=()=>randomBytes(32).toString('base64url');
export const equal=(a:string,b:string)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y);};
export class Secrets {
 private key:Buffer;
 constructor(encoded=process.env.APP_ENCRYPTION_KEY??''){this.key=Buffer.from(encoded,'base64');if(this.key.length!==32)throw new Error('APP_ENCRYPTION_KEY must be 32 random bytes encoded as base64');}
 encrypt(value:string){const iv=randomBytes(12);const c=createCipheriv('aes-256-gcm',this.key,iv,{authTagLength:16});const data=Buffer.concat([c.update(value,'utf8'),c.final()]);return [iv.toString('base64url'),c.getAuthTag().toString('base64url'),data.toString('base64url')].join('.');}
 decrypt(value:string){
  const parts=value.split('.');
  if(parts.length!==3||!parts.every(part=>/^[A-Za-z0-9_-]*$/.test(part)))throw new Error('Invalid encrypted settings');
  const [iv,tag,data]=parts.map(part=>Buffer.from(part,'base64url'));
  // Accept only the complete 128-bit authentication tag and the nonce format we issue.
  if(iv.length!==12||tag.length!==16)throw new Error('Invalid encrypted settings');
  const d=createDecipheriv('aes-256-gcm',this.key,iv,{authTagLength:16});d.setAuthTag(tag);
  return Buffer.concat([d.update(data),d.final()]).toString('utf8');
 }
}
/** Fixed-window counters. INCR and the first EXPIRE run as one script, so a counter can never be left without a TTL. */
const WINDOW_SCRIPT="local n=redis.call('INCR',KEYS[1]) if redis.call('PTTL',KEYS[1])<0 then redis.call('EXPIRE',KEYS[1],ARGV[1]) end return n";
export class RateLimiter {
 constructor(private redis:Redis,private prefix='clinic:limits:'){}
 private key(key:string){return this.prefix+digest(key);}
 private unavailable():never{throw new DomainError('RATE_LIMIT_UNAVAILABLE','The service is temporarily unavailable. Please try again shortly.',503);}
 /** Counts one event in the window and returns the new total. */
 async hit(key:string,seconds=60):Promise<number>{try{return Number(await this.redis.eval(WINDOW_SCRIPT,1,this.key(key),seconds));}catch{return this.unavailable();}}
 async count(key:string):Promise<number>{try{return Number(await this.redis.get(this.key(key))??0);}catch{return this.unavailable();}}
 async take(key:string,limit=30,seconds=60){if(await this.hit(key,seconds)>limit)throw new DomainError('RATE_LIMIT','Too many requests. Please try again later.',429);}
 /** Rejects once `limit` has been reached, without counting this call. */
 async check(key:string,limit:number){if(await this.count(key)>=limit)throw new DomainError('RATE_LIMIT','Too many requests. Please try again later.',429);}
}
/** Single source for the documented defaults shared by the API and worker. */
export const installationId=()=>process.env.INSTALLATION_ID||'clinic';
export const organizationId=()=>process.env.ORGANIZATION_ID||'clinic';
export function publicOrigin(){return (process.env.PUBLIC_URL??'http://localhost:3000').replace(/\/$/,'');}
export function allowedOrigins(){return new Set((process.env.ALLOWED_ORIGINS??publicOrigin()).split(',').map(s=>s.trim()).filter(Boolean));}
export function assertOrigin(req:Request){const origin=req.get('origin');if(!origin||!allowedOrigins().has(origin))throw new DomainError('ORIGIN','Request origin is not allowed',403);}
export function setSessionCookie(res:Response,value:string,maxAge:number){res.cookie(process.env.NODE_ENV==='production'?'__Host-clinic-session':'clinic-session',value,{httpOnly:true,secure:process.env.NODE_ENV==='production',sameSite:'lax',path:'/',maxAge});}
export function sessionCookie(req:Request):string|undefined{return req.cookies?.[process.env.NODE_ENV==='production'?'__Host-clinic-session':'clinic-session'];}
