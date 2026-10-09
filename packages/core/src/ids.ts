/* Author: ramanpal singh | URL: https://kwebby.com */
import { randomBytes } from 'node:crypto';

/** Time-ordered record identifier (UUID version 7, RFC 9562). Byte order matches creation order, so
 * cursor pagination by id also returns records oldest-first. Use only for record ids, never for secrets. */
export function newId(now = Date.now()): string {
 const bytes = randomBytes(16);
 const ms = BigInt(now);
 for (let i = 0; i < 6; i++) bytes[i] = Number((ms >> BigInt(8 * (5 - i))) & 0xffn);
 bytes[6] = (bytes[6] & 0x0f) | 0x70;
 bytes[8] = (bytes[8] & 0x3f) | 0x80;
 const hex = bytes.toString('hex');
 return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
