<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS deployment operations

Start with the complete [fresh-clone installation guide](../docs/INSTALLATION.md), then use this document for service boundaries, proxies, upgrades and recovery. See also the [dependency inventory](../docs/DEPENDENCIES.md), [configuration reference](../docs/CONFIGURATION.md), and [native development guide](../docs/DEVELOPMENT.md). Main first-party code is MIT licensed; dependencies and bundled fonts retain their own licenses.

The delivered configurations target Ubuntu 24.04/26.04 LTS and CentOS Stream 10 with Docker Engine and the modern `docker compose` plugin. OS installation and production certification must be performed on real target hosts; these files alone are not deployment evidence. Container images are pinned by version and multi-architecture digest obtained from Docker Hub on 2026-10-09. Review/rebuild image pins with security releases.

## Install

Generate a private configuration without touching the local demonstration:

```sh
pnpm deploy:init --domain clinic.example.org --database postgres --proxy nginx
pnpm deploy:check --config-only
# After installing certificates, Docker/Compose and any remote credentials:
pnpm deploy:check
docker compose --env-file .env.production.local -f deploy/compose.yml build
docker compose --env-file .env.production.local -f deploy/compose.yml up -d --wait --wait-timeout 600 postgres valkey clamav
docker compose --env-file .env.production.local -f deploy/compose.yml up -d --wait --wait-timeout 600
```

Start the selected database first because API and worker initialization requires it to be ready. For MySQL replace `postgres` with `mysql`; for remote Supabase/Firestore omit the local database service and verify its remote connection separately. Initial ClamAV signature downloads may take several minutes. The generated environment selects the database and proxy through `COMPOSE_PROFILES`.

`deploy:init` creates `.env.production.local` with mode 0600, independent application/database-administrator/queue secrets, the selected Compose profiles, mandatory staff MFA, and outbound workers disabled. It refuses to overwrite an existing file. `--database mysql|supabase|firestore` and `--proxy apache` select the other profiles. Remote profiles intentionally fail preflight until their credentials are configured; they do not create cloud projects. `--config-only` checks configuration without contacting a database or requiring Docker/certificates. Full preflight additionally checks certificate hostname/key/expiry and Compose configuration; it does not start services or certify a live host. Do not print or attach expanded Compose configuration, because it contains credentials.

For Firestore, add `-f deploy/compose.firestore.yml` to Compose commands. Set `FIREBASE_CREDENTIALS_FILE` to an absolute host path readable by container UID 1000 with mode 0600 and the correct SELinux label on CentOS. The override mounts the file read-only into API/worker. Set `FIREBASE_PROJECT_ID` to the credential's project. `deploy/firebase` includes deny-all client rules and repository indexes; deploy these to the eventual disposable project before certification. The Admin SDK uses IAM and bypasses client rules, so its service account must be restricted separately. Supabase uses a direct/session-mode PostgreSQL URL with `sslmode=verify-full`; if its CA is not in the system trust store, mount the project CA read-only and specify its in-container path through `sslrootcert` in the URL.

For PostgreSQL 18, add `-f deploy/compose.postgres18.yml` to Compose commands and `--postgres18` to preflight. All commands below also accept the generated `.env.production.local` instead of `.env`.

The web/proxy network is separate from database/queue services. Valkey requires its independently generated password. PostgreSQL initializes a restricted `clinic` role for application tables and retains a separate administrator credential. Only the database containers receive administrator/root passwords. Initialization scripts apply to fresh volumes; an existing installation needs an explicit role migration, not an environment-only password change.

