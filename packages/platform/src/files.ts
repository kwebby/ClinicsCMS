/* Author: ramanpal singh | URL: https://kwebby.com */
import { constants } from 'node:fs';
import { mkdir, mkdtemp, open, readFile, rename, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Actor, Database, FileReference, assert } from '../../contracts/src/index.js';
import { entity, id } from './common.js';

export interface MalwareScanner { scan(path: string): Promise<void>; }
export class ClamAvScanner implements MalwareScanner {
 constructor(private readonly command = 'clamdscan') {}
 async scan(path: string) {
  try { await promisify(execFile)(this.command, [...(process.env.CLAMD_CONFIG ? ['--config-file', process.env.CLAMD_CONFIG] : []), '--stream', '--no-summary', path], {timeout: 30_000, maxBuffer: 16_384, windowsHide: true}); }
  // clamdscan exits 1 only when a signature matched; any other failure (daemon down, timeout, missing client) still fails closed but is not a malware verdict.
  catch (error) { if ((error as {code?: unknown})?.code === 1) assert(false, 'FILE_SCAN_FAILED', 'The file could not pass the malware scanner', 422); assert(false, 'SCANNER_UNAVAILABLE', 'Malware scanning is temporarily unavailable; try again later', 503); }
 }
}
export async function scanBuffer(bytes: Buffer, scanner: MalwareScanner): Promise<void> {
 const dir = await mkdtemp(join(tmpdir(), 'clinic-quarantine-'));
 try { const handle = await open(join(dir,'upload'), 'wx', 0o600); try { await handle.writeFile(bytes); } finally { await handle.close(); } await scanner.scan(join(dir,'upload')); }
 finally { await rm(dir, {recursive:true,force:true}); }
}
export function segment(value: string): string { assert(/^[A-Za-z0-9_-]{1,100}$/.test(value), 'INVALID_IDENTIFIER', 'Invalid storage identifier'); return value; }
export async function privateRead(path: string): Promise<Buffer> { const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); try { const info = await handle.stat(); assert(info.isFile(), 'INVALID_FILE', 'Invalid file', 404); return await handle.readFile(); } finally { await handle.close(); } }
export function detectMime(bytes: Buffer): string | null {
 if (bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) return 'image/png';
 if (bytes[0]===255 && bytes[1]===216 && bytes[2]===255) return 'image/jpeg';
 if (bytes.subarray(0,4).toString()==='RIFF' && bytes.subarray(8,12).toString()==='WEBP') return 'image/webp';
 if (bytes.subarray(0,5).toString()==='%PDF-') return 'application/pdf';
 if (bytes.subarray(0,4).toString()==='wOF2') return validWoff2Header(bytes) ? 'font/woff2' : null;
 return null;
}
/** WOFF2 table header: declared length must equal the file, flavor must be a font, reserved must be zero and every block must fit. */
export function validWoff2Header(bytes: Buffer): boolean {
 if (bytes.length < 48 || bytes.readUInt32BE(0) !== 0x774f4632) return false;
 const flavor = bytes.readUInt32BE(4), numTables = bytes.readUInt16BE(12), compressed = bytes.readUInt32BE(20);
 const within = (offset: number, length: number) => offset === 0 && length === 0 || offset >= 48 && offset + length <= bytes.length;
 return [0x00010000, 0x4f54544f, 0x74746366, 0x74727565].includes(flavor) && bytes.readUInt32BE(8) === bytes.length && numTables >= 1 && numTables <= 512 && bytes.readUInt16BE(14) === 0 && compressed > 0 && 48 + compressed <= bytes.length && within(bytes.readUInt32BE(28), bytes.readUInt32BE(32)) && within(bytes.readUInt32BE(40), bytes.readUInt32BE(44));
}
export type FileScope = 'clinical' | 'conversation' | 'personal' | 'payroll';
interface StorageOptions { root: string; scanner?: MalwareScanner; maxBytes?: number; }
export class LocalFileStorage {
 private readonly scanner: MalwareScanner;
 private readonly root: string;
 constructor(private readonly db: Database, private readonly options: StorageOptions) { this.root = resolve(options.root); this.scanner = options.scanner ?? new ClamAvScanner(); }
 async upload(input: {bytes: Buffer; name: string; mime: string; patientId?: string; scope?: FileScope}, actor: Actor) {
  assert(actor?.id, 'UNAUTHENTICATED', 'Authentication required', 401);
  assert(input.bytes.length > 0 && input.bytes.length <= (this.options.maxBytes ?? 20*1024*1024), 'FILE_SIZE', 'File must be between 1 byte and 20 MiB');
  const scope = input.scope ?? (input.patientId ? 'clinical' : 'personal');
  assert(['clinical','conversation','personal','payroll'].includes(scope), 'FILE_SCOPE', 'Invalid file scope');
  if (scope==='clinical') {
   assert(input.patientId, 'PATIENT_REQUIRED', 'Clinical files require a patient');
   const patient = await this.db.get('patients', input.patientId);
   assert(patient && patient.organizationId===actor.organizationId, 'NOT_FOUND', 'Patient not found',404);
   const staff = actor.roles.some(role => ['doctor','nurse'].includes(role));
   assert(actor.patientIds.includes(input.patientId!) || (staff && (!patient.branchId || actor.roles.includes('owner') || actor.roles.includes('admin') || actor.branchIds.includes(String(patient.branchId)))), 'FORBIDDEN', 'Patient access denied',403);
  }
  if (scope==='payroll') assert(actor.roles.some(role => ['owner','admin','hr'].includes(role)), 'FORBIDDEN', 'Payroll upload denied',403);
  // Release/attachment checks downstream trust file.patientId, so a non-clinical link must be within the uploader's own patient scope.
  if (scope!=='clinical' && input.patientId!==undefined) {
   assert(scope==='conversation', 'FILE_SCOPE', 'Only clinical or conversation files can reference a patient');
   const patient = await this.db.get('patients', input.patientId);
   assert(patient && patient.organizationId===actor.organizationId, 'NOT_FOUND', 'Patient not found',404);
   const staff = actor.roles.some(role => role!=='patient');
   assert(actor.patientIds.includes(input.patientId) || (staff && (!patient.branchId || actor.roles.includes('owner') || actor.roles.includes('admin') || actor.branchIds.includes(String(patient.branchId)))), 'FORBIDDEN', 'Patient access denied',403);
  }
  const mime = detectMime(input.bytes);
  assert(mime && ['image/jpeg','image/png','image/webp','application/pdf'].includes(mime) && input.mime===mime, 'FILE_TYPE', 'File content does not match a supported document or image');
  await scanBuffer(input.bytes, this.scanner);
  const fileId = id(), directory = join(this.root,'files',segment(actor.organizationId));
  await mkdir(directory, {recursive:true,mode:0o700});
  const storageKey = `${segment(actor.organizationId)}/${fileId}`;
  const handle = await open(join(directory,fileId), 'wx', 0o600);
  try { await handle.writeFile(input.bytes); } finally { await handle.close(); }
  const record = entity(actor.organizationId, {storageKey, originalName: basename(input.name).replace(/[\x00-\x1f\x7f]/g,'').slice(0,180) || 'document', mime, size:input.bytes.length, sha256:createHash('sha256').update(input.bytes).digest('hex'), visibility:'private',scanStatus:'clean',ownerId:actor.id, ...(input.patientId ? {patientId:input.patientId} : {}),scope},fileId) as FileReference;
  try { await this.db.put('files',record); } catch (error) { await rm(join(directory,fileId),{force:true}); throw error; }
  return record;
 }
 async read(fileId: string, actor: Actor): Promise<{record:FileReference;bytes:Buffer}> {
  const record = await this.db.get<FileReference>('files',fileId);
  assert(record && record.organizationId===actor.organizationId && record.scanStatus==='clean', 'NOT_FOUND','File not found',404);
  let permitted = record.ownerId===actor.id;
  if (record.scope==='clinical' && record.patientId) {
   const patient = await this.db.get('patients',record.patientId);
   const branchAllowed = !!patient && (!patient.branchId || actor.roles.some(role => ['owner','admin'].includes(role)) || actor.branchIds.includes(String(patient.branchId)));
   permitted = (actor.patientIds.includes(record.patientId) && (record.ownerId===actor.id || record.released===true)) || (branchAllowed && actor.roles.some(role => ['doctor','nurse'].includes(role)));
  }
  if (record.scope==='payroll') permitted = actor.roles.some(role => ['owner','admin','hr'].includes(role)) || (record.employeeUserId===actor.id && record.released===true);
  // Conversation access is granted through explicit server-owned bindings, not ownership claims in upload input.
  if (record.scope==='conversation' && typeof record.conversationId==='string') { const conversation = await this.db.get('conversations',record.conversationId); permitted = conversation?.organizationId===actor.organizationId && Array.isArray(conversation.participantIds) && conversation.participantIds.includes(actor.id); }
  assert(permitted, 'FORBIDDEN','File access denied',403);
  const bytes = await privateRead(join(this.root,'files',segment(actor.organizationId),segment(record.id)));
  assert(createHash('sha256').update(bytes).digest('hex')===record.sha256, 'FILE_INTEGRITY','File integrity validation failed',500);
  return {record,bytes};
 }
}
