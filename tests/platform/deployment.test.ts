/* Author: ramanpal singh | URL: https://kwebby.com */
import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { composeConfigErrors, createDeploymentEnvironment, validateCertificate, validateDeploymentEnvironment, type ComposeConfig } from '../../scripts/deployment-config.js';
import { RESTRICTED_IPV4_CIDRS } from '../../packages/platform/src/tools.js';

const root = join(import.meta.dirname, '../..');
const read = (path: string) => readFileSync(join(root, path), 'utf8');
const available = (command: string) => spawnSync('sh', ['-c', `command -v ${command}`]).status === 0;
function scratch<T>(run: (dir: string) => T): T { const dir = mkdtempSync(join(tmpdir(), 'clinic-deploy-test-')); try { return run(dir); } finally { rmSync(dir, { recursive: true, force: true }); } }

describe('production deployment configuration', () => {
  const fresh = () => createDeploymentEnvironment({ domain: 'clinic.example.org', database: 'postgres', proxy: 'nginx' });
  it('creates independent secrets and disabled outbound workers for a fresh installation', () => {
    const env = fresh();
    expect(validateDeploymentEnvironment(env)).toEqual([]);
    expect(env.OUTBOUND_WORKERS_ENABLED).toBe('false');
    expect(new Set([env.DATABASE_PASSWORD, env.POSTGRES_ADMIN_PASSWORD, env.MYSQL_ROOT_PASSWORD, env.VALKEY_PASSWORD, env.BOOTSTRAP_TOKEN]).size).toBe(5);
    expect(env.APP_ENCRYPTION_KEY).not.toBe(fresh().APP_ENCRYPTION_KEY);
  });
  it('rejects role, origin, profile, queue and maintenance misconfiguration without echoing secrets', () => {
    const env: Record<string, string> = { ...fresh(), PUBLIC_URL: 'http://clinic.example.org', REQUIRE_STAFF_MFA: 'false', COMPOSE_PROFILES: 'postgres,mysql,nginx,apache', MAINTENANCE_MODE: 'true', OUTBOUND_WORKERS_ENABLED: 'true' };
    env.DATABASE_URL = env.DATABASE_URL.replace('clinic:', 'postgres:');
    env.VALKEY_PASSWORD = 'private-invalid-value';
    const errors = validateDeploymentEnvironment(env);
    expect(errors.length).toBeGreaterThanOrEqual(7);
    expect(JSON.stringify(errors)).not.toContain('private-invalid-value');
    expect(JSON.stringify(errors)).not.toContain(env.DATABASE_PASSWORD);
  });
  it('generates MySQL/Apache configuration and leaves remote credentials explicitly pending', () => {
    expect(validateDeploymentEnvironment(createDeploymentEnvironment({ domain: 'clinic.example.org', database: 'mysql', proxy: 'apache' }))).toEqual([]);
    const supabase = createDeploymentEnvironment({ domain: 'clinic.example.org', database: 'supabase', proxy: 'nginx' });
    expect(validateDeploymentEnvironment(supabase)).toContain('Configure DATABASE_URL for the remote Supabase project before deployment.');
    supabase.DATABASE_URL = 'postgresql://clinic:synthetic@db.example.org:5432/clinic?sslmode=require';
    expect(validateDeploymentEnvironment(supabase).join(' ')).toContain('verify-full');
    supabase.DATABASE_URL = supabase.DATABASE_URL.replace('require', 'verify-full');
    expect(validateDeploymentEnvironment(supabase)).toEqual([]);
    const firestore = createDeploymentEnvironment({ domain: 'clinic.example.org', database: 'firestore', proxy: 'apache' });
    expect(validateDeploymentEnvironment(firestore).length).toBe(2);
    expect(validateDeploymentEnvironment({ ...firestore, FIREBASE_PROJECT_ID: 'clinic-test-project', FIREBASE_CREDENTIALS_FILE: '/private/firebase.json', FIRESTORE_EMULATOR_HOST: 'localhost:8080' }).join(' ')).toContain('emulator');
  });
  it('rejects configuration injection through a domain value', () => {
    expect(() => createDeploymentEnvironment({ domain: 'clinic.example.org\nREQUIRE_STAFF_MFA=false', database: 'postgres', proxy: 'nginx' })).toThrow();
  });
});