1. Install the supported Docker Engine/Compose package for the host. Keep SELinux enforcing on CentOS; use labeled bind mounts or managed named volumes. Restrict inbound host ports to HTTPS, HTTP redirect, and the operator's management interface.
2. For manual configuration, copy the application `.env.example` to `.env`; create independent cryptographically random application encryption, bootstrap, database, and Redis/session secrets as required there. Set `PUBLIC_URL=https://clinic.example`, `CLINIC_DOMAIN=clinic.example`, and `DATABASE_DRIVER`. Keep `.env` readable only by its operator (`chmod 600 .env`). The `web` service receives only public configuration and its internal API URL.
3. Choose one authoritative backend:
   - PostgreSQL: `DATABASE_DRIVER=postgres`, `DATABASE_URL=postgresql://clinic:<URL-encoded password>@postgres:5432/clinic`, `DATABASE_PASSWORD=<same password>`, and a separate `POSTGRES_ADMIN_PASSWORD`.
   - MySQL: `DATABASE_DRIVER=mysql`, `DATABASE_URL=mysql://clinic:<URL-encoded password>@mysql:3306/clinic`, `DATABASE_PASSWORD=<same password>`, and a separate `MYSQL_ROOT_PASSWORD`.
   - Supabase: `DATABASE_DRIVER=supabase` and the direct/session-mode PostgreSQL connection supported by the adapter. Require TLS for remote connections. Do not use public/anonymous browser keys as database credentials.
   - Firestore: `DATABASE_DRIVER=firestore`, `FIREBASE_PROJECT_ID`, optional `FIREBASE_DATABASE_ID`, and application-default credentials with the least necessary Firestore access. Mount a credential file read-only into API/worker only and set `GOOGLE_APPLICATION_CREDENTIALS`; do not place credentials in the image or web container. Do not configure `FIRESTORE_EMULATOR_HOST` in production.
4. Place the public certificate chain and private key at `deploy/certificates/fullchain.pem` and `privkey.pem`. Restrict the private key to the container's TLS process/operator. Arrange certificate renewal and proxy reload on the host; neither proxy silently generates untrusted certificates.
5. Select exactly one proxy profile and at most one local database profile. From the repository root, run:

   ```sh
   docker compose --env-file .env -f deploy/compose.yml --profile postgres --profile nginx config --quiet
   docker compose --env-file .env -f deploy/compose.yml --profile postgres --profile nginx up -d --wait postgres valkey clamav
   docker compose --env-file .env -f deploy/compose.yml --profile postgres --profile nginx up -d --build --wait
   ```

   Replace `postgres` with `mysql`, or omit it for remote Supabase/Firestore. Replace `nginx` with `apache` to use Apache. PostgreSQL 18 uses an additional `-f deploy/compose.postgres18.yml` with a fresh cluster volume or a separately rehearsed PostgreSQL major upgrade. Never open an old PostgreSQL data directory with a different major version.
6. Check container health, HTTPS redirects, host rejection, secure cookies, API health, socket authorization, a clean scanned upload, and a rejected EICAR test upload. Use the one-time setup token to initialize the owner account; enroll MFA before privileged access, then remove the bootstrap token from the environment.
7. Configure SMTP/payment/AI in authenticated settings. A missing scanner, payment key, SMTP configuration, or AI policy fails explicitly; there is no simulated production success.

## Files, scanner, PDF and analyzer

`files` contains private originals, immutable theme assets, and public-page publication snapshots. Never mount it under a static webroot. Both proxies pass uploads through authenticated APIs with 26 MiB request limits; service-level ZIP limits remain 25 MiB. ClamAV receives file bytes over the internal `scanner` network (`clamdscan --stream`), which only the API shares with it, so it needs no filesystem access to clinic data and cannot reach the database or queue. It runs the image's unprivileged entrypoint as its `clamav` user with every capability dropped, `no-new-privileges` and a read-only root filesystem; only its signature volume and `/tmp`/log tmpfs mounts are writable. Its second network, `scanner-egress`, exists only for freshclam signature downloads (restrict it further with a host egress policy if required). Keep its signatures fresh and alert on scanner failures: an unreachable scanner now returns `SCANNER_UNAVAILABLE` (503) rather than a malware rejection, and uploads still fail closed. Existing `clamav` volumes are already owned by that user (the previous root entrypoint set this ownership on every start).

