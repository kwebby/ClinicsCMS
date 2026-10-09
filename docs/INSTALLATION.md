<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# Install ClinicsCMS

This guide starts from a fresh clone and deploys one clinic installation behind HTTPS. The recommended deployment is Docker Compose with PostgreSQL 17 and Nginx. MySQL, PostgreSQL 18, Supabase, Firestore, and Apache alternatives are described below.

The repository is an implementation candidate. Recorded local SQL and application tests do not certify every production host or cloud backend. Before a real-patient pilot, complete the [release gates](security/RELEASE-GATES.md), including remote database certification, recovery exercises, clinical approval, and an independent penetration test. Use synthetic data while completing those checks.

## 1. Prepare the host

Deployment targets are Ubuntu 24.04/26.04 LTS and CentOS Stream 10. Start with a maintained 64-bit Linux server, a domain you control, administrative access, and an encrypted off-host backup destination. As an initial sizing estimate, allow 4 CPU cores, 8 GiB RAM, and at least 40 GiB of SSD space plus clinic files and database growth. This is a planning estimate, not a measured clinic capacity guarantee; ClamAV, builds, and Chromium need memory headroom.

Install:

- Git and a maintained Node.js 24 release; the repository build image pins Node 24.21.0.
- pnpm 11.22.0, matching `packageManager` in `package.json`.
- Docker Engine, Buildx, and the modern `docker compose` plugin.
- An ACME client or another certificate-management service that provides a trusted certificate chain and private key.
- A host firewall and backup scheduler managed by your operator.

Use Docker's maintained repository instructions for [Ubuntu](https://docs.docker.com/engine/install/ubuntu/) or [CentOS](https://docs.docker.com/engine/install/centos/). Both describe the package signing and installation steps for their distributions. Use the Compose plugin, not the retired Python `docker-compose` program. Do not replace an existing Docker installation or firewall without checking other workloads on that host.

After installing Node 24, install the pinned package manager and check the tools:

```sh
npm install --global pnpm@11.22.0
node --version
pnpm --version
docker version
docker compose version
```

Node and pnpm on the host run the configuration/preflight tools. The application itself runs in pinned containers. No developer-local `.runtime/node24` directory is needed. A container-only provisioning system may supply the equivalent tooling in its build job.

