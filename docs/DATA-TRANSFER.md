<!-- Author: ramanpal singh | URL: https://kwebby.com -->
# ClinicsCMS offline export, import and database switching

`data:export` creates an encrypted portable stream containing every durable database collection and all private local storage files. Collection discovery is dynamic, including newer modules. Export paginates records and streams file chunks; it does not load the installation into memory.

Use this workflow for a maintenance-window move between PostgreSQL, MySQL, Supabase PostgreSQL, or Firestore. It is separate from continuous WAL/binlog/PITR and paired off-host backups used to meet the measured one-hour recovery target.

Run the commands from a dependency-installed ClinicsCMS checkout with the source or target environment supplied privately; see [configuration](CONFIGURATION.md). The example `/secure-backups/clinic.backup` path is an operator-chosen protected location, not a file included in the repository. Generated archives, encryption keys, and verification output must stay outside Git.

## Prepare

1. Stop external writes, the API, and workers. Set `MAINTENANCE_MODE=true` and keep `OUTBOUND_WORKERS_ENABLED=false`. The CLI refuses live-mode operation. Keep the application in maintenance through validation.
2. Preserve the source `APP_ENCRYPTION_KEY` in the operator's encrypted secret store. Import requires the same key; it is needed to decrypt saved integration credentials and staff MFA secrets.
3. Configure a distinct `DATA_TRANSFER_KEY` containing 32 random bytes encoded as base64. Store it separately from the backup. The backup never contains either encryption key.
4. Choose an output path outside `PRIVATE_STORAGE_ROOT`; an existing backup path will not be overwritten.

```sh
pnpm data:export /secure-backups/clinic.backup
```

The archive uses authenticated AES-256-GCM encryption over a compressed stream. Its final manifest covers each durable record and each blob checksum and count. API credentials are never printed. Auth tokens, invitations, persisted sessions and MFA enrollment challenges are omitted.

## Restore to a new target

1. Configure `DATABASE_DRIVER` and its connection settings for the empty target database/project. Configure an empty or nonexistent `PRIVATE_STORAGE_ROOT`. Never import over an existing installation.
2. Supply the source `APP_ENCRYPTION_KEY`, backup `DATA_TRANSFER_KEY`, and the maintenance/outbound settings above.
3. Run the import and retain its verification result.

```sh
pnpm data:import /secure-backups/clinic.backup
```

Import authenticates and decompresses into a private scratch directory, checks the manifest and private-file references, and then installs the file tree. It restores record IDs, revisions, financial snapshots, and historical versions without routing them through normal create/update behavior. It verifies restored checksums and counts. Each user's session version is advanced so existing opaque sessions are invalidated; new sign-in is required.

A `.restore-incomplete` marker in private storage blocks application startup until import verifies. Firestore imports use bounded create-only batches and an additional `clinic_restoreMetadata/state` marker. Interrupted Firestore imports are not atomic: the marker blocks startup, and the safe recovery is a newly empty target and fresh import. Do not remove a marker to bypass incomplete verification. SQL and memory database imports are atomic at the database layer, while the file marker covers the combined operation.

### Decrypted working files

The decrypted stream and extracted records contain patient data. Import never writes them to the shared system temporary directory:

- `TRANSFER_SCRATCH_DIR` selects the working location. It defaults to the directory that contains `PRIVATE_STORAGE_ROOT`, where import already stages the restored file tree, and must be outside `PRIVATE_STORAGE_ROOT`. Set it explicitly when that parent is not a suitable private location (for example when the storage root is a volume mount point such as `/data`). Use encrypted storage that only the operator account can read.
- Each run creates its own `.clinic-import-<pid>-<random>` directory with mode `0700`; files inside are `0600`. Staged private files use `.clinic-restore-<pid>-<random>` beside the storage root.
- The directories are removed when the import finishes or fails, and synchronously on `SIGINT`, `SIGTERM`, `SIGHUP` or process exit.
- At start, import deletes leftovers of earlier runs whose process no longer exists (including `clinic-restore-*` directories that older versions left in the system temporary directory). A hard kill or power loss can still leave a directory until the next import, so check the scratch location after an interrupted run.

`TRANSFER_MAX_EXPANDED_BYTES` caps the decompressed stream. The default is 32 times the encrypted archive size, at least 2 GiB, which accommodates compressed records and already-compressed files while stopping a decompression bomb early. Raise it only for an archive from a trusted source that fails with `TRANSFER_TOO_LARGE`, and make sure the scratch location has room for the expanded stream plus the extracted records. Individual serialized entries are limited to 4 MiB. Imports reject path traversal, symbolic links, duplicate records/files, malformed binary chunks, missing files, changed encryption keys, and nonempty targets.

## Return to service

- Compare the exported/imported collection and file counts. Review sample signed encounters, issued invoices and payslips, images and attachment downloads.
- Reconcile payment attempts, captures and refunds with merchant records. Restored webhook and outbox state may precede provider-side events.
- Review pending outbox work before enabling delivery; do not automatically replay patient emails or other external effects after a restore.
- Keep the original encrypted archive and recovery keys until the migration is verified. Clear temporary database credentials and provide fresh operational credentials for the destination.
- Remove maintenance mode only after verification. Enable workers separately after reconciliation.

A successful portable restore is evidence for the data-transfer workflow; it does not certify a total-server-loss recovery time, one-hour recovery point, or an untested database profile.