The PDF process has no network, application/database credentials, or clinic-file mount. It accepts only financial snapshots and controlled template properties through a Unix socket shared with API/worker. Chromium scripts and requests are disabled; the browser runs without its internal sandbox only inside this restricted non-root, no-network container. The root filesystem is read-only and memory/PIDs are bounded. One render runs at a time; up to `PDF_RENDER_QUEUE_SIZE` further requests (default 4) wait at most `PDF_RENDER_QUEUE_TIMEOUT_MS` (default 10 s) before receiving `503`. `PDF_RENDERER_SOCKET` is mandatory in production.

The website analyzer also receives no clinic credentials/data and uses a different Unix socket. Its only network is `analyzer-egress`, separate from database/API networks. Before enabling this tool, the Linux host must apply `deploy/analyzer-firewall.sh` and persist its rules after Docker starts. Set `ANALYZER_SUBNET` to an unused subnet if its default conflicts. The rule permits DNS (UDP/TCP 53) only to the resolvers in `ANALYZER_DNS_SERVERS` (default: the host's non-loopback nameservers, which Docker's embedded DNS forwards to from the analyzer's namespace), then TCP 80/443 to public IPv4 addresses, and rejects private/reserved destinations and everything else. A second chain on the host `INPUT` path rejects traffic from the analyzer subnet to the host's own addresses except DNS to a configured host resolver. IPv6 is disabled on this network. Do not run this installer against an unrelated firewall without reviewing its dedicated `CLINIC_ANALYZER` chain. On hosts using native nftables, implement the equivalent egress policy before certification. Code additionally checks every DNS answer, pins the approved address, rejects unsafe redirects, caps the body at 2 MiB and the whole analysis (DNS, connections, redirects and body) at 15 seconds, parses markup in linear time, and returns only bounded heuristic checks.

## Reverse-proxy behavior

Nginx and Apache templates provide TLS 1.2/1.3, HSTS, request-body limits, host checks, sanitized forwarded headers, `/api/` forwarding, `/socket.io/` WebSocket upgrades, and frontend forwarding. Host HTTP is an HTTPS redirect only. No SQL, Valkey, scanner, PDF, or analyzer port is published. Sensitive API responses are not cached. Nginx drops inherited `add_header` directives in any `location` that adds its own, so the `/api/` location repeats the server-level security headers; keep them in sync when adding headers (a regression test checks this). Apache merges vhost and `<Location>` headers, so it needs no repetition.

For an existing host-level Nginx/Apache installation, use the same route/header/TLS directives with API/web bound to loopback host ports; do not expose them publicly. Set `TRUST_PROXY_HOPS=1` for an API behind exactly one host proxy (the Compose default is already `1`); `0` there would put every client into the same rate-limit bucket.

The base file does not publish API/web ports. An existing host proxy therefore needs an operator-owned Compose override exposing those ports on loopback, adapted upstream addresses, and no conflicting container proxy on 80/443. The supplied preflight assumes a selected proxy profile; a different topology needs separate validation. Additional CDN/load-balancer hops also require revisiting forwarded-header trust, origin checks, client IPs and private cache exclusions.

## Certificate renewal

Certificates are managed outside the containers. The supplied HTTP configuration redirects to HTTPS and has no ACME challenge handler, so configure DNS validation or your issuer's appropriate challenge workflow separately. Copy actual PEM files into `deploy/certificates`; symlinks outside that mounted directory will not work. Replace the complete chain and matching key atomically, retaining private-key mode `0600` and the required SELinux context.

For Nginx, validate and reload after renewal:

```sh
pnpm deploy:check
docker compose --env-file .env.production.local -f deploy/compose.yml exec nginx nginx -t
docker compose --env-file .env.production.local -f deploy/compose.yml exec nginx nginx -s reload
```

For Apache:

```sh
pnpm deploy:check
docker compose --env-file .env.production.local -f deploy/compose.yml exec apache httpd -t
docker compose --env-file .env.production.local -f deploy/compose.yml exec apache httpd -k graceful
```

Add the same PostgreSQL 18/Firestore Compose override used for the installation to these commands. Check the externally served certificate after reload and monitor expiry. The repository does not install an automatic ACME renewal service.

## Upgrade and rollback

- Record the app/image digests, schema revision, configuration version, current publication ID, and verified backup/recovery checkpoint before upgrading.
- Rehearse the upgrade on a restored copy with outbound workers disabled. Review schema changes, then run contract, permissions, financial, clinical, proxy, and recovery checks. Current SQL tables initialize idempotently on startup; there is no separate versioned migration CLI. Future incompatible schema changes need explicit reviewed migration instructions.
- Stop new mutations while swapping incompatible versions. Restart API/web/worker using the same immutable image release after migration.
- Roll back application images only when their schema is compatible. Otherwise restore the matched database/files checkpoint into a clean environment; never attempt an untested destructive schema downgrade.
- Theme rollback uses its publication pointer and restores its immutable content/settings snapshots. Editing/publishing a page stages its latest approved snapshot; publish the website by activating the desired theme to bind that revision into the public site.

Environment changes require container recreation (`up -d --force-recreate` for the affected services), not only `restart`. `MAINTENANCE_MODE=true` blocks new API/worker startup; stop already running processes before offline transfer or restore. `OUTBOUND_WORKERS_ENABLED=false` suspends queued delivery/scheduling, but interactive email tests and payment operations can still call providers directly.

PostgreSQL WAL is archived to the dedicated `postgres-wal` volume (`/wal-archive`), not the data volume. Installations created before this change kept archives in `$PGDATA/wal-archive`: after upgrading, copy that directory off-host with your backup set, confirm the new volume receives segments (`pg_stat_archiver`), then remove the old directory. Archived WAL is never deleted automatically; prune it with `clinic-wal-retention` as described in the [recovery runbook](../docs/security/RECOVERY.md#postgresql-wal-archive-and-retention).

Keep the database/files volumes intact during maintenance. Do not use `docker compose down --volumes` as an upgrade or troubleshooting procedure. Follow the [paired backup/recovery runbook](../docs/security/RECOVERY.md) and [encrypted data-transfer guide](../docs/DATA-TRANSFER.md); local WAL/binlogs alone are not an off-host recoverable checkpoint, and no backup destination/scheduler is provisioned automatically.

## Routine health and troubleshooting

```sh
docker compose --env-file .env.production.local -f deploy/compose.yml ps
docker compose --env-file .env.production.local -f deploy/compose.yml logs --tail=100 api worker clamav
curl --fail --silent --show-error https://clinic.example.org/api/v1/health
```

| Symptom | Check |
|---|---|
| API restart loop | SQL/queue readiness, connection credentials, app key, maintenance flag and incomplete-restore marker |
| Upload/theme import fails | ClamAV health, definitions, memory, size/type validation and storage permissions; never bypass scanning |
| WebSocket fails | `/socket.io/` proxy route, upgrade handling, allowed origin and authenticated session |
| Queued messages missing | Separate worker process, explicit outbound flag, SMTP TLS configuration and durable failed-job queue |
| PDF unavailable | Isolated renderer health/socket, Chromium dependencies and its resource limits |
| Firestore permission/index error | Correct project/database, Admin IAM and deployed indexes; browser rules do not grant Admin SDK access |
| CentOS mount denied | Container UID ownership, directory traversal permissions and SELinux context; preserve private-key mode |
| Website changes not live | Draft save versus publication snapshot and active theme binding |

Share only redacted synthetic diagnostics in public GitHub issues. Retain clinic/provider/recovery evidence in restricted operational records. All current limitations are tracked in [release gates](../docs/security/RELEASE-GATES.md).

## External sources used for image verification

[Node official images](https://hub.docker.com/_/node), [PostgreSQL official images](https://hub.docker.com/_/postgres), [MySQL official images](https://hub.docker.com/_/mysql), [Valkey images](https://hub.docker.com/r/valkey/valkey/), [ClamAV images](https://hub.docker.com/r/clamav/clamav/), [Nginx official images](https://hub.docker.com/_/nginx), [Apache HTTP Server images](https://hub.docker.com/_/httpd).
