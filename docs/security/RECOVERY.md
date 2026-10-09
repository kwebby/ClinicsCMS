<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS backup and recovery runbook

Provision and configure the target using [installation](../INSTALLATION.md) and [configuration](../CONFIGURATION.md). A GitHub clone restores application source only: it contains no clinic database, uploaded files, encryption keys, backups, or private verification records. Use the [data-transfer guide](../DATA-TRANSFER.md) for the application’s portable export/import commands.

## Required backup set

A restorable checkpoint contains the authoritative database, the complete private `files` volume (including theme assets and publication snapshots), encrypted application configuration and encryption keys, exact container digests, schema revision, and a manifest with timestamps and checksums. Losing the encryption key makes provider/MFA configuration unusable even if the database is restored. Keep configuration/key recovery material separately access-controlled.

Use an encrypted off-host repository with independent credentials and retention protection. A second copy on the same VPS is insufficient. The operator selects its off-host provider/region according to the clinic's requirements. Do not upload clinical data to a developer's generic artifact store.

## Backend-specific checkpoints

- PostgreSQL: combine scheduled physical base backups with continuous WAL archiving. The supplied local profile archives WAL to the dedicated `postgres-wal` volume (`/wal-archive`) with a 15-minute archive timeout; see [WAL archive and retention](#postgresql-wal-archive-and-retention). The archive must be transferred off-host promptly; local WAL alone does not meet the recovery target. Monitor `pg_stat_archiver`, base-backup success, WAL continuity, and the latest recoverable timestamp. Use native PostgreSQL restore/PITR procedures for the exact selected major version.
- MySQL: combine a consistent full backup with binary logs. The supplied profile enables row-format binary logging; collect these off-host before expiry. Preserve GTID/binlog positions and restore to a chosen checkpoint, verifying transaction continuity.
- Supabase: verify the selected project's actual backup/PITR retention and restore procedure. Managed-database recovery does not include the application server's local files or keys. Self-hosted Supabase follows the PostgreSQL procedure.
- Firestore: explicitly enable and verify production backup/PITR capabilities for the selected project/database; preserve export metadata and recovery timestamps. Emulator export files are development fixtures and do not certify production recovery.

Immutable files must reach off-host storage at least as frequently as the database recovery point. A database checkpoint must not be advertised as recoverable until every referenced file is verified available at that checkpoint. For the simplest initial reliable checkpoint, place the clinic in maintenance, stop API mutations and all workers, take a consistent database backup plus file snapshot, then resume. The elapsed time from the last complete off-host checkpoint is the measured RPO; the release requirement is at most one hour. More advanced continuous backup requires evidence of matched file/DB completeness.

## PostgreSQL WAL archive and retention

The supplied PostgreSQL service copies every completed WAL segment into the `postgres-wal` volume mounted at `/wal-archive`, separate from the `postgres` data volume. Nothing deletes archived WAL automatically. If the archive's filesystem fills, `archive_command` fails, PostgreSQL keeps the unarchived segments in `pg_wal` on the data volume, and the database eventually stops when that disk is full. Retention is therefore an operating requirement, tied to base backups:

1. Take physical base backups on a schedule (for example nightly) with the native tools for the running major version, such as `pg_basebackup` run as the `postgres` role inside the container, and copy each backup off-host. Each base backup writes a backup history file (`<segment>.<offset>.backup`) into the archive.
2. Copy `/wal-archive` off-host continuously or at least as often as your recovery point requires (the release requirement is one hour), together with the base backups.
3. After the base backups you intend to keep, and the WAL they need, are verified off-host, prune older WAL with the supplied `clinic-wal-retention` script (mounted read-only into the container). Preview first:

   ```sh
   docker compose --env-file .env.production.local -f deploy/compose.yml exec -T --user postgres postgres sh /usr/local/bin/clinic-wal-retention --dry-run --keep 2
   docker compose --env-file .env.production.local -f deploy/compose.yml exec -T --user postgres postgres sh /usr/local/bin/clinic-wal-retention --keep 2
   ```

   `--keep N` keeps every segment needed by the newest N base backups recorded in the archive and removes older segments with `pg_archivecleanup` (on PostgreSQL 17+, older backup history files too). It removes nothing while fewer than N base backups are recorded. Instead of `--keep`, you can name the history file of the oldest base backup you still retain anywhere, for example `000000010000000000000003.00000028.backup`. `WAL_ARCHIVE_DIR` overrides the archive path. Add the PostgreSQL 18 override file to these commands when it is in use.
4. Schedule steps 1–3 (host cron or your backup scheduler) and alert on: archive-volume free space, `pg_stat_archiver.failed_count`/`last_failed_time`, base-backup age, and off-host copy failures. Never prune segments that are not yet off-host for a backup you still need; pruned WAL cannot be recovered.

The archive volume lives with the other Docker volumes by default. Placing it on a separate filesystem (a volume driver option or bind mount on another disk) prevents a full archive from also filling the database disk.

Installations created before this layout archived into `$PGDATA/wal-archive` on the data volume. After upgrading, copy that directory off-host with its matching base backups, confirm new segments arrive in `/wal-archive`, then delete the old directory.

## Clean-environment restore exercise

1. Provision a clean isolated host matching the supported OS/proxy/database profile. Disable outbound workers, payment/email/AI integrations, public ingress, and scheduled reminders before starting any restored application process.
2. Restore the matching encrypted database checkpoint and file-volume snapshot. Restore application encryption material only into the restricted configuration store. Apply exact known image digests/schema versions.
3. Verify the backup manifest, database record counts, transaction consistency, issued invoice numbers/totals, signed document hashes, private attachment hashes, and active theme/publication snapshots.
4. Invalidate all old sessions; require fresh sign-in/MFA and rotate compromised or exposed secrets as appropriate. Do not reuse a compromised host's SSH/bootstrap credentials.
5. Reconcile external payments with the merchant providers before replaying any jobs. Preserve provider event IDs/idempotency keys and quarantine uncertain events. Review pending reminders/emails so stale or previously sent messages are not blindly replayed.
6. Test patient/staff access, clinical sign/amend behavior, document downloads, chat membership, payment webhook verification, invoice PDF generation, and one safe queued notification.
7. Record restore start/completion, latest recoverable timestamp, missing-file count, reconciliation status, tester, and artifacts. A drill only passes with zero missing referenced files and the target RPO.
8. Restore ingress and workers deliberately after sign-off by the clinic/operator. Observe failed-job, payment, scanner, and storage queues.

## Database switching

Use the application's controlled export/import tooling within a maintenance window. Export from one authoritative backend and import into an empty destination. Preserve entity IDs, versions, clinical signatures, invoice snapshots, event idempotency records, and file hash references. The portable archive includes the local file tree; verify its manifest and every file reference after import. Compare per-collection counts and canonical content hashes, rerun contract tests, and revoke old sessions. Switch `DATABASE_DRIVER` only after these checks; never run both stores as concurrent authorities.

## Required evidence file

Record each exercise in a dated restricted operations log containing: app/database image digests; OS/proxy versions; source and target backends; checkpoint timestamp; off-host file-manifest timestamp; latest verified transaction; start/end times; missing/corrupt files; old-session revocation test; external-work reconciliation; findings and owner. Clinical examples in public test reports must be synthetic.
