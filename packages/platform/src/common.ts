/* Author: ramanpal singh | URL: https://kwebby.com */
import { Actor, Entity, Role, assert } from '../../contracts/src/index.js';
import { newId } from '../../core/src/ids.js';

/** Time-ordered record identifier; never use it for tokens or secrets. */
export const id = (): string => newId();
export function entity(organizationId: string, data: Record<string, unknown>, entityId: string = id()): Entity {
 const time = new Date().toISOString();
 return {...data, id: entityId, organizationId, version: 1, createdAt: time, updatedAt: time};
}
export function requireRoles(actor: Actor, roles: Role[]) { assert(actor?.id && roles.some(role => actor.roles.includes(role)), 'FORBIDDEN', 'Your account cannot perform this action', 403); }
export function inOrganization(record: Entity | null, actor: Actor): asserts record is Entity { assert(record && record.organizationId === actor.organizationId, 'NOT_FOUND', 'Record not found', 404); }
export function escapeHtml(value: unknown): string { return String(value ?? '').replace(/[&<>"']/g, char => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]!)); }
export function safeUrl(value: unknown, relative = true): string | null {
 if (typeof value !== 'string' || value.length > 2048 || /[\u0000-\u0020\\]/.test(value)) return null;
 if (relative && value.startsWith('/') && !value.startsWith('//')) return value;
 try { const parsed = new URL(value); return ['https:', 'http:'].includes(parsed.protocol) && !parsed.username && !parsed.password ? parsed.href : null; } catch { return null; }
}
/** Bounded FIFO admission: `concurrency` holders at once, at most `queueSize` waiters, each waiting at most `timeoutMs`. Resolves null when refused, timed out or aborted. */
export function createAdmission(concurrency: number, queueSize: number, timeoutMs: number) {
 let active = 0; const waiting: (() => void)[] = [];
 const release = () => { const next = waiting.shift(); if (next) next(); else active--; };
 const handle = () => { let done = false; return () => { if (!done) { done = true; release(); } }; };
 return {
  get active() { return active; }, get waiting() { return waiting.length; },
  canQueue: () => active < concurrency || waiting.length < queueSize,
  acquire(signal?: AbortSignal): Promise<(() => void) | null> {
   if (active < concurrency) { active++; return Promise.resolve(handle()); }
   if (waiting.length >= queueSize || signal?.aborted) return Promise.resolve(null);
   return new Promise(resolve => {
    const grant = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(handle()); };
    const cancel = () => { const index = waiting.indexOf(grant); if (index >= 0) waiting.splice(index, 1); clearTimeout(timer); signal?.removeEventListener('abort', cancel); resolve(null); };
    const timer = setTimeout(cancel, timeoutMs); signal?.addEventListener('abort', cancel, {once: true}); waiting.push(grant);
   });
  },
 };
}
/** Integer environment setting within bounds; an invalid value stops startup instead of silently using a default. */
export function boundedIntegerSetting(name: string, fallback: number, min: number, max: number): number {
 const raw = process.env[name]; if (raw === undefined || raw === '') return fallback;
 const value = Number(raw); if (!Number.isInteger(value) || value < min || value > max) throw new Error(`${name} must be an integer from ${min} to ${max}`); return value;
}
