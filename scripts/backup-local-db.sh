#!/bin/bash
# Backup local Postgres database into .data/backups

set -euo pipefail

BACKUP_DIR=".data/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Set LOCAL_DATABASE_URL (preferred) or DATABASE_URL to your Postgres connection string."
  exit 1
fi

if [[ "$DB_URL" != postgres://* ]] && [[ "$DB_URL" != postgresql://* ]]; then
  echo "DATABASE_URL / LOCAL_DATABASE_URL must be a postgres:// or postgresql:// connection string."
  exit 1
fi

if ! command -v pg_dump >/dev/null 2>&1; then
  echo "⚠️  pg_dump not found. Install PostgreSQL client tools to backup PostgreSQL."
  exit 1
fi

OUT_FILE="$BACKUP_DIR/postgres_${TIMESTAMP}.sql"
pg_dump "$DB_URL" >"$OUT_FILE"
echo "✅ PostgreSQL backup saved to: $OUT_FILE"