Point the domain's DNS at the server. Permit inbound TCP 80 and 443 and your restricted management interface. The supplied stack does not publish database, queue, scanner, or application ports. Docker-published ports need firewall rules that apply to Docker's traffic; ordinary host firewall rules alone may not cover them. See [Docker's firewall guidance](https://docs.docker.com/engine/network/packet-filtering-firewalls/).

## 2. Clone and install the locked dependencies

Run commands from the repository root unless a step explicitly says otherwise:

```sh
git clone https://github.com/kwebby/ClinicsCMS.git
cd ClinicsCMS
pnpm install --frozen-lockfile
node scripts/sync-website-fonts.mjs --verify
```

The font files and their licenses are included. A normal installation or build does not download Google Fonts. The [dependency guide](DEPENDENCIES.md) distinguishes required services, native tools, optional integrations, and third-party licenses.

For repeatable deployment, check out the reviewed release tag or commit you intend to run, rather than automatically deploying each change to `main`.

## 3. Generate private production configuration

Replace the example domain with your real hostname:

```sh
pnpm deploy:init --domain clinic.example.org --database postgres --proxy nginx
pnpm deploy:check --config-only
```

This creates `.env.production.local` with mode `0600`. It generates independent application, database, database-administrator, queue, and installation secrets; chooses the database/proxy profiles; enables staff MFA; and leaves outbound workers disabled. It refuses to overwrite an existing file. Do not commit, paste, or attach this file to an issue.

Review the file privately. `PUBLIC_URL` and `ALLOWED_ORIGINS` must both be the exact HTTPS origin, with no trailing slash; `CLINIC_DOMAIN` is only the hostname. Keep `ORGANIZATION_ID` and `INSTALLATION_ID` stable after setup. Use a different installation, database, queue namespace, and storage volume for each clinic or vendor demonstration. The [configuration reference](CONFIGURATION.md) explains every variable.

`deploy:check --config-only` validates values and file permissions. It does not connect to a database, verify certificates, or start containers. Remote database profiles deliberately fail until their required values are supplied.

## 4. Install the TLS certificate

Obtain a publicly trusted certificate for the hostname, using your certificate provider's procedure. DNS validation is convenient before this stack starts; HTTP validation requires a separate temporary HTTP challenge listener. The supplied Nginx/Apache configuration redirects HTTP to HTTPS and does not include an ACME challenge handler.

Create the certificate directory and copy the actual files, replacing the source paths:

```sh
mkdir -p deploy/certificates
install -m 0644 /secure/certificate-source/fullchain.pem deploy/certificates/fullchain.pem
install -m 0600 /secure/certificate-source/privkey.pem deploy/certificates/privkey.pem
```

The files must be PEM, the key must match the certificate, and the certificate must contain the hostname. Preflight requires at least seven days before expiry. Copy the complete chain; avoid symlinks pointing outside the mounted directory. Keep private keys readable only by the operator and TLS process. Configure your renewal job to replace these files and reload the selected proxy after successful renewal; see [deployment operations](../deploy/README.md#certificate-renewal).

On CentOS, keep SELinux enforcing. Bind-mounted configuration/certificate directories need labels permitting container reads. Use an operator-managed SELinux policy or local Compose overrides adding `:ro,z` to shared read-only mounts. Firebase credentials shared by API and worker also need a shared label. Do not label your whole home directory or weaken key permissions to solve a mount denial.

## 5. Review analyzer network containment

The separate website analyzer has its own Docker network and no clinic credentials. Before exposing the full stack, review and install the host egress policy:

```sh
sudo sh deploy/analyzer-firewall.sh
```

The default analyzer subnet is `172.30.240.0/28`. If it conflicts, set `ANALYZER_SUBNET` in `.env.production.local` and pass the same subnet to the firewall installer:

```sh
sudo env ANALYZER_SUBNET=172.30.241.0/28 sh deploy/analyzer-firewall.sh
```

The analyzer resolves names through Docker's embedded DNS, which forwards queries from the analyzer's own network namespace, so the policy allows UDP/TCP 53 only to the resolvers in `ANALYZER_DNS_SERVERS` (blank: the host's non-loopback nameservers, the same ones Docker forwards to; the script prints the list it used). Set it explicitly if Docker is configured with other resolvers, for example `sudo env ANALYZER_DNS_SERVERS=10.0.0.2 sh deploy/analyzer-firewall.sh`. Everything else except public TCP 80/443 is rejected, and traffic from the analyzer subnet addressed to the host itself (gateway, host or published addresses, which uses the `INPUT` chain rather than forwarding) is rejected apart from DNS to a configured host resolver.

The script requires Docker's `DOCKER-USER` chain and manages dedicated `CLINIC_ANALYZER` and `CLINIC_ANALYZER_INPUT` chains. Make its rules persistent after Docker startup through your host firewall manager. A different firewall backend needs an equivalent tested policy. The [deployment guide](../deploy/README.md#files-scanner-pdf-and-analyzer) explains the boundary; this step is not a general firewall installer.

## 6. Validate, build, and start

```sh
pnpm deploy:check
docker compose --env-file .env.production.local -f deploy/compose.yml config --quiet
docker compose --env-file .env.production.local -f deploy/compose.yml build
docker compose --env-file .env.production.local -f deploy/compose.yml up -d --wait --wait-timeout 600 postgres valkey clamav
docker compose --env-file .env.production.local -f deploy/compose.yml up -d --wait --wait-timeout 600
docker compose --env-file .env.production.local -f deploy/compose.yml ps
```

Start the local database first because API/worker initialization requires it to be ready. For MySQL, replace `postgres` in the first `up` command with `mysql`. For remote Supabase/Firestore, omit the local database service and verify the remote connection independently. The generated `COMPOSE_PROFILES` chooses the proxy and, where applicable, the local database. Do not enable both proxies: both need host ports 80/443.

The initial ClamAV definition download and Chromium image build can take several minutes. An unavailable scanner should be repaired before testing uploads; scanning is not bypassed. Inspect bounded logs when a service fails:

```sh
docker compose --env-file .env.production.local -f deploy/compose.yml logs --tail=100 api worker clamav
curl --fail --silent --show-error https://clinic.example.org/api/v1/health
```

Full preflight validates certificate matching/expiry and Compose configuration. A passing result is not proof that the deployed TLS, WebSocket, database, upload, or backup paths work. Do not publish expanded `docker compose config` output: it includes substituted credentials.

## 7. Create the owner and configure the clinic

1. Open `https://clinic.example.org/setup` on the intended HTTPS hostname.
2. Read `BOOTSTRAP_TOKEN` privately from `.env.production.local` and enter it in the setup form. Supply the owner's name/email, a password of at least 12 characters, clinic name, IANA timezone, and currency.
3. Complete staff authenticator enrollment and store the recovery codes securely. Production refuses disabled staff MFA.
4. Clear `BOOTSTRAP_TOKEN` in the private environment file and recreate the API/worker services to remove it from their running environment:

   ```sh
   docker compose --env-file .env.production.local -f deploy/compose.yml up -d --force-recreate api worker
   ```

5. Configure business/legal invoice details, departments/branch scopes, staff invitations, services, availability, document templates, and access roles. Configure the website through the dedicated [website settings pages](WEBSITE-SETTINGS.md).
6. Configure SMTP and verify a message arrives at a controlled inbox. SMTP acceptance alone is not confirmed delivery. Configure payment sandbox credentials/webhook secrets and approved AI settings only when those features are required.
7. Review queued work and recipients, then set `OUTBOUND_WORKERS_ENABLED=true` in `.env.production.local` and recreate `worker`. This starts scheduled work and outbox delivery. A running worker with this flag `false` deliberately sends nothing.
8. Verify HTTPS redirects, secure cookies, patient/staff role boundaries, WebSocket chat, scanned upload/download, invoice PDF generation, and a safe notification. Complete the remaining release evidence before using real patient data.

Setup works only while the user store is empty. It is not an owner-password reset tool. For a development demonstration, use the separate [development guide](DEVELOPMENT.md); do not seed fictional owner accounts into a production installation.

## Database and proxy alternatives

### Native processes behind a host reverse proxy

If you run the API natively (or publish it to loopback through your own Compose override) behind a host-level Nginx/Apache, set `TRUST_PROXY_HOPS=1` in that API environment and bind the API to loopback. Leaving it at `0` makes every client appear as the proxy's address, so all visitors share the same per-address rate limits (login, booking, registration, tools): a handful of requests can lock everyone out. Use `0` only when browsers reach the API directly, as in local development; see the [configuration reference](CONFIGURATION.md).

Choose one authoritative backend when generating a **new** configuration. Do not rerun `deploy:init` over an existing installation to switch databases; use [controlled data transfer](DATA-TRANSFER.md).

| Choice | Initial generator options | Additional files/actions |
|---|---|---|
| PostgreSQL 17 | `--database postgres --proxy nginx` | Default local SQL profile |
| PostgreSQL 18 | `--database postgres --proxy nginx` | Add `-f deploy/compose.postgres18.yml` to **every** Compose command; use `pnpm deploy:check --postgres18` |
| MySQL 8.4 | `--database mysql --proxy nginx` | Use the `mysql` service in the dependency startup step |
| Supabase PostgreSQL | `--database supabase --proxy nginx` | Configure verified TLS SQL connection; no local database profile |
| Cloud Firestore | `--database firestore --proxy nginx` | Configure project/IAM; add `-f deploy/compose.firestore.yml` to every Compose command |
| Apache | Replace `--proxy nginx` with `--proxy apache` | Same certificate paths, routes, and application services |

PostgreSQL 18 example:

```sh
pnpm deploy:check --postgres18
docker compose --env-file .env.production.local -f deploy/compose.yml -f deploy/compose.postgres18.yml up -d --wait postgres valkey clamav
docker compose --env-file .env.production.local -f deploy/compose.yml -f deploy/compose.postgres18.yml up -d --build --wait
```

Use a fresh PostgreSQL 18 volume or a rehearsed major-version migration. Never start PostgreSQL 18 against a PostgreSQL 17 data directory. The override changes the image; it does not migrate data.

### Supabase

Use `DATABASE_DRIVER=supabase` with a PostgreSQL direct connection or session-mode pooler connection suitable for a persistent backend. Transaction-mode pooling is not the documented deployment path for this adapter. The connection must include `sslmode=verify-full`; use the actual database username/password, not Supabase's browser anon/service API keys. See the [official connection guide](https://supabase.com/docs/guides/database/connecting-to-postgres).

If the database CA is not trusted by the container, mount the CA read-only into API and worker with a local Compose override and reference its **container** path via `sslrootcert` in `DATABASE_URL`. URL-encode credentials. Grant the restricted app role enough rights to initialize and operate its `clinic_records` and `clinic_locks` tables. The app does not use Supabase Auth or Storage; authentication, permissions, and private local files remain application-owned. Managed and self-hosted Supabase both require their own deployment/certification evidence.

### Cloud Firestore

Set `FIREBASE_PROJECT_ID`, `FIREBASE_DATABASE_ID` (usually `(default)`), and an absolute `FIREBASE_CREDENTIALS_FILE` host path. Clear `DATABASE_URL`. The override mounts the credential into API/worker as `/run/secrets/firebase.json` and sets `GOOGLE_APPLICATION_CREDENTIALS` there. The host file must be private (`0600`), readable by container UID 1000, and correctly labeled on SELinux hosts. Keep it outside the tracked source tree, or in ignored `deploy/secrets` with equivalent access controls.

Create the intended Firestore database and configure least-privilege IAM using the [Admin SDK setup documentation](https://firebase.google.com/docs/admin/setup). With an authorized Firebase CLI account, deploy the repository's client rules and indexes from their directory:

```sh
cd deploy/firebase
firebase deploy --only firestore:rules,firestore:indexes --project YOUR_DISPOSABLE_PROJECT_ID
cd ../..
pnpm deploy:check
docker compose --env-file .env.production.local -f deploy/compose.yml -f deploy/compose.firestore.yml up -d --wait valkey clamav
docker compose --env-file .env.production.local -f deploy/compose.yml -f deploy/compose.firestore.yml up -d --build --wait
```

The shipped client rules deny direct browser database access. The Admin SDK uses IAM and bypasses those rules, so they do not replace service-account restrictions. Firestore is a remote database option for this self-hosted application; its emulator is development-only and rejected in production. Real disposable Firestore and Supabase certification remain pending until those projects are supplied and tested.

## Continuing operation

Read [deployment operations](../deploy/README.md) for service boundaries, proxy behavior, certificate renewal, updates, and troubleshooting. Set up [paired database/file backups and restore exercises](security/RECOVERY.md) before clinic use. The PostgreSQL profile archives WAL to its own `postgres-wal` volume; nothing deletes archived WAL automatically, so schedule base backups and the `clinic-wal-retention` pruning described there, and monitor that volume's free space. Database backups alone do not contain local attachments, themes, or encryption keys. Theme development and packaging are documented in the [theme format](security/THEME-FORMAT.md); the current publication and rollback behavior is described in [website settings](WEBSITE-SETTINGS.md).
