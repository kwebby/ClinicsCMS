<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS

A self-hosted outpatient clinic platform built with NestJS 12, Next.js 16, React 19, BlockNote, and Node.js 24 LTS. One installation serves a clinic or clinic group using one authoritative database.

**Status: implementation candidate; not approved for a real-patient pilot.** Verification commands generate local reports in ignored artifact directories. A full release additionally requires real Supabase/Firestore certification, target Linux/proxy deployments, provider sandbox checks, recovery/performance evidence, clinic acceptance, and an independent penetration test. See the [implementation and verification record](docs/IMPLEMENTATION-STATUS.md) and [release gates](docs/security/RELEASE-GATES.md).

## Start here

ClinicsCMS is published at [kwebby/ClinicsCMS](https://github.com/kwebby/ClinicsCMS) under the [MIT license](LICENSE). Author: **ramanpal singh** — [kwebby.com](https://kwebby.com).

```sh
git clone https://github.com/kwebby/ClinicsCMS.git
cd ClinicsCMS
corepack enable
corepack prepare pnpm@11.22.0 --activate
pnpm install --frozen-lockfile
pnpm bootstrap
```

Use Node.js 24 LTS. Before starting, configure the generated private `.env` with a reachable database, Valkey/Redis, private file storage, ClamAV and the public origin. Then run `pnpm dev` and open `http://localhost:3000/setup` to create the installation owner using the one-time bootstrap token. `pnpm dev` starts the API and web application; it does not install external services or start the outbound worker. The [development guide](docs/DEVELOPMENT.md) covers the complete local workflow, optional fictional demo data and tests.

For Linux hosting, follow the [installation guide](docs/INSTALLATION.md) for Docker Compose, HTTPS, database initialization, scanning, isolated workers and first-owner setup. The repository does not include credentials or a populated clinic database.

## Documentation

| Guide | What it covers |
| --- | --- |
| [Installation](docs/INSTALLATION.md) | Ubuntu/CentOS Stream preparation, PostgreSQL/MySQL/Supabase/Firestore, Nginx/Apache, first setup and upgrades |
| [Dependencies](docs/DEPENDENCIES.md) | Runtime, package versions, services and development tools |
| [Configuration](docs/CONFIGURATION.md) | Environment variables, credentials, SMTP, providers and production settings |
| [Development](docs/DEVELOPMENT.md) | Fresh-clone development, builds, demo data, checks and troubleshooting |
| [Architecture and custom modules](docs/ARCHITECTURE.md) | Repository structure, API/domain/persistence boundaries and extending the application |
| [Theme development](docs/THEME-DEVELOPMENT.md) | Manifest, tokens, layouts, assets, variants, validation, packaging, upload and rollback |
| [Theme examples](examples/themes/README.md) | Minimal and community starter themes plus ZIP packaging commands |
| [Website settings](docs/WEBSITE-SETTINGS.md) | Editable homepage sections, branding, fonts, NAP, SEO, schemas and social tags |
| [Workspace guide](docs/WORKSPACE.md) | Dedicated pages, status shortcuts, calendar and Kanban workflows |
| [Deployment reference](deploy/README.md) | Compose profiles and service configuration |
| [Recovery](docs/security/RECOVERY.md) | Paired backups, restore checks and safe worker restart |
| [Release gates](docs/security/RELEASE-GATES.md) | Required external certification and production acceptance |

See the [full documentation index](docs/README.md), [contribution guide](CONTRIBUTING.md), and [security policy](SECURITY.md).

## Implemented modules

- **Website settings:** nine recommended homepage slots, 13 editable section types, images/buttons/cards/FAQs, dedicated branding/navigation/location/SEO pages, nine self-hosted Google font families, canonical NAP and generated location pages, matching schema/sitemaps, draft preview and immutable theme publication. See [controls and limitations](docs/WEBSITE-SETTINGS.md) and the [24-clinic research report](artifacts/research/clinic-sites-2026-10/README.md).
- **Workspace navigation:** dedicated create/detail/edit/action/revision pages, inline table status shortcuts, appointment/leave calendars, and appointment/inquiry/task Kanban boards with keyboard and drag-and-drop controls. See [workspace guide](docs/WORKSPACE.md).
- **Care:** patient registration, practitioner availability/leave, transactional booking, walk-ins/arrival queue, intake, observations, BlockNote consultation drafts, signatures/amendments, prescriptions, referrals, result ownership/coverage/review/contact/action/release, and assigned tasks.
- **Patient access:** verified record links, appointment requests/bookings, intake submission, service conversations, released records/documents, balances, and provider checkout initiation. Patients cannot assign themselves staff roles or infer family identity from a shared phone/email.
- **Business:** inquiry CRM and contact history; participant-scoped staff/patient chat; service catalogues; decimal-based invoices, numbering, tax/discounts, partial payments, credits, manual/gateway refunds, immutable issued snapshots; employee salary structures, pay runs, approval/payment recording, and private payslips.
- **Content:** application-owned BlockNote citation/review blocks, revision/conflict controls, controlled invoice/payslip design, declarative theme ZIP import/export, visual theme designer, scanning/validation, immutable publication and rollback. Themes affect public pages only.
- **Acquisition:** server-rendered clinic pages, page SEO controls, schema presets/validated JSON-LD, canonical URLs/redirects, published translation links, sitemap index, Open Graph/X cards, default share image, reviewed/cited content, and separate patient/vendor planning tools. Public tools provide planning assistance, not diagnosis or treatment.
- **Assistance:** configurable cloud drafting/transcription, per-installation data-use controls, quotas/provenance, and mandatory review. API keys and integration credentials remain server-side and encrypted.
- **Operations:** opaque sessions, staff MFA/recovery codes/revocation, CSRF/origin checks, branch/action permissions, audit records, private scanned files, explicit public image publishing, SMTP configuration/test delivery, durable outbox jobs, notification preferences/quiet hours, reminders and escalations, and encrypted database/file transfer.

Unavailable external integrations fail explicitly. SMTP acceptance is distinct from delivery. A checkout redirect does not mark an invoice paid. Clinical drafts are not released automatically. Country-specific prescribing validation, payroll tax filings, e-prescribing networks, and bank disbursement require separately validated local integrations.

## Architecture

```text
apps/web                  Next.js website, staff workspace and patient portal
apps/api                  NestJS REST API, authentication and Socket.IO gateway
apps/worker               Durable outbox dispatch, reminders and escalations
packages/contracts        Actor, entity, persistence and event contracts
packages/core             Authorization and business state machines
packages/persistence      PostgreSQL/MySQL/Supabase/Firestore adapters and transfer
packages/platform         Safe themes/files/content/SEO/AI/tools/PDF workers
scripts                   Bootstrap, fictional seed, certification and transfer
```

PostgreSQL is the default. Set `DATABASE_DRIVER=postgres|mysql|supabase|firestore`. Supabase uses the PostgreSQL adapter. Firebase uses the official Admin SDK for the complete persistence interface; it does not secretly depend on a SQL database. Firestore is a remote production service, and its emulator is not a self-hosted production replacement.

Repository transactions contain database operations only and may be retried. External work follows committed events. SQL uses transaction locks and bounded deadlock retries; Firestore buffers writes until reads finish and uses transactional guard documents. The schema currently stores versioned module records in a common repository table/collection design; workload sizing and query-index verification are explicit release gates.

Core interfaces are documented in [API contract](docs/API-CONTRACT.md), [domain API](docs/DOMAIN-API.md), and [platform API](docs/PLATFORM-API.md). Set `OPENAPI_ENABLED=true` to expose the local `/api/docs` OpenAPI UI with generated domain input schemas. Turn it off if public documentation is unwanted.

## Production deployment

Use [deployment instructions](deploy/README.md) and the supplied Docker Compose profiles. Choose one Nginx/Apache proxy and one database. Images are pinned. Web receives no database/provider credentials. API/worker use restricted services, private persistent storage, Valkey, ClamAV, an isolated PDF renderer, and a separate restricted-egress website analyzer.

```sh
pnpm deploy:init --domain clinic.example.org --database postgres --proxy nginx
pnpm deploy:check --config-only
pnpm build
# After configuring HTTPS, secrets, certificates and the selected backend:
pnpm deploy:check
docker compose --env-file .env.production.local -f deploy/compose.yml config --quiet
docker compose --env-file .env.production.local -f deploy/compose.yml up -d --build
```

Do not expose the API, database, queue, scanner, or workers directly to the public network. Staff MFA is mandatory in production. Set outbound workers explicitly after configuration; leave them disabled during restoration. Uploaded files fail closed if scanning is unavailable.

## Verification

```sh
pnpm typecheck
pnpm test
pnpm build
pnpm audit
REDIS_TEST_URL=redis://127.0.0.1:6379 pnpm test -- tests/api/auth.test.ts
pnpm certify
```

Real adapter runs require an explicit disposable target and refuse a populated clinic configuration:

```sh
DATABASE_TEST_DRIVER=postgres \
DATABASE_TEST_URL=postgres://test_user:password@127.0.0.1:5432/clinic_cert \
DATABASE_TEST_CONFIRM=disposable DATABASE_TEST_EXPECTED_MAJOR=17 pnpm certify
```

Use major `18`, or `mysql`/major `8.4`, for the other SQL profiles. Real Supabase and Firestore require their separate test targets; see `tests/persistence/profiles.ts` and CI. Reports never promote an emulator or unit-test result to production certification. Verification generates ignored local artifacts; they are not distributed with the repository.

With the API and production web server running against the fictional demonstration installation, run `pnpm test:e2e`. Browser checks exercise dedicated pages, billing/signing/publication, themes, chat, the patient portal, table status updates, calendars, Kanban, permissions, and edit conflicts. They pace real API requests to respect the application rate limits; credentials remain in the private fixture file. Generated reports and screenshots are written under `test-results/playwright-report.json` and `test-results/playwright`.

## Recovery and database migration

See [encrypted transfer](docs/DATA-TRANSFER.md), [recovery runbook](docs/security/RECOVERY.md), and [threat model](docs/security/THREAT-MODEL.md). Stop API/workers for a maintenance export. Use a separate 32-byte transfer key and preserve the original application encryption key. Import only into an empty target; verify counts, hashes, files, user-session invalidation, and external payment/message reconciliation before reopening access.

The portability archive is supplementary to backend-native recovery: PostgreSQL WAL, MySQL binary logs, and Firestore's supported backup/PITR facilities. An off-host, paired database/file checkpoint and a measured recovery-point age of at most one hour require an actual recovery exercise.

## Authorship

Author: **ramanpal singh** — [kwebby.com](https://kwebby.com). Main first-party source and deployment files include this attribution as comments. Package manifests carry the same author metadata.
