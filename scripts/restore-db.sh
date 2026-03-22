#!/bin/bash
# Restore the database from the most recent backup
# Usage: ./scripts/restore-db.sh [backup_file.sql]

set -euo pipefail

BACKUP_DIR="$HOME/.code-intel-digest-backups"

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Set LOCAL_DATABASE_URL (preferred) or DATABASE_URL to your local Postgres connection string."
  exit 1
fi

if [[ "$DB_URL" != postgres://* ]] && [[ "$DB_URL" != postgresql://* ]]; then
  echo "DATABASE_URL / LOCAL_DATABASE_URL must be a postgres:// or postgresql:// connection string."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql not found. Install PostgreSQL client tools to restore Postgres."
  exit 1
fi

if [ -n "${1:-}" ]; then
  BACKUP_FILE="$1"
else
  BACKUP_FILE=$(ls -t "$BACKUP_DIR"/postgres_*.sql 2>/dev/null | head -1 || true)
fi

if [ -z "${BACKUP_FILE:-}" ] || [ ! -f "$BACKUP_FILE" ]; then
  echo "✗ No backup found"
  echo "Available backups:"
  ls -la "$BACKUP_DIR"/postgres_*.sql 2>/dev/null || echo "  (none)"
  exit 1
fi

SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
if [ "$SIZE" -lt 1000 ]; then
  echo "✗ Backup file is empty or too small"
  exit 1
fi

echo "Restoring from: $BACKUP_FILE"
echo "Size: $SIZE bytes"

echo "⚠️  This will apply SQL to: $DB_URL"
psql "$DB_URL" -v ON_ERROR_STOP=1 -f "$BACKUP_FILE"

echo "✓ Restore complete"

echo ""
echo "Verify:"
psql "$DB_URL" -c "SELECT COUNT(*)::bigint AS items FROM items;" || true
