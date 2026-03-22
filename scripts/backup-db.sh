#!/bin/bash
# Backup the local Postgres database (used for development)
# Run periodically or before major operations

set -euo pipefail

BACKUP_DIR="$HOME/.code-intel-digest-backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Set LOCAL_DATABASE_URL (preferred) or DATABASE_URL to your local Postgres connection string."
  exit 1
fi

if [[ "$DB_URL" != postgres://* ]] && [[ "$DB_URL" != postgresql://* ]]; then
  echo "DATABASE_URL / LOCAL_DATABASE_URL must be a postgres:// or postgresql:// connection string."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "pg_dump not found. Install PostgreSQL client tools to backup Postgres."
  exit 1
fi

mkdir -p "$BACKUP_DIR"

OUT_FILE="$BACKUP_DIR/postgres_${TIMESTAMP}.sql"
pg_dump "$DB_URL" >"$OUT_FILE"

SIZE=$(stat -f%z "$OUT_FILE" 2>/dev/null || stat -c%s "$OUT_FILE" 2>/dev/null)
echo "✓ Backup created: $OUT_FILE ($(numfmt --to=iec-i --suffix=B "$SIZE" 2>/dev/null || echo "${SIZE} bytes"))"

# Keep only last 10 backups
cd "$BACKUP_DIR"
ls -t postgres_*.sql 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null || true
echo "✓ Keeping last 10 backups"
ls -la "$BACKUP_DIR"
