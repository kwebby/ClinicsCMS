/* Author: ramanpal singh | URL: https://kwebby.com */
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { composeConfigErrors, createDeploymentEnvironment, type DeploymentOptions } from './deployment-config.js';

const scratch = await mkdtemp(join(tmpdir(), 'clinic-compose-'));
const executable = process.env.COMPOSE_BINARY || 'docker';
const prefix = process.env.COMPOSE_BINARY ? [] : ['compose'];
const scenarios: Record<string, unknown>[] = [];
const version = spawnSync(executable, [...prefix, 'version', '--short'], { encoding: 'utf8', timeout: 10000 });
if (version.status !== 0) throw new Error('Install Docker Compose or set COMPOSE_BINARY to a standalone Compose executable.');
try {
  for (const database of ['postgres', 'mysql', 'supabase', 'firestore'] as const) for (const proxy of ['nginx', 'apache'] as const) for (const major of database === 'postgres' ? [17, 18] : [0]) {
    const env = createDeploymentEnvironment({ domain: 'clinic.example.org', database, proxy } as DeploymentOptions);
    if (database === 'supabase') env.DATABASE_URL = 'postgresql://fixture:synthetic@db.example.org:5432/clinic?sslmode=verify-full';
    if (database === 'firestore') { env.FIREBASE_PROJECT_ID = 'clinic-config-fixture'; env.FIREBASE_CREDENTIALS_FILE = join(scratch, 'unused-credentials.json'); }
    const file = join(scratch, `${database}-${proxy}-${major}.env`);
    await writeFile(file, Object.entries(env).map(([key, value]) => `${key}=${value}`).join('\n'), { mode: 0o600 });
    const args = [...prefix, '--env-file', file, '-f', 'deploy/compose.yml', ...(major === 18 ? ['-f', 'deploy/compose.postgres18.yml'] : []), ...(database === 'firestore' ? ['-f', 'deploy/compose.firestore.yml'] : []), 'config', '--format', 'json'];
    const result = spawnSync(executable, args, { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30000, maxBuffer: 4 * 1024 * 1024 });
    assert.equal(result.status, 0, 'Compose configuration failed; expanded configuration is deliberately not logged.');
    const errors = composeConfigErrors(JSON.parse(result.stdout), { database, proxy });
    assert.deepEqual(errors, [], `Compose configuration ${database}-${proxy}${major ? `-${major}` : ''} failed: ${errors.join('; ')}`);
    scenarios.push({ database, ...(major ? { major } : {}), proxy, status: 'passed' });
  }
  const report = { generatedAt: new Date().toISOString(), composeVersion: version.stdout.trim(), status: 'passed', scenarios, assertions: ['exactly one authoritative database profile and proxy', 'internal ports not published', 'database administrator and recovery keys excluded from application containers', 'no application secrets in web, PDF, analyzer or scanner containers', 'all capabilities dropped, no-new-privileges and read-only root for api, worker, web, PDF, analyzer and scanner', 'web cannot access database/queue network', 'PDF has no network; analyzer has isolated egress', 'scanner reachable only from the API over an internal network, runs as non-root', 'PostgreSQL WAL archived to a separate volume', 'staff MFA enabled; outbound workers initially disabled', 'queue password configured', 'Firestore credentials mounted read-only into API/worker only'], limitations: 'Compose parsing and configuration assertions only. No Docker Engine, containers, TLS host, Linux firewall or remote database was exercised.' };
  await mkdir('artifacts/verification', { recursive: true });
  await writeFile(resolve('artifacts/verification/deployment-profiles.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Validated ${scenarios.length} Compose configurations. No containers started and no cloud project contacted.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
