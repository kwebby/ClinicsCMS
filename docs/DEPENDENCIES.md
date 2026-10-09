<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS dependencies

`package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, and the deployment image digests are the executable sources of truth. Install with `pnpm install --frozen-lockfile`; avoid independently upgrading a framework or replacing the package manager without rerunning the contract/build/browser checks.

## Runtime and build versions

| Component | Repository version | Used for |
|---|---|---|
| Node.js | Engine `>=24.0.0 <25.0.0`; image/CI pin `24.21.0` | API, worker, web server, build and scripts |
| pnpm | `11.22.0` | Workspace installation and scripts |
| TypeScript | `5.9.3` | API/shared compilation and web typechecking |
| NestJS | Core/platform packages `12.1.2`; Swagger `12.0.2` | HTTP API, dependency injection, sockets, OpenAPI |
| Next.js | `16.4.0` | Server-rendered website and authenticated interfaces |
| React / React DOM | `19.3.0` | Client interfaces |
| Tailwind CSS | `4.1.16` | Application styling |
| BlockNote | Core/server-util/react/shadcn `0.55.0` | Rich-text writing and server rendering |
| Kysely | `0.29.6` | SQL adapter |
| PostgreSQL driver `pg` | `8.16.3` | PostgreSQL and Supabase connections |
| MySQL driver `mysql2` | `3.24.5` | MySQL connections |
| Firebase Admin | `14.5.0` | Dedicated Firestore adapter |
| BullMQ / ioredis | `6.3.12` / `5.8.2` | Queue execution and server-side sessions |
| Socket.IO server/client | `4.8.1` | Authorized chat and live events |
| Sharp | `0.35.5` | Public-image validation and re-encoding |
| Playwright | `1.56.1` | Chromium PDF generation and browser tests |
| Vitest | `5.0.3` | Unit and contract tests |
| tsx | `4.20.6` | TypeScript development/maintenance scripts |

Other runtime dependencies include Express 5.1.0, Zod 4.1.12, Decimal.js 10.6.0, Nodemailer 10.0.16, Stripe 19.1.0, bcryptjs 3.0.2, OTPAuth 9.4.1, Helmet 8.1.0, sanitize-html 2.18.0, and the bounded ZIP readers/writers. The manifests list all exact direct versions; the lockfile records transitive resolutions and integrity values.

The `@clinic/web` workspace scope and internal `clinic_*` SQL identifiers are technical names retained for compatibility. The product and public repository are **ClinicsCMS**.

## Production services

| Service | Pinned image tag | Required? |
|---|---|---|
| PostgreSQL | `17.11-bookworm`; override `18.6-bookworm` | One SQL option |
| MySQL | `8.4.11` | Alternative SQL option |
| Supabase | Operator-managed PostgreSQL endpoint | Alternative remote/self-hosted PostgreSQL deployment |
| Cloud Firestore | Operator-provisioned project/database | Alternative remote database |
| Valkey | `8.1.10-alpine` | Required for sessions, rate limits, queue and events |
| ClamAV | `1.5.4-debian` | Required for uploads/theme import; current signatures required |
| Nginx | `1.30.5` | One reverse-proxy option |
| Apache HTTP Server | `2.4.69` | Alternative reverse proxy |
| Isolated PDF worker | Built from the repository; Playwright Chromium | Required for production PDF generation |
| Isolated analyzer worker | Built from the repository | Required for the public business website analyzer |

All shipped third-party image references include digests in [`deploy/compose.yml`](../deploy/compose.yml), its PostgreSQL 18 override, and [`deploy/Dockerfile`](../deploy/Dockerfile). Tags above are a readable inventory, not permission to discard the digest. Review newer patches and rebuild deliberately. Recorded native SQL test patches and pinned container patches differ; see [implementation evidence](IMPLEMENTATION-STATUS.md).

Choose one authoritative database. Valkey is not the durable business record store: pending/retry work is represented in the database outbox. Firestore does not eliminate the Valkey or private local filesystem requirement. Supabase Auth/Storage and Firebase browser authentication are not required by this application.

## Native dependencies

**Docker deployment:** the build/application images supply Node and pnpm. The application image installs `clamdscan` and trusted CA certificates. The PDF image installs the exact Playwright Chromium build and its Linux libraries with `playwright install --with-deps chromium`. Database, queue, scanner daemon, and proxy come from their separate images. Do not expose the private storage volume as a static web directory.

**Native development:** provide a PostgreSQL/MySQL service or configured remote database, Valkey/Redis-compatible service, `clamdscan` plus a running ClamAV daemon and signatures, and a writable private storage directory. Install Chromium via `pnpm exec playwright install chromium`; Linux may also need `pnpm exec playwright install-deps chromium` with administrator privileges. Uploads fail if the scanner is absent, even in a development UI.

Sharp and esbuild use platform-specific binaries. The workspace permits their necessary install hooks. Do not pass `--ignore-scripts` indiscriminately or copy `node_modules` between operating systems/architectures. Install on the target platform. Unsupported platforms compiling Sharp from source need a compiler toolchain and compatible libvips; using the supplied Debian-based build image avoids requiring that toolchain on the host.

The PDF worker imports `@playwright/test` at runtime. It is currently declared under development dependencies, and the shipped application build retains those dependencies intentionally. A hand-built production image using `pnpm install --prod` alone is incomplete for PDF rendering. Follow the supplied Dockerfile until runtime dependencies are split into a separate package.

## Optional external integrations and tooling

| Capability | What the operator supplies |
|---|---|
| Email delivery | SMTP endpoint with valid TLS, sender/reply-to identity and optional credentials |
| Online payments | Clinic-owned Stripe or Razorpay credentials, webhook secret and eligible merchant/currency |
| AI drafts/transcription | Approved provider endpoint, key, model, quotas and permitted data-use policy |
| Firebase deployment | Firebase CLI and authorized project/IAM configuration, only when using Firestore |
| Off-host backups | Chosen encrypted backup repository, scheduler, monitoring and native database backup tools |
| HTTPS | Trusted certificates, renewal mechanism and reload hook |
| Source security checks | CI-pinned Gitleaks/Trivy; independent testing remains separate |

These integrations are not provisioned by `pnpm install`. Missing configuration returns an explicit failure; no live SMTP, payment, AI, or database certification is implied by installing an SDK.

## Fonts and licenses

Nine Google font families are bundled as local WOFF2 assets under `apps/web/public/fonts`: Inter, Source Sans 3, Manrope, DM Sans, Source Serif 4, Lora, Noto Sans, Noto Sans Devanagari, and Noto Sans Gurmukhi. Their original SIL Open Font License files and source/hash manifest are included. Production browsers fetch selected fonts from the clinic's own origin.

```sh
node scripts/sync-website-fonts.mjs --verify
```

The same script **without** `--verify` is an explicit networked maintenance refresh; review its changes before committing. It is not part of installation or normal builds.

ClinicsCMS first-party code is MIT licensed; third-party packages, fonts, and images retain their own licenses. Keep their notices when redistributing. BlockNote XL packages are not included. CI's license allowlist helps identify dependencies for review; it is not a blanket relicensing of third-party software.
