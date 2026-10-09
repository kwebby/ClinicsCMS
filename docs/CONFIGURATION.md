<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS configuration reference

Use `pnpm bootstrap` for a local `.env` or `pnpm deploy:init` for a private production `.env.production.local`. The former replaces only the encryption/bootstrap placeholders; you still configure database and queue credentials. The latter generates independent production secrets and Compose profiles. Both refuse to replace an existing configuration.

The API and outbox worker load `.env` from their working directory through dotenv. Compose substitutes values from the explicitly selected `--env-file`. A native command needing another environment file can use Node 24's `--env-file=/absolute/path` option. Next.js runs from `apps/web`, so do not assume it reads the repository-root `.env`; pass `API_INTERNAL_URL`/public values to the web process or use its private `.env.local`. Never introduce `NEXT_PUBLIC_` database or provider secrets.

## Identity, URLs and security

| Variable | Meaning and accepted usage |
|---|---|
| `NODE_ENV` | `development`, `test`, or `production`. Production requires HTTPS, staff MFA, and isolated worker sockets for their operations. |
| `PUBLIC_URL` | Browser-facing origin, e.g. `https://clinic.example.org`, no trailing slash. Used for origin checks, links and metadata. |
| `ALLOWED_ORIGINS` | API accepts a comma-separated origin set; supplied production preflight requires the one exact `PUBLIC_URL`. No wildcard. |
| `CLINIC_DOMAIN` | Lowercase fully-qualified hostname without scheme/port/path. Used by both proxy templates. |
| `API_HOST` / `API_PORT` | Native defaults `127.0.0.1` / `4000`; Compose binds `0.0.0.0:4000` only on its private networks. |
| `API_INTERNAL_URL` | Server-to-server API URL. Native `http://127.0.0.1:4000`; Compose `http://api:4000`. Next rewrites are generated at build time, so changing routing can require rebuilding the web app. |
| `TRUST_PROXY_HOPS` | Native `0`; Compose `1` for the supplied single proxy. Match the real topology rather than trusting arbitrary forwarded headers. |
| `APP_ENCRYPTION_KEY` | Exactly 32 cryptographically random bytes encoded as base64. Encrypts provider and MFA secrets. Preserve it in the recovery secret store; replacing it makes existing ciphertext unreadable. |
| `BOOTSTRAP_TOKEN` | One-time setup secret; generator uses 32 random bytes as 64 hex characters. Clear after owner setup and recreate API/worker. |
| `ORGANIZATION_ID` | Durable clinic organization identifier, default `clinic`. Keep stable after records exist. |
| `INSTALLATION_ID` | Queue/session/event namespace, default `clinic` in generated configuration. Keep stable and unique when infrastructure is shared. |
| `INSTALLATION_AUDIENCE` | `patient` for clinic tools; `business` for a separate vendor/B2B installation. B2B and patient data should use separate deployments/datastores. |
| `REGISTRATION_ENABLED` | `false` disables public patient signup; default `true`. Public signup never grants staff roles. |
| `REQUIRE_STAFF_MFA` | Keep `true`; production Compose enforces it. `false` is for isolated fictional development only. |
| `OPENAPI_ENABLED` | `true` mounts Swagger at `/api/docs`; default `false` in production generator. The documentation route is not an authenticated admin screen; enable only with intended access restrictions. |
| `MAINTENANCE_MODE` | `true` blocks API/worker startup; use during offline transfer/restore. Stop running processes first: changing a file does not change a process environment. |

## Database and queue

| Variable | Meaning |
|---|---|
| `DATABASE_DRIVER` | `postgres`, `mysql`, `supabase`, or `firestore`. Memory is available only to tests. |
| `DATABASE_URL` | SQL connection string. Generated local URLs use the restricted `clinic` account and Docker service hostname. Remote Supabase preflight requires `sslmode=verify-full`. Empty for Firestore. |
| `DATABASE_PASSWORD` | Restricted local application SQL password; must match the URL. Generated as independent random hex. |
| `POSTGRES_ADMIN_PASSWORD` | Separate PostgreSQL administrator password; supplied only to PostgreSQL, never API/web/worker. |
| `MYSQL_ROOT_PASSWORD` | Separate MySQL root password; supplied only to MySQL. |
| `FIREBASE_PROJECT_ID` | Exact Firestore project ID; not a Firebase browser API key. |
| `FIREBASE_DATABASE_ID` | Named Firestore database; default `(default)`. |
| `FIREBASE_CREDENTIALS_FILE` | Absolute host credential path used by the Firestore Compose override. Mode `0600`, container UID 1000-readable. |
| `GOOGLE_APPLICATION_CREDENTIALS` | Native Admin SDK credential path; the Compose override sets it to the mounted `/run/secrets/firebase.json`. |
| `FIRESTORE_EMULATOR_HOST` | Optional development/test emulator endpoint only; production rejects it. Never use it as production certification evidence. |
| `REDIS_URL` | Native queue/session connection string; defaults to loopback. Compose constructs it using `VALKEY_PASSWORD` and private host `valkey`. |
| `VALKEY_PASSWORD` | Independent random hexadecimal password, at least 32 bytes, required by supplied production Valkey configuration. |

SQL initialization creates the `clinic_records` and `clinic_locks` tables and the PostgreSQL organization index if absent. There is currently no separate `migrate` CLI or versioned SQL migration directory. Keep backups and review schema changes before upgrading; do not invent a `pnpm migrate` command. The local PostgreSQL role is permitted to create application tables but is not a superuser or role/database creator.

Database initialization scripts run only for fresh container volumes. Editing a password environment value does not rotate an existing SQL account; use a coordinated database credential rotation and update dependent services. The [data-transfer guide](DATA-TRANSFER.md) covers switching authoritative databases.

