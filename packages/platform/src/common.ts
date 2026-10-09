/* Author: ramanpal singh | URL: https://kwebby.com */
import { randomUUID } from 'node:crypto';
import { Actor, Entity, Role, assert } from '../../contracts/src/index.js';

export const id = () => randomUUID();
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
