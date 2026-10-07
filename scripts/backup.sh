#!/usr/bin/env bash
# Nightly logical backup of the Postgres database. Run from cron or a scheduler:
#   DATABASE_ADMIN_URL=postgres://... BACKUP_DIR=/backups ./scripts/backup.sh
# Keeps 14 days locally; sync the directory to object storage (S3/R2/Spaces) for off-site copies.
set -euo pipefail
: "${DATABASE_ADMIN_URL:?set DATABASE_ADMIN_URL}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT="$BACKUP_DIR/angelic-$STAMP.dump"
pg_dump --format=custom --no-owner --no-privileges "$DATABASE_ADMIN_URL" > "$OUT"
find "$BACKUP_DIR" -name 'angelic-*.dump' -mtime +14 -delete
echo "wrote $OUT ($(du -h "$OUT" | cut -f1))"
# Restore: pg_restore --clean --if-exists --no-owner -d "$DATABASE_ADMIN_URL" angelic-<stamp>.dump
