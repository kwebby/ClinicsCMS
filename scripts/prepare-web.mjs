/* Author: ramanpal singh | URL: https://kwebby.com */
import { cp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const web = fileURLToPath(new URL('../apps/web', import.meta.url));
const destination = join(web, '.next/standalone/apps/web');
await cp(join(web, 'public'), join(destination, 'public'), { recursive: true });
await cp(join(web, '.next/static'), join(destination, '.next/static'), { recursive: true });
console.log('Standalone web server includes public and static assets.');
