/* Author: ramanpal singh | URL: https://kwebby.com */
import { randomBytes, X509Certificate, createPrivateKey } from 'node:crypto';

export type DeploymentEnvironment = Record<string, string>;
export type DeploymentOptions = { domain: string; database: 'postgres' | 'mysql' | 'supabase' | 'firestore'; proxy: 'nginx' | 'apache' };
const secret = () => randomBytes(32).toString('hex');
export function validateDomain(domain: string): void {
  if (domain.length > 253 || !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(domain)) {
    throw new Error('Use a lowercase fully qualified domain without a scheme, path, port or wildcard.');
  }
}
export function createDeploymentEnvironment(options: DeploymentOptions): DeploymentEnvironment {
  validateDomain(options.domain);
  if (!['postgres', 'mysql', 'supabase', 'firestore'].includes(options.database) || !['nginx', 'apache'].includes(options.proxy)) throw new Error('Choose a supported database and proxy.');
  const password = secret();
  return {
    NODE_ENV: 'production', PUBLIC_URL: `https://${options.domain}`, CLINIC_DOMAIN: options.domain,
    ALLOWED_ORIGINS: `https://${options.domain}`, DATABASE_DRIVER: options.database,
    DATABASE_URL: options.database === 'postgres' ? `postgresql://clinic:${password}@postgres:5432/clinic` : options.database === 'mysql' ? `mysql://clinic:${password}@mysql:3306/clinic` : '',
    DATABASE_PASSWORD: password, POSTGRES_ADMIN_PASSWORD: secret(), MYSQL_ROOT_PASSWORD: secret(), VALKEY_PASSWORD: secret(),
    APP_ENCRYPTION_KEY: randomBytes(32).toString('base64'), BOOTSTRAP_TOKEN: secret(),
    ORGANIZATION_ID: 'clinic', INSTALLATION_ID: 'clinic', INSTALLATION_AUDIENCE: 'patient',
    REQUIRE_STAFF_MFA: 'true', REGISTRATION_ENABLED: 'true', OUTBOUND_WORKERS_ENABLED: 'false', MAINTENANCE_MODE: 'false', OPENAPI_ENABLED: 'false',
    AI_ALLOWED_HOSTS: 'api.openai.com', FIREBASE_PROJECT_ID: '', FIREBASE_DATABASE_ID: '(default)', FIREBASE_CREDENTIALS_FILE: '',
    COMPOSE_PROFILES: [options.database === 'postgres' || options.database === 'mysql' ? options.database : '', options.proxy].filter(Boolean).join(','),
  };
}

