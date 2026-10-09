#!/bin/sh
# Author: ramanpal singh | URL: https://kwebby.com
# Removes archived WAL that no retained base backup needs. Run inside the postgres container as the postgres user,
# only after the base backups you keep, and the WAL they need, are verified in off-host storage:
#   clinic-wal-retention [--dry-run] --keep N                    keep what the newest N base backups in the archive need
#   clinic-wal-retention [--dry-run] 0000000100000000000000A1.00000028.backup   keep what this (oldest retained) base backup needs
set -eu
ARCHIVE=${WAL_ARCHIVE_DIR:-/wal-archive}
usage() { echo 'Usage: clinic-wal-retention [--dry-run] (--keep N | OLDEST_RETAINED_BACKUP.backup)' >&2; exit 2; }
DRY=''
if [ "${1:-}" = '--dry-run' ]; then DRY='-n'; shift; fi
[ "$#" -ge 1 ] || usage
command -v pg_archivecleanup >/dev/null || { echo 'pg_archivecleanup is not installed' >&2; exit 1; }
[ -d "$ARCHIVE" ] || { echo "WAL archive directory $ARCHIVE does not exist" >&2; exit 1; }
if [ "$1" = '--keep' ]; then
 [ "$#" -eq 2 ] || usage
 case "$2" in ''|*[!0-9]*) usage;; esac
 [ "$2" -ge 1 ] || usage
 # Backup history files are named after the segment where each base backup started, so name order is backup order.
 COUNT=$(find "$ARCHIVE" -maxdepth 1 -type f -name '*.backup' | grep -cE '/[0-9A-F]{24}\.[0-9A-F]{8}\.backup$' || true)
 if [ "$COUNT" -lt "$2" ]; then echo "Only $COUNT base backup(s) recorded in $ARCHIVE; nothing removed." >&2; exit 0; fi
 OLDEST=$(find "$ARCHIVE" -maxdepth 1 -type f -name '*.backup' | sed 's|.*/||' | grep -E '^[0-9A-F]{24}\.[0-9A-F]{8}\.backup$' | sort | tail -n "$2" | head -n 1)
else
 [ "$#" -eq 1 ] || usage
 OLDEST=$1
fi
printf '%s\n' "$OLDEST" | grep -qE '^[0-9A-F]{24}\.[0-9A-F]{8}\.backup$' || { echo 'Expected a base backup history file such as 000000010000000000000003.00000028.backup' >&2; exit 2; }
[ -f "$ARCHIVE/$OLDEST" ] || { echo "$OLDEST is not in $ARCHIVE" >&2; exit 1; }
echo "Keeping WAL from $OLDEST onward in $ARCHIVE${DRY:+ (dry run: listing files that would be removed)}"
# PostgreSQL 17+ can also remove backup history files older than the kept backup.
HISTORY=''
if pg_archivecleanup --help 2>&1 | grep -q -- '--clean-backup-history'; then HISTORY='-b'; fi
exec pg_archivecleanup $DRY $HISTORY "$ARCHIVE" "$OLDEST"
