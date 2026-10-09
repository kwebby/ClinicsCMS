<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Develop ClinicsCMS

Use an isolated installation with fictional data. These native development commands are separate from the [production Compose deployment](INSTALLATION.md). Run them from the repository root; no pre-existing local runtime directory or committed password is required.

## 1. Install source dependencies

Install Git, Node.js 24 and the pinned pnpm version, then:

```sh
git clone https://github.com/kwebby/ClinicsCMS.git
cd ClinicsCMS
npm install --global pnpm@11.22.0
pnpm install --frozen-lockfile
pnpm bootstrap
```

`bootstrap` creates private `.env` encryption and setup secrets from `.env.example`; it does not create a SQL database, start services or create users. It leaves an existing `.env` untouched. Configure `.env` privately before starting the API.

## 2. Supply the local services

Provide PostgreSQL 17/18 or MySQL 8.4, a loopback-only Valkey/Redis-compatible service, and ClamAV. Native package names vary by distribution; install the database server/client and `clamdscan` plus scanner daemon/signature updater from your maintained OS packages. The application uses `clamdscan`, not an unmaintained fake scanner stub.

For example, after installing and starting PostgreSQL on Ubuntu, create a dedicated non-superuser and disposable development database interactively:

```sh
sudo -u postgres createuser --pwprompt clinic_dev
sudo -u postgres createdb --owner=clinic_dev clinic_dev
```

`--pwprompt` keeps the chosen password out of shell history. Configure the resulting URL in `.env`; URL-encode reserved characters in credentials. Adapt the administrative invocation for your OS rather than making the app use the PostgreSQL superuser. For MySQL, create a dedicated user with privileges on one development database and set `DATABASE_DRIVER=mysql` and its URL.

Key development settings, shown as examples rather than a complete environment file:

```dotenv
NODE_ENV=development
API_HOST=127.0.0.1
API_PORT=4000
PUBLIC_URL=http://localhost:3000
ALLOWED_ORIGINS=http://localhost:3000
API_INTERNAL_URL=http://127.0.0.1:4000
TRUST_PROXY_HOPS=0
DATABASE_DRIVER=postgres
DATABASE_URL=postgresql://clinic_dev:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/clinic_dev
REDIS_URL=redis://127.0.0.1:6379
PRIVATE_STORAGE_ROOT=.runtime/files
ORGANIZATION_ID=clinic-dev
INSTALLATION_ID=clinic-dev
REQUIRE_STAFF_MFA=true
OUTBOUND_WORKERS_ENABLED=false
PDF_RENDERER_SOCKET=
ANALYZER_SOCKET=
```

Retain the generated `APP_ENCRYPTION_KEY` and `BOOTSTRAP_TOKEN`. Change `REDIS_URL` to include your queue credentials where required. Keep local services bound to loopback. Do not substitute the Docker DNS names `postgres` or `valkey` when Node is running directly on the host.

Use `CLAMD_CONFIG=/absolute/path/to/clamd.conf` when the scanner client needs an explicit configuration. Ensure the daemon is reachable and has current signatures. A basic health check is to scan a harmless temporary file with `clamdscan --stream`; use the same configuration option as the app. No scanner means no successful attachment, public-image, or theme import.

Install Chromium for PDF generation and browser verification:

```sh
pnpm exec playwright install chromium
```

On Linux, install missing browser libraries using `pnpm exec playwright install-deps chromium` with the required OS privileges. Production uses the isolated PDF image; native development without a socket renders locally and is not equivalent containment evidence.

## 3. Start the application

Terminal one:

```sh
pnpm dev
```

This starts API watch mode on port 4000 and the Next development server on port 3000. The web server's default internal API URL is loopback port 4000. For a different API port, pass `API_INTERNAL_URL` to the web process explicitly. The API creates its initial SQL tables on startup; no separate migration command is currently needed.

Terminal two, after configuring any intended test email/payment/AI destinations:

```sh
pnpm worker
```

The worker starts separately; `pnpm dev` does not include it. With `OUTBOUND_WORKERS_ENABLED=false`, it does not dispatch jobs or scheduled reminders. Enable delivery only for controlled test recipients/providers. SMTP configuration tests can send directly even with queued delivery disabled.

Open `http://localhost:3000/setup` to create your own owner account and enroll MFA. Alternatively, for a **new empty database**, seed the fictional demonstration before creating any account:

```sh
DEMO_SEED=true pnpm seed:demo
```

The seeder writes generated credentials to private `.runtime/demo-access.json` with mode `0600`; it does not print them or use a universal password. The fictional owner, doctor, reception, and patient accounts use reserved `example.test` emails. Read credentials locally in your editor. Seeding refuses a nonempty installation or `NODE_ENV=production`.

For the existing browser test fixture, set `REQUIRE_STAFF_MFA=false` **only in this isolated fictional development environment** and restart API. Manual development can keep MFA enabled. Production cannot disable it.

## 4. Build and run the standalone output

```sh
pnpm typecheck
pnpm test
node scripts/sync-website-fonts.mjs --verify
API_INTERNAL_URL=http://127.0.0.1:4000 NEXT_TELEMETRY_DISABLED=1 pnpm build
```

Build outputs:

- `dist/apps/api/src/main.js` and `dist/apps/worker/src/main.js`, with shared packages under `dist/packages`.
- `apps/web/.next/standalone/apps/web/server.js`, plus copied `public` and `.next/static` assets.

`pnpm build` runs API/shared TypeScript compilation and the web build. The web package automatically runs `scripts/prepare-web.mjs`, which copies static assets into the standalone output. Do not omit this step when invoking `next build` manually.

Stop development processes using the same ports before launching compiled processes. In separate terminals, from the root:

```sh
pnpm start:api
```

```sh
pnpm start:worker
```

```sh
HOSTNAME=127.0.0.1 PORT=3000 API_INTERNAL_URL=http://127.0.0.1:4000 NEXT_TELEMETRY_DISABLED=1 pnpm --filter @clinic/web start
```

This can serve a compiled UI against a fictional development API. It is not a native production deployment recipe: production also needs HTTPS, mandatory MFA, process supervision, isolated PDF/analyzer workers, backups, and the security boundaries implemented by the supplied containers.

## Tests and what they establish

```sh
pnpm typecheck
pnpm test
pnpm test:contracts
```

Without explicit external targets, contract tests run against memory. The HTTP authentication suite skips when `REDIS_TEST_URL` is absent. To include it, provide an isolated queue target:

```sh
REDIS_TEST_URL=redis://127.0.0.1:6379 pnpm test
```

Review the reported skipped count rather than equating a green partial run with full certification. The auth tests use randomized namespaces but the queue should still be dedicated to synthetic testing.

### SQL/Firestore contracts

Create a separate empty test database, such as `clinic_cert`, with its own credentials. Configure test variables privately in `.env.test.local` or a CI secret store:

```dotenv
DATABASE_TEST_DRIVER=postgres
DATABASE_TEST_URL=postgresql://clinic_test:YOUR_URL_ENCODED_PASSWORD@127.0.0.1:5432/clinic_cert
DATABASE_TEST_EXPECTED_MAJOR=17
DATABASE_TEST_CONFIRM=disposable
```

Load them explicitly; the test profile loader does not automatically read that file:

```sh
node --env-file=.env.test.local --import tsx scripts/certify.ts
```

The certification script writes dated JSON and distinguishes memory/emulator runs from real backends. To use ordinary `pnpm certify` or `pnpm test:contracts`, first inject the same variables into the process through your secret manager/environment. Repeat against PostgreSQL 18, MySQL 8.4, Supabase, and real disposable Firestore as required. Do not use the application database as the test target. The [configuration reference](CONFIGURATION.md#test-only-variables) lists Firestore allowlisting and confirmation variables.

### Browser tests

Start API, web, scanner and the other required services against a fresh seeded fictional installation. Install Chromium, keep seeded credentials private, then:

```sh
pnpm test:e2e
```

Playwright does not launch the servers. It defaults to `http://localhost:3000`, runs serially, and writes its report under ignored `test-results`. Test mutations exercise billing, publication, website settings, status transitions, and other real workflows, so use a disposable database. Missing seed credentials cause explicit skips, not successful workflow coverage. A repeat run may need a fresh fixture because prior tests created records.

### Deployment and security checks

```sh
pnpm deploy:verify
pnpm audit --prod --audit-level=high
```

`deploy:verify` parses all supported Compose combinations and checks the configured service boundaries; it does not start containers. CI adds SQL service jobs, dependency/license checks, secret/source/container scanning, an application image build, and an SBOM. Real cloud profiles require explicit disposable projects and protected CI secrets. See [release gates](security/RELEASE-GATES.md) for tests that cannot be replaced by local unit success.

## Repository map and extension points

| Path | Responsibility |
|---|---|
| `apps/api/src` | Nest controllers, auth, integrations and runtime composition |
| `apps/web/app` | Next routes, metadata, public/private surfaces |
| `apps/web/components` | Workspace forms/tables/planning views and public renderer |
| `apps/worker/src` | Durable outbox execution and scheduling |
| `packages/contracts/src` | Shared domain, website and provider contracts |
| `packages/core/src` | Validation, authorization and transactional business rules |
| `packages/persistence/src` | SQL, Firestore and test-only memory adapters |
| `packages/platform/src` | Themes, files, SEO, AI, PDF/analyzer and transfer infrastructure |
| `scripts` | Bootstrap, configuration, builds, certification, export/import and font maintenance |
| `deploy` | Images, proxy/database profiles, Firebase rules/indexes and egress policy |
| `tests` | Domain/platform/API/adapter/browser verification |

Read the installed Next.js documentation (`apps/web/node_modules/next/dist/docs/`) when changing web architecture; this Next.js version differs from older releases. Keep server credentials out of web code; API authorization must protect each action, file and socket, not only visible navigation. New database features need parity contracts rather than SQL-only assumptions. External effects belong after transaction commit in durable work with idempotency controls.

New themes use the documented declarative format and scanned assets. Extending the trusted renderer or adding a new application-owned section requires a source change and review; a theme ZIP is not an executable plugin. Preserve the author's comment on main first-party files and preserve third-party licenses unchanged.

## Useful troubleshooting

| Symptom | Check |
|---|---|
| API exits at startup | SQL/queue availability, valid 32-byte key, maintenance marker, configured driver |
| Browser shows unavailable site or API errors | API port, `API_INTERNAL_URL`, web build-time rewrite destination, origin spelling |
| Auth/CSRF rejection on localhost | Use the same hostname and port in browser, `PUBLIC_URL`, and `ALLOWED_ORIGINS`; `localhost` and `127.0.0.1` are different origins |
| Upload/theme import fails | Running scanner, current definitions, `CLAMD_CONFIG`, file type/size and permissions |
| PDF fails | Matching Playwright Chromium installation, required OS libraries, valid socket if configured |
| Queued email never sends | Separate worker running, outbound flag, SMTP TLS configuration, failed-job queue |
| Website save is not live | Save stages a draft; use website preview/publication to create the immutable live binding |
| Font missing after build | Verify bundled font manifest and run the normal web build/asset-copy step |
| Rate limit during repeated tests | Allow the configured window to expire and use the existing test pacing; do not weaken production limits |
