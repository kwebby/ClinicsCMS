/* Author: ramanpal singh | URL: https://kwebby.com */
import { describe, it, expect } from 'vitest';
import { createDeploymentEnvironment, validateDeploymentEnvironment } from '../../scripts/deployment-config.js';

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