describe('rendered Compose policy', () => {
  const hardened = { cap_drop: ['ALL'], security_opt: ['no-new-privileges:true'], read_only: true };
  const app = { REQUIRE_STAFF_MFA: 'true', OUTBOUND_WORKERS_ENABLED: 'false', REDIS_URL: `redis://:${'a'.repeat(64)}@valkey:6379`, DATABASE_URL: 'postgresql://clinic:synthetic@postgres:5432/clinic', APP_ENCRYPTION_KEY: 'synthetic' };
  const config = (): ComposeConfig => ({
    services: {
      api: { ...hardened, environment: { ...app }, networks: { frontend: null, backend: null, egress: null, scanner: null }, volumes: [{ type: 'volume', source: 'files', target: '/data' }] },
      worker: { ...hardened, environment: { ...app }, networks: { backend: null, egress: null } },
      web: { ...hardened, environment: { PUBLIC_URL: 'https://clinic.example.org' }, networks: { frontend: null } },
      'pdf-worker': { ...hardened, network_mode: 'none', environment: { NODE_ENV: 'production', PDF_CHROMIUM_SANDBOX: 'false' }, volumes: [{ type: 'volume', source: 'pdf-socket', target: '/run/clinic-pdf' }] },
      'analyzer-worker': { ...hardened, environment: { NODE_ENV: 'production' }, networks: { 'analyzer-egress': null }, volumes: [{ type: 'volume', source: 'analyzer-socket', target: '/run/clinic-analyzer' }] },
      clamav: { ...hardened, user: 'clamav', networks: { scanner: null, 'scanner-egress': null }, volumes: [{ type: 'volume', source: 'clamav', target: '/var/lib/clamav' }] },
      valkey: { networks: { backend: null } },
      postgres: { environment: { POSTGRES_USER: 'postgres' }, command: ['postgres', '-c', 'archive_command=test ! -f /wal-archive/%f && cp %p /wal-archive/%f'], volumes: [{ type: 'volume', source: 'postgres', target: '/var/lib/postgresql/data' }, { type: 'volume', source: 'postgres-wal', target: '/wal-archive' }], networks: { backend: null } },
      nginx: { ports: [{ target: 443, published: '443' }], networks: { frontend: null, egress: null } },
    },
    networks: { frontend: { internal: true }, backend: { internal: true }, scanner: { internal: true }, egress: {} },
  });
  const options = { database: 'postgres', proxy: 'nginx' } as const;
  it('accepts the intended topology', () => expect(composeConfigErrors(config(), options)).toEqual([]));
  it('rejects secrets in isolated workers and missing container hardening', () => {
    const cases: [(value: ComposeConfig) => void, string][] = [
      [value => { value.services['pdf-worker'].environment!.DATABASE_URL = 'x'; }, 'pdf-worker receives application secret DATABASE_URL'],
      [value => { value.services['analyzer-worker'].environment!.APP_ENCRYPTION_KEY = 'x'; }, 'analyzer-worker receives application secret APP_ENCRYPTION_KEY'],
      [value => { value.services.clamav.environment = { REDIS_URL: 'x' }; }, 'clamav receives application secret REDIS_URL'],
      [value => { value.services['pdf-worker'].volumes!.push({ type: 'volume', source: 'files', target: '/data' }); }, 'pdf-worker mounts more than its dedicated volume'],
      [value => { delete value.services.clamav.cap_drop; }, 'clamav must drop all capabilities'],
      [value => { value.services['analyzer-worker'].cap_add = ['NET_RAW']; }, 'analyzer-worker must drop all capabilities'],
      [value => { value.services.web.security_opt = []; }, 'web must set no-new-privileges'],
      [value => { value.services.clamav.read_only = false; }, 'clamav must use a read-only root filesystem'],
      [value => { value.services.clamav.user = 'root'; }, 'clamav must run as a non-root user'],
      [value => { value.services.clamav.networks = { backend: null, egress: null }; }, 'clamav must only join the scanner and scanner-egress networks'],
      [value => { value.services.worker.networks!.scanner = null; }, 'only api may reach the scanner network'],
      [value => { value.networks!.scanner = {}; }, 'scanner network must be internal'],
      [value => { value.services.postgres.volumes = [{ type: 'volume', source: 'postgres', target: '/var/lib/postgresql/data' }]; }, 'postgres must archive WAL to its own volume'],
      [value => { value.services.api.environment!.POSTGRES_ADMIN_PASSWORD = 'x'; }, 'api receives an administrator/recovery secret'],
      [value => { value.services.valkey.ports = [{ target: 6379 }]; }, 'valkey exposes an internal port'],
      [value => { delete value.services['pdf-worker']; }, 'pdf-worker service is missing'],
    ];
    for (const [mutate, message] of cases) { const value = config(); mutate(value); expect(composeConfigErrors(value, options), message).toContain(message); }
    expect(JSON.stringify(composeConfigErrors((() => { const value = config(); value.services['pdf-worker'].environment!.DATABASE_URL = 'postgresql://clinic:never-print@db'; return value; })(), options))).not.toContain('never-print');
  });
});

