/* Author: ramanpal singh | URL: https://kwebby.com */
import 'dotenv/config';
import { randomBytes } from 'node:crypto';
import { readFile,writeFile } from 'node:fs/promises';
try{await readFile('.env');console.log('.env already exists. Open /setup to complete the one-time clinic setup.');}
catch{const template=await readFile('.env.example','utf8');await writeFile('.env',template.replace('GENERATE_BASE64_32_BYTES',randomBytes(32).toString('base64')).replace('GENERATE_BOOTSTRAP_TOKEN',randomBytes(32).toString('hex')),{mode:0o600});console.log('Created .env with private encryption/bootstrap secrets. Configure database, queue, public origin and storage, then open /setup.');}
