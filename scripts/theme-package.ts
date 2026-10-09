/* Author: ramanpal singh | URL: https://kwebby.com */
import 'dotenv/config';
import { lstat, mkdir, open, readdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import type { Readable } from 'node:stream';
import yazl from 'yazl';
import { privateRead } from '../packages/platform/src/files.js';
import { THEME_LIMITS, validateThemeZip } from '../packages/platform/src/themes.js';

const usage = `ClinicsCMS theme packaging

  pnpm theme:package pack <theme-directory> <output.zip>
  pnpm theme:package check <existing.zip>

Both commands use the server's ZIP validator and require working clamdscan.
Set CLAMD_CONFIG if the daemon uses a non-default configuration.
No theme is uploaded or activated. Existing output files are never overwritten.`;

async function sourceFiles(root: string): Promise<Map<string, Buffer>> {
 const rootInfo = await lstat(root);
 if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error('Theme source must be a real directory, not a symbolic link.');
 const files = new Map<string, Buffer>();
 let entries = 0, expanded = 0;
 async function visit(directory: string, prefix = ''): Promise<void> {
  for (const name of (await readdir(directory)).sort()) {
   const entry = prefix ? `${prefix}/${name}` : name;
   if (++entries > THEME_LIMITS.entries) throw new Error('Theme source exceeds the 1,000-entry limit.');
   if (entry.length > 200) throw new Error('Theme source contains a path longer than 200 characters.');
   const path = join(directory, name), info = await lstat(path);
   if (info.isSymbolicLink()) throw new Error(`Symbolic links are forbidden: ${entry}`);
   if (info.isDirectory()) {
    if (!/^assets(?:\/[A-Za-z0-9_-]+)*$/.test(entry)) throw new Error(`Unsupported directory: ${entry}. Use only assets/ and its safe subdirectories.`);
    await visit(path, entry);
   } else {
    if (!info.isFile()) throw new Error(`Only regular files are supported: ${entry}`);
    if (entry !== 'theme.json' && !/^assets\/[A-Za-z0-9_/-]+\.(png|jpg|jpeg|webp|woff2)$/.test(entry)) throw new Error(`Unsupported file: ${entry}`);
    if (info.size > THEME_LIMITS.fileBytes) throw new Error(`Theme file exceeds 20 MiB: ${entry}`);
    const bytes = await privateRead(path);
    if (bytes.length > THEME_LIMITS.fileBytes) throw new Error(`Theme file exceeds 20 MiB: ${entry}`);
    expanded += bytes.length;
    if (expanded > THEME_LIMITS.expandedBytes) throw new Error('Theme source exceeds the 100 MiB expanded limit.');
    files.set(entry, bytes);
   }
  }
 }
 await visit(root);
 return files;
}

async function zipFiles(files: Map<string, Buffer>): Promise<Buffer> {
 const archive = new yazl.ZipFile();
 // Stored entries avoid surprising expansion-ratio rejection for short, repetitive manifests.
 for (const [name, bytes] of files) archive.addBuffer(bytes, name, { compress: false, mtime: new Date('1980-01-01T00:00:00Z'), mode: 0o100644 });
 archive.end();
 const chunks: Buffer[] = [];
 let size = 0;
 for await (const chunk of archive.outputStream) {
  const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
  size += bytes.length;
  if (size > THEME_LIMITS.compressedBytes) { (archive.outputStream as Readable).destroy(); throw new Error('The packaged ZIP exceeds 25 MiB. Reduce asset sizes.'); }
  chunks.push(bytes);
 }
 return Buffer.concat(chunks);
}

async function run(): Promise<void> {
 const [command, source, target, ...extra] = process.argv.slice(2);
 if (!command || command === '--help' || command === '-h') { console.log(usage); return; }
 if (!source || extra.length || !['pack','check'].includes(command) || (command === 'pack' ? !target : Boolean(target))) throw new Error(usage);
 let bytes: Buffer;
 if (command === 'pack') {
  const root = resolve(source), output = resolve(target!);
  const inside = relative(root, output);
  if (inside === '' || (!inside.startsWith(`..${sep}`) && inside !== '..' && !inside.startsWith(sep))) throw new Error('Write the ZIP outside the source directory.');
  if (!output.endsWith('.zip')) throw new Error('The output filename must end in .zip.');
  bytes = await zipFiles(await sourceFiles(root));
 } else {
  const path = resolve(source), info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > THEME_LIMITS.compressedBytes) throw new Error('Choose a regular ZIP file of at most 25 MiB.');
  bytes = await privateRead(path);
 }
 const validated = await validateThemeZip(bytes);
 if (command === 'pack') {
  const output = resolve(target!);
  await mkdir(dirname(output), { recursive: true });
  const handle = await open(output, 'wx', 0o644);
  try { await handle.writeFile(bytes); } finally { await handle.close(); }
  console.log(`Created ${output}`);
 }
 console.log(JSON.stringify({ name: validated.manifest.name, version: validated.manifest.version, files: validated.files.size, bytes: bytes.length, sha256: validated.sha256, validation: 'server ZIP rules and malware scan passed', activated: false }, null, 2));
}
run().catch(error => { console.error(error instanceof Error ? error.message : 'Theme packaging failed.'); process.exitCode = 1; });