## Files, workers and deployment

| Variable | Meaning |
|---|---|
| `PRIVATE_STORAGE_ROOT` | Native default `.runtime/files`; Compose `/data` from the private named volume. API/worker need access; web/proxy must not mount it. |
| `CLAMD_CONFIG` | Optional native path to `clamdscan` client configuration. Compose uses `/etc/clamav/clamd.conf`, pointing to `clamav:3310`. |
| `OUTBOUND_WORKERS_ENABLED` | Explicit `true` starts outbox delivery/scheduled work; generated default `false`. Recreate/restart the worker after changing it. |
| `PDF_RENDERER_SOCKET` | Production Unix socket, set to `/run/clinic-pdf/renderer.sock` in Compose. Native development can leave blank for local Chromium rendering. |
| `PDF_CHROMIUM_SANDBOX` | Default Chromium sandbox enabled. Supplied isolated PDF container sets `false` because it has no network, app secrets or clinic-file mount and is otherwise restricted. Do not copy this setting into a general-purpose host renderer. |
| `ANALYZER_SOCKET` | Production Unix socket `/run/clinic-analyzer/analyzer.sock`; blank enables the local development implementation. |
| `ANALYZER_SUBNET` | Optional Docker IPv4 subnet, default `172.30.240.0/28`; must match the host analyzer firewall policy. |
| `AI_ALLOWED_HOSTS` | Comma-separated exact hostnames allowed for configured HTTPS AI endpoints, default `api.openai.com`. Set no spaces; this is not an API key. |
| `DATA_TRANSFER_KEY` | Distinct base64 32-byte key used privately for offline encrypted export/import. Not passed to routine application containers. |
| `COMPOSE_PROFILES` | Exactly one `nginx`/`apache`, plus `postgres`/`mysql` only for a local database. Generator sets it. |
| `APP_VERSION` | Optional tag for locally built application images, default `0.1.0`. It does not fetch a released image or alter application code. |
| `PORT` / `HOSTNAME` | Standalone Next server binding; Compose uses `3000` / `0.0.0.0`. Use loopback for a native process behind a host proxy. |
| `NEXT_TELEMETRY_DISABLED` | Set `1` to disable Next telemetry; supplied production build/web image does so. |

Unix-socket workers read their socket setting directly from the environment; they do not load `.env` themselves. When running them natively, set the variable in the command or use `node --env-file=.env --import tsx ...`.

## Settings stored in the database

Operators configure these through authenticated settings rather than putting all business data in environment variables:

- Business/legal name, address, timezone, currency, fiscal year, invoice numbering and tax/business identifiers.
- Website identity, homepage sections, navigation, footer, colors/fonts, canonical locations, SEO/social fields and publication snapshots.
- Notification preferences, quiet hours/escalation and approved AI policy.
- SMTP host/port/TLS/user/password/from/reply-to; Stripe secret key and webhook secret; Razorpay key ID/secret and webhook secret; AI HTTPS base URL, key, model/transcription model and monthly quota.

Integration secrets are encrypted with `APP_ENCRYPTION_KEY`, stay server-side, and are masked when read back. SMTP requires TLS and validates certificates. For `secure=true`, choose the provider's implicit TLS port (commonly 465); for STARTTLS, use its supported port with `secure=false` (commonly 587). A plaintext-only development mail sink will not satisfy this transport without a TLS-capable configuration.

Payment webhooks target `/api/v1/webhooks/stripe` or `/api/v1/webhooks/razorpay` on the public HTTPS origin. Configure provider signing secrets and required event subscriptions against the implemented adapter and test the full merchant sandbox workflow. A checkout return URL cannot settle an invoice. Changing the public domain also requires updating provider webhook endpoints, canonical origins, allowed origins and certificate configuration.

## Test-only variables

These are for isolated synthetic targets, not clinic configuration:

| Variable | Purpose |
|---|---|
| `DEMO_SEED=true` | Allows `pnpm seed:demo` in a non-production, empty installation. |
| `REDIS_TEST_URL` | Runs Redis-backed HTTP/session security tests; otherwise that group is explicitly skipped. |
| `DATABASE_TEST_DRIVER` / `DATABASE_TEST_URL` | Explicit disposable SQL certification target; ordinary production `DATABASE_URL` is not selected by the test profile loader. |
| `DATABASE_TEST_CONFIRM=disposable` | Required SQL test acknowledgement; test DB name also needs a `test`, `cert`, or `certification` segment. |
| `DATABASE_TEST_EXPECTED_MAJOR` | Optional expected version such as `17`, `18`, or `8.4`. |
| `FIREBASE_TEST_PROJECT_ID` / `FIREBASE_TEST_DATABASE_ID` | Explicit Firestore test project/database. |
| `FIREBASE_TEST_CONFIRM=disposable` | Required Firestore test acknowledgement. |
| `FIREBASE_TEST_PROJECT_ALLOWLIST` | Comma-separated exact project IDs; must include the chosen test project. |
| `CERTIFICATION_PROFILE` | Restricts a run to a profile returned by `tests/persistence/profiles.ts`. |
| `CERTIFICATION_REPORT` | Optional output file for `pnpm certify`; default dated JSON under `artifacts/certification`. |
| `WEB_BASE_URL` | Playwright target, default `http://localhost:3000`; servers must already be running. |
| `DEMO_ACCESS_FILE` | Optional path to private seeded browser-test credentials, default `.runtime/demo-access.json`. |
| `COMPOSE_BINARY` | Optional standalone Compose executable for `pnpm deploy:verify`; ordinary preflight expects `docker compose`. |

Do not commit real test-project credentials, environment files, runtime screenshots containing personal data, or expanded provider responses. Public reports should contain synthetic evidence and redacted diagnostics only.