/** Values never appear in diagnostics; these reports are safe to attach to an operations ticket. */
export function validateDeploymentEnvironment(env: DeploymentEnvironment): string[] {
  const errors: string[] = [];
  const require = (condition: unknown, message: string) => { if (!condition) errors.push(message); };
  try { validateDomain(env.CLINIC_DOMAIN || ''); } catch { errors.push('CLINIC_DOMAIN must be a valid fully qualified domain.'); }
  require(env.NODE_ENV === 'production', 'NODE_ENV must be production.');
  require(env.PUBLIC_URL === `https://${env.CLINIC_DOMAIN}`, 'PUBLIC_URL must be the exact HTTPS origin for CLINIC_DOMAIN.');
  require(env.ALLOWED_ORIGINS === env.PUBLIC_URL, 'ALLOWED_ORIGINS must contain the exact public origin for this deployment.');
  require(env.REQUIRE_STAFF_MFA === 'true', 'Staff MFA must be enabled.');
  require(['true', 'false'].includes(env.OUTBOUND_WORKERS_ENABLED), 'Set OUTBOUND_WORKERS_ENABLED explicitly.');
  require(['true', 'false'].includes(env.MAINTENANCE_MODE), 'Set MAINTENANCE_MODE explicitly.');
  require(!(env.MAINTENANCE_MODE === 'true' && env.OUTBOUND_WORKERS_ENABLED !== 'false'), 'Maintenance mode requires outbound workers to be disabled.');
  require(Buffer.from(env.APP_ENCRYPTION_KEY || '', 'base64').length === 32 && /^[A-Za-z0-9+/]{43}=$/.test(env.APP_ENCRYPTION_KEY || ''), 'APP_ENCRYPTION_KEY must contain a base64-encoded random 32-byte key.');
  require(!env.BOOTSTRAP_TOKEN || /^[a-f0-9]{64,}$/.test(env.BOOTSTRAP_TOKEN), 'BOOTSTRAP_TOKEN must be blank after setup or a random hexadecimal secret of at least 32 bytes.');
  require(/^[a-f0-9]{64,}$/.test(env.VALKEY_PASSWORD || ''), 'VALKEY_PASSWORD must be a random hexadecimal secret of at least 32 bytes.');
  const profiles = (env.COMPOSE_PROFILES || '').split(',').filter(Boolean);
  require(profiles.filter(p => ['nginx', 'apache'].includes(p)).length === 1, 'Choose exactly one proxy profile.');
  require(profiles.every(p => ['nginx', 'apache', 'postgres', 'mysql'].includes(p)), 'COMPOSE_PROFILES contains an unsupported profile.');
  const localProfiles = profiles.filter(p => ['postgres', 'mysql'].includes(p));
  require(localProfiles.length <= 1, 'Choose at most one local database profile.');
  if (['postgres', 'mysql'].includes(env.DATABASE_DRIVER)) {
    require(localProfiles.length === 1 && localProfiles[0] === env.DATABASE_DRIVER, 'The local database profile must match DATABASE_DRIVER.');
    const adminKey = env.DATABASE_DRIVER === 'postgres' ? 'POSTGRES_ADMIN_PASSWORD' : 'MYSQL_ROOT_PASSWORD';
    for (const key of ['DATABASE_PASSWORD', adminKey]) require(/^[a-f0-9]{64,}$/.test(env[key] || ''), `${key} must be an independent random hexadecimal secret of at least 32 bytes.`);
    require(env[adminKey] !== env.DATABASE_PASSWORD && env.DATABASE_PASSWORD !== env.VALKEY_PASSWORD, 'Application, database administrator and queue secrets must be independent.');
    try {
      const url = new URL(env.DATABASE_URL);
      require(url.hostname === env.DATABASE_DRIVER && url.username === 'clinic' && decodeURIComponent(url.password) === env.DATABASE_PASSWORD && url.pathname === '/clinic' && !url.search && !url.hash && (env.DATABASE_DRIVER === 'mysql' ? url.protocol === 'mysql:' && url.port === '3306' : ['postgres:', 'postgresql:'].includes(url.protocol) && url.port === '5432'), 'DATABASE_URL must use the restricted clinic account and the selected local database service.');
    } catch { errors.push('DATABASE_URL is invalid.'); }
  } else if (env.DATABASE_DRIVER === 'supabase') {
    require(localProfiles.length === 0, 'Supabase must not enable a local database profile.');
    try {
      const url = new URL(env.DATABASE_URL);
      require(['postgres:', 'postgresql:'].includes(url.protocol) && !!url.username && !!url.password && url.pathname.length > 1 && url.searchParams.get('sslmode') === 'verify-full', 'Supabase requires a PostgreSQL URL with credentials and sslmode=verify-full.');
    } catch { errors.push('Configure DATABASE_URL for the remote Supabase project before deployment.'); }
  } else if (env.DATABASE_DRIVER === 'firestore') {
    require(localProfiles.length === 0, 'Firestore must not enable a local database profile.');
    require(/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(env.FIREBASE_PROJECT_ID || ''), 'Configure a valid FIREBASE_PROJECT_ID before deployment.');
    require((env.FIREBASE_CREDENTIALS_FILE || '').startsWith('/'), 'FIREBASE_CREDENTIALS_FILE must be an absolute host path.');
    require(!env.DATABASE_URL, 'Clear DATABASE_URL when Firestore is authoritative.');
    require(!env.FIRESTORE_EMULATOR_HOST, 'A Firestore emulator cannot be used in production.');
  } else errors.push('Choose DATABASE_DRIVER=postgres|mysql|supabase|firestore.');
  return errors;
}
export function validateCertificate(certificatePem: string, keyPem: string, domain: string, at = new Date()): void {
  const certificate = new X509Certificate(certificatePem);
  if (!certificate.checkHost(domain) || !certificate.checkPrivateKey(createPrivateKey(keyPem))) throw new Error('TLS certificate hostname or private key does not match.');
  if (Date.parse(certificate.validFrom) > at.getTime() || Date.parse(certificate.validTo) < at.getTime() + 7 * 86400000) throw new Error('TLS certificate is not yet valid or expires in less than seven days.');
}

