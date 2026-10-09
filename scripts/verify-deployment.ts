/* Author: ramanpal singh | URL: https://kwebby.com */
import { mkdtemp, writeFile, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createDeploymentEnvironment, type DeploymentOptions } from './deployment-config.js';

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
    const config = JSON.parse(result.stdout), services = config.services;
    assert(services[proxy] && !services[proxy === 'nginx' ? 'apache' : 'nginx']);
    assert.equal(!!services.postgres, database === 'postgres');
    assert.equal(!!services.mysql, database === 'mysql');
    for (const [name, service] of Object.entries(services) as [string, any][]) {
      if (name !== proxy) assert(!service.ports?.length, `${name} exposes an internal port`);
      if (['api', 'worker', 'web', 'analyzer-worker', 'pdf-worker'].includes(name)) for (const forbidden of ['POSTGRES_ADMIN_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'DATA_TRANSFER_KEY']) assert(!(forbidden in (service.environment || {})), `${name} receives an administrator/recovery secret`);
    }
    for (const secret of ['DATABASE_URL', 'APP_ENCRYPTION_KEY', 'GOOGLE_APPLICATION_CREDENTIALS', 'REDIS_URL']) assert(!(secret in services.web.environment));
    assert(!services.web.networks.backend && !services[proxy].networks.backend);
    assert.equal(services['pdf-worker'].network_mode, 'none');
    assert.deepEqual(Object.keys(services['analyzer-worker'].networks), ['analyzer-egress']);
    assert.equal(services.api.environment.REQUIRE_STAFF_MFA, 'true');
    assert.equal(services.worker.environment.OUTBOUND_WORKERS_ENABLED, 'false');
    assert.match(services.api.environment.REDIS_URL, /^redis:\/\/:[a-f0-9]{64}@valkey:6379$/);
    if (services.postgres) assert.equal(services.postgres.environment.POSTGRES_USER, 'postgres');
    if (database === 'firestore') for (const name of ['api', 'worker']) assert(services[name].volumes.some((v: any) => v.target === '/run/secrets/firebase.json' && v.read_only));
    scenarios.push({ database, ...(major ? { major } : {}), proxy, status: 'passed' });
  }
  const report = { generatedAt: new Date().toISOString(), composeVersion: version.stdout.trim(), status: 'passed', scenarios, assertions: ['exactly one authoritative database profile and proxy', 'internal ports not published', 'database administrator and recovery keys excluded from application containers', 'web cannot access database/queue network', 'PDF has no network; analyzer has isolated egress', 'staff MFA enabled; outbound workers initially disabled', 'queue password configured', 'Firestore credentials mounted read-only into API/worker only'], limitations: 'Compose parsing and configuration assertions only. No Docker Engine, containers, TLS host, Linux firewall or remote database was exercised.' };
  await mkdir('artifacts/verification', { recursive: true });
  await writeFile(resolve('artifacts/verification/deployment-profiles.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(`Validated ${scenarios.length} Compose configurations. No containers started and no cloud project contacted.`);
} finally { await rm(scratch, { recursive: true, force: true }); }
