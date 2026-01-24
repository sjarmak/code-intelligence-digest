#!/bin/bash
# Backup local database (SQLite or PostgreSQL)

set -e

BACKUP_DIR=".data/backups"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

mkdir -p "$BACKUP_DIR"

# Check if SQLite exists
if [ -f ".data/digest.db" ]; then
  echo "📦 Backing up SQLite database..."
  cp ".data/digest.db" "$BACKUP_DIR/digest_${TIMESTAMP}.db"
  echo "✅ SQLite backup saved to: $BACKUP_DIR/digest_${TIMESTAMP}.db"
fi

# Check if PostgreSQL is configured
if [ -n "$LOCAL_DATABASE_URL" ] || [ -n "$DATABASE_URL" ]; then
  DB_URL="${LOCAL_DATABASE_URL:-$DATABASE_URL}"
  
  if [[ "$DB_URL" == postgresql://* ]]; then
    echo "📦 Backing up PostgreSQL database..."
    
    # Extract connection details
    # Format: postgresql://user:pass@host:port/dbname
    DB_NAME=$(echo "$DB_URL" | sed -n 's/.*\/\([^?]*\).*/\1/p')
    
    # Use pg_dump if available
    if command -v pg_dump &> /dev/null; then
      pg_dump "$DB_URL" > "$BACKUP_DIR/postgres_${TIMESTAMP}.sql"
      echo "✅ PostgreSQL backup saved to: $BACKUP_DIR/postgres_${TIMESTAMP}.sql"
    else
      echo "⚠️  pg_dump not found. Install PostgreSQL client tools to backup PostgreSQL."
    fi
  fi
fi

echo ""
echo "📊 Backup complete! Backups stored in: $BACKUP_DIR"