describe('analyzer egress firewall', () => {
  it('rejects exactly the address blocks the application rejects', () => {
    expect(read('deploy/analyzer-firewall.sh').match(/for destination in ([^;]+); do/)![1].trim().split(/\s+/)).toEqual([...RESTRICTED_IPV4_CIDRS]);
  });
  it('allows DNS only to configured resolvers ahead of private-range rejects and closes host INPUT', () => scratch(dir => {
    writeFileSync(join(dir, 'iptables'), '#!/bin/sh\necho "$*" >> "$FAKE_LOG"\n[ "$1" = -C ] && exit 1\nexit 0\n', { mode: 0o755 });
    const run = (resolvers: string) => spawnSync('sh', [join(root, 'deploy/analyzer-firewall.sh')], { env: { ...process.env, PATH: `${dir}:${process.env.PATH}`, FAKE_LOG: join(dir, 'log'), ANALYZER_DNS_SERVERS: resolvers }, encoding: 'utf8' });
    expect(run('10.0.0.2,1.1.1.1').status).toBe(0);
    const rules = readFileSync(join(dir, 'log'), 'utf8').trim().split('\n');
    const at = (rule: string) => { const index = rules.indexOf(rule); expect(index, rule).toBeGreaterThanOrEqual(0); return index; };
    expect(at('-A CLINIC_ANALYZER -d 10.0.0.2 -p udp --dport 53 -j RETURN')).toBeLessThan(at('-A CLINIC_ANALYZER -d 10.0.0.0/8 -j REJECT'));
    expect(at('-A CLINIC_ANALYZER -d 1.1.1.1 -p tcp --dport 53 -j RETURN')).toBeLessThan(at('-A CLINIC_ANALYZER -p tcp -m multiport --dports 80,443 -j RETURN'));
    expect(rules.filter(rule => rule.includes('--dport 53') && rule.includes('CLINIC_ANALYZER '))).toHaveLength(4);
    expect(at('-A CLINIC_ANALYZER_INPUT -d 10.0.0.2 -p udp --dport 53 -j RETURN')).toBeLessThan(at('-A CLINIC_ANALYZER_INPUT -j REJECT'));
    at('-I DOCKER-USER 1 -s 172.30.240.0/28 -j CLINIC_ANALYZER'); at('-I INPUT 1 -s 172.30.240.0/28 -j CLINIC_ANALYZER_INPUT');
    rmSync(join(dir, 'log'));
    const invalid = run('1.1.1.1;reboot');
    expect(invalid.status).toBe(1); expect(invalid.stderr).toContain('Invalid resolver'); expect(readdirSync(dir)).not.toContain('log');
  }));
});

