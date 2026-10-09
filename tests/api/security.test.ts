/* Author: ramanpal singh | URL: https://kwebby.com */
import { describe,it,expect } from 'vitest';
import { randomBytes } from 'node:crypto';
import { Secrets,equal } from '../../apps/api/src/security.js';
describe('secret boundaries',()=>{
 it('authenticates encrypted settings and rejects tampering',()=>{const s=new Secrets(randomBytes(32).toString('base64'));const encrypted=s.encrypt('synthetic integration secret');expect(encrypted).not.toContain('synthetic');expect(s.decrypt(encrypted)).toBe('synthetic integration secret');const parts=encrypted.split('.');const ciphertext=Buffer.from(parts[2],'base64url');ciphertext[0]^=1;parts[2]=ciphertext.toString('base64url');expect(()=>s.decrypt(parts.join('.'))).toThrow();expect(()=>new Secrets('weak')).toThrow();});
 it('rejects shortened authentication tags and malformed encrypted envelopes',()=>{const s=new Secrets(randomBytes(32).toString('base64'));const encrypted=s.encrypt('settings');const [iv,tag,data]=encrypted.split('.');for(const length of [0,4,8,12,15])expect(()=>s.decrypt([iv,Buffer.from(tag,'base64url').subarray(0,length).toString('base64url'),data].join('.'))).toThrow();expect(()=>s.decrypt(`${encrypted}.extra`)).toThrow();expect(()=>s.decrypt([Buffer.alloc(8).toString('base64url'),tag,data].join('.'))).toThrow();expect(s.decrypt(s.encrypt(''))).toBe('');});
 it('compares variable-byte strings without throwing',()=>{expect(equal('é','aa')).toBe(false);expect(equal('test','test')).toBe(true);expect(equal('test','TEST')).toBe(false);});
});
