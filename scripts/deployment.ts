/* Author: ramanpal singh | URL: https://kwebby.com */
import { readFile, writeFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { parse } from 'dotenv';
import { createDeploymentEnvironment, validateDeploymentEnvironment, validateCertificate, type DeploymentOptions } from './deployment-config.js';

const args = process.argv.slice(2), command = args.shift();
const value = (name: string, fallback: string) => { const index = args.indexOf(name); if (index < 0) return fallback; if (!args[index + 1] || args[index + 1].startsWith('--')) throw new Error(`${name} needs a value.`); return args[index + 1]; };
try {
  const file = resolve(value('--env', '.env.production.local'));
  if (command === 'init') {
    const env = createDeploymentEnvironment({ domain: value('--domain', ''), database: value('--database', 'postgres'), proxy: value('--proxy', 'nginx') } as DeploymentOptions);
    const text = '# Author: Ramanpal Singh | https://kwebby.com\n# Private production configuration. Keep mode 0600; never commit or attach this file.\n' + Object.entries(env).map(([key, val]) => `${key}=${val}`).join('\n') + '\n';
    await writeFile(file, text, { mode: 0o600, flag: 'wx' });
    console.log(`Created ${file}. Existing configuration is never overwritten. Configure certificates and any remote database credentials, then run deploy:check.`);
  } else if (command === 'check') {
    const env = parse(await readFile(file)), errors = validateDeploymentEnvironment(env);
    if (((await stat(file)).mode & 0o077) !== 0) errors.push('The environment file must be readable only by its owner (chmod 600).');
    if (!args.includes('--config-only')) {
      try {
        const keyPath = resolve('deploy/certificates/privkey.pem');
        if (((await stat(keyPath)).mode & 0o077) !== 0) throw new Error('TLS private key must have mode 0600.');
        validateCertificate(await readFile('deploy/certificates/fullchain.pem', 'utf8'), await readFile(keyPath, 'utf8'), env.CLINIC_DOMAIN);
      } catch { errors.push('Install a valid matching TLS certificate/key with the correct hostname, at least seven days validity and private key mode 0600.'); }
      if (env.DATABASE_DRIVER === 'firestore') {
        try {
          const credentials = JSON.parse(await readFile(env.FIREBASE_CREDENTIALS_FILE, 'utf8'));
          // UID 1000 inside API/worker must own/read this 0600 file; do not make it world-readable.
          if (((await stat(env.FIREBASE_CREDENTIALS_FILE)).mode & 0o077) !== 0 || credentials.project_id !== env.FIREBASE_PROJECT_ID || credentials.type !== 'service_account' || !credentials.private_key || !credentials.client_email) throw new Error('Invalid credentials');
        } catch { errors.push('Firestore credential file must be private, valid and match the configured project.'); }
      }
      const composeFiles = ['-f', 'deploy/compose.yml', ...(env.DATABASE_DRIVER === 'firestore' ? ['-f', 'deploy/compose.firestore.yml'] : []), ...(args.includes('--postgres18') ? ['-f', 'deploy/compose.postgres18.yml'] : [])];
      // Explicit file values prevent shell-level credentials/profiles from silently overriding the checked configuration.
      const result = spawnSync('docker', ['compose', '--env-file', file, ...composeFiles, 'config', '--quiet'], { env: { ...process.env, ...env }, encoding: 'utf8', timeout: 30000 });
      if (result.status !== 0) errors.push('Docker Compose validation failed or Docker is unavailable. Run compose config --quiet locally; keep expanded configuration private.');
    }
    if (errors.length) { errors.forEach(error => console.error(`FAIL: ${error}`)); process.exitCode = 1; }
    else console.log(args.includes('--config-only') ? 'Configuration checks passed. Certificates, credentials, containers and host remain unchecked.' : 'Deployment preflight passed. Live host, network containment, provider and recovery certification remain required.');
  } else throw new Error('Use init --domain clinic.example [--database postgres|mysql|supabase|firestore] [--proxy nginx|apache], or check [--env PATH] [--config-only] [--postgres18].');
} catch (error: unknown) {
  console.error(error instanceof Error && 'code' in error ? `Deployment operation failed (${String(error.code)}). No secret values are printed.` : error instanceof Error ? error.message : 'Deployment operation failed.');
  process.exitCode = 1;
}