describe('reverse proxy and image build hygiene', () => {
  it('repeats every server-level security header in nginx locations that add headers, as Apache inherits them', () => {
    const template = read('deploy/nginx/clinic.conf.template'), locations = [...template.matchAll(/location\s+[^{]+\{([^}]*)\}/g)].map(match => match[1]);
    const names = (text: string) => [...text.matchAll(/add_header\s+(\S+)/g)].map(match => match[1]);
    const serverLevel = names(template.replace(/location\s+[^{]+\{[^}]*\}/g, ''));
    expect(serverLevel).toEqual(expect.arrayContaining(['Strict-Transport-Security', 'X-Content-Type-Options', 'Referrer-Policy', 'X-Frame-Options']));
    for (const block of locations.filter(block => names(block).length)) expect(names(block)).toEqual(expect.arrayContaining(serverLevel));
    for (const header of serverLevel) expect(read('deploy/apache/httpd.conf')).toContain(`Header always set ${header}`);
  });
  it('keeps secrets out of the build context and package managers out of runtime images', () => {
    const ignore = read('.dockerignore').split('\n');
    expect(ignore).toEqual(expect.arrayContaining(['**/.env*', '**/*.pem', '**/*.key', 'deploy/certificates', 'deploy/secrets']));
    const stages = Object.fromEntries(read('deploy/Dockerfile').split(/^FROM /m).slice(1).map(stage => [stage.match(/ AS (\S+)/)![1], stage]));
    expect(stages['production-dependencies']).toContain('pnpm install --frozen-lockfile --prod');
    expect(stages.runtime).toMatch(/rm -rf [^\n]*\/usr\/local\/lib\/node_modules[^\n]*\/usr\/local\/bin\/corepack/);
    for (const name of ['application', 'web', 'pdf']) { expect(stages[name].startsWith('runtime AS')).toBe(true); expect(stages[name]).not.toMatch(/\b(pnpm|corepack|npm|npx|yarn)\b/); expect(stages[name]).not.toMatch(/--from=build[^\n]*node_modules/); }
  });
});

describe('TLS certificate preflight', () => {
  it.skipIf(!available('openssl'))('requires the hostname, the matching key and at least seven days of validity', () => scratch(dir => {
    const issue = (name: string, host: string) => { const result = spawnSync('openssl', ['req', '-x509', '-newkey', 'ec', '-pkeyopt', 'ec_paramgen_curve:prime256v1', '-nodes', '-days', '30', '-subj', `/CN=${host}`, '-addext', `subjectAltName=DNS:${host}`, '-keyout', join(dir, `${name}.key`), '-out', join(dir, `${name}.crt`)], { encoding: 'utf8' }); expect(result.status, result.stderr).toBe(0); return { cert: readFileSync(join(dir, `${name}.crt`), 'utf8'), key: readFileSync(join(dir, `${name}.key`), 'utf8') }; };
    const site = issue('site', 'clinic.example.org'), other = issue('other', 'other.example.org'), day = 86400000;
    expect(() => validateCertificate(site.cert, site.key, 'clinic.example.org')).not.toThrow();
    expect(() => validateCertificate(site.cert, site.key, 'evil.example.org')).toThrow('hostname or private key');
    expect(() => validateCertificate(site.cert, other.key, 'clinic.example.org')).toThrow('hostname or private key');
    expect(() => validateCertificate(site.cert, site.key, 'clinic.example.org', new Date(Date.now() + 25 * day))).toThrow('seven days');
    expect(() => validateCertificate(site.cert, site.key, 'clinic.example.org', new Date(Date.now() - 2 * day))).toThrow('not yet valid');
    expect(() => validateCertificate('not a certificate', site.key, 'clinic.example.org')).toThrow();
  }));
});

describe('PostgreSQL WAL retention', () => {
  it.skipIf(!available('pg_archivecleanup'))('removes only WAL older than the oldest retained base backup', () => scratch(dir => {
    const segments = ['1', '2', '3', '4', '5', '6', '7', '8'].map(n => `00000001000000000000000${n}`);
    for (const name of [...segments, `${segments[2]}.00000028.backup`, `${segments[6]}.00000060.backup`]) writeFileSync(join(dir, name), '');
    const run = (...args: string[]) => spawnSync('sh', [join(root, 'deploy/postgres/wal-retention.sh'), ...args], { env: { ...process.env, WAL_ARCHIVE_DIR: dir }, encoding: 'utf8' });
    expect(run('--dry-run', '--keep', '1').status).toBe(0); expect(readdirSync(dir)).toHaveLength(10);
    expect(run('../../etc/passwd').status).toBe(2); expect(run('--keep', '0').status).toBe(2);
    expect(run('--keep', '3').stderr).toContain('nothing removed'); expect(readdirSync(dir)).toHaveLength(10);
    expect(run('--keep', '2').status).toBe(0); expect(readdirSync(dir).filter(name => !name.endsWith('.backup'))).toEqual(segments.slice(2));
    expect(run('--keep', '1').status).toBe(0); expect(readdirSync(dir).filter(name => !name.endsWith('.backup'))).toEqual(segments.slice(6));
    expect(readdirSync(dir)).toContain(`${segments[6]}.00000060.backup`);
  }));
});