export type ComposeVolume = { type?: string; source?: string; target?: string; read_only?: boolean };
export type ComposeService = { environment?: Record<string, string | null>; networks?: Record<string, unknown>; network_mode?: string; ports?: unknown[]; volumes?: ComposeVolume[]; cap_drop?: string[]; cap_add?: string[]; security_opt?: string[]; read_only?: boolean; user?: string; command?: unknown };
export type ComposeConfig = { services: Record<string, ComposeService>; networks?: Record<string, { internal?: boolean } | null> };
/** Values that let a process act as the clinic application, or administer/restore its stores. */
export const APPLICATION_SECRETS = ['DATABASE_URL', 'DATABASE_PASSWORD', 'APP_ENCRYPTION_KEY', 'BOOTSTRAP_TOKEN', 'REDIS_URL', 'VALKEY_PASSWORD', 'GOOGLE_APPLICATION_CREDENTIALS', 'FIREBASE_CREDENTIALS_FILE', 'POSTGRES_ADMIN_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'DATA_TRANSFER_KEY'] as const;
const ADMIN_SECRETS = ['POSTGRES_ADMIN_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'DATA_TRANSFER_KEY'];
/** Services that must drop every capability, forbid privilege escalation and run with a read-only root filesystem. */
export const HARDENED_SERVICES = ['api', 'worker', 'web', 'pdf-worker', 'analyzer-worker', 'clamav'] as const;

/** Checks the output of `docker compose config --format json`. Messages name services and keys only, never values. */
export function composeConfigErrors(config: ComposeConfig, options: Pick<DeploymentOptions, 'database' | 'proxy'>): string[] {
  const errors: string[] = [], services = config.services || {};
  const require = (condition: unknown, message: string) => { if (!condition) errors.push(message); };
  const env = (name: string) => services[name]?.environment || {};
  const networks = (name: string) => Object.keys(services[name]?.networks || {}).sort();
  const onlyVolumes = (name: string, targets: string[]) => require((services[name]?.volumes || []).every(volume => volume.type !== 'bind' && targets.includes(volume.target || '')), `${name} mounts more than its dedicated volume`);
  require(services[options.proxy] && !services[options.proxy === 'nginx' ? 'apache' : 'nginx'], 'Exactly the selected proxy must be enabled.');
  require(!!services.postgres === (options.database === 'postgres') && !!services.mysql === (options.database === 'mysql'), 'Exactly the selected local database profile must be enabled.');
  for (const [name, service] of Object.entries(services)) {
    if (name !== options.proxy) require(!service.ports?.length, `${name} exposes an internal port`);
    if (['api', 'worker', 'web', 'analyzer-worker', 'pdf-worker', 'clamav'].includes(name)) for (const forbidden of ADMIN_SECRETS) require(!(forbidden in env(name)), `${name} receives an administrator/recovery secret`);
  }
  for (const name of ['web', 'pdf-worker', 'analyzer-worker', 'clamav']) if (services[name]) for (const secret of APPLICATION_SECRETS) require(!(secret in env(name)), `${name} receives application secret ${secret}`);
  for (const name of HARDENED_SERVICES) {
    const service = services[name];
    if (!service) { errors.push(`${name} service is missing`); continue; }
    require(service.cap_drop?.includes('ALL') && !service.cap_add?.length, `${name} must drop all capabilities`);
    require(service.security_opt?.some(option => /^no-new-privileges(:true|=true)?$/.test(option)), `${name} must set no-new-privileges`);
    require(service.read_only === true, `${name} must use a read-only root filesystem`);
  }
  require(!networks('web').includes('backend') && !networks(options.proxy).includes('backend'), 'web and proxy must not join the database/queue network');
  require(services['pdf-worker']?.network_mode === 'none', 'pdf-worker must have no network');
  onlyVolumes('pdf-worker', ['/run/clinic-pdf']);
  require(networks('analyzer-worker').join() === 'analyzer-egress', 'analyzer-worker must only use analyzer-egress');
  onlyVolumes('analyzer-worker', ['/run/clinic-analyzer']);
  require(networks('clamav').join() === 'scanner,scanner-egress', 'clamav must only join the scanner and scanner-egress networks');
  require(config.networks?.scanner?.internal === true, 'scanner network must be internal');
  require(networks('api').includes('scanner') && Object.entries(services).every(([name]) => ['api', 'clamav'].includes(name) || !networks(name).includes('scanner')), 'only api may reach the scanner network');
  require(services.clamav?.user && !/^(root|0)(:|$)/.test(services.clamav.user), 'clamav must run as a non-root user');
  onlyVolumes('clamav', ['/var/lib/clamav']);
  require(env('api').REQUIRE_STAFF_MFA === 'true', 'api must require staff MFA');
  require(env('worker').OUTBOUND_WORKERS_ENABLED === 'false', 'worker must start with outbound delivery disabled');
  require(/^redis:\/\/:[a-f0-9]{64}@valkey:6379$/.test(env('api').REDIS_URL || ''), 'api queue URL must carry the generated Valkey password');
  if (services.postgres) {
    require(env('postgres').POSTGRES_USER === 'postgres', 'postgres administrator must be the separate postgres role');
    const volumes = services.postgres.volumes || [], archive = volumes.find(volume => volume.target === '/wal-archive');
    require(archive?.type === 'volume' && archive.source !== volumes.find(volume => volume.target === '/var/lib/postgresql/data')?.source && JSON.stringify(services.postgres.command || '').includes('/wal-archive/'), 'postgres must archive WAL to its own volume');
  }
  if (options.database === 'firestore') for (const name of ['api', 'worker']) require(services[name]?.volumes?.some(volume => volume.target === '/run/secrets/firebase.json' && volume.read_only), `${name} must mount Firestore credentials read-only`);
  return errors;
}
