#!/bin/bash
# Backup the local SQLite database
# Run periodically or before major operations

BACKUP_DIR="$HOME/.code-intel-digest-backups"
SOURCE_DB=".data/digest.db"
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

# Create backup directory if needed
mkdir -p "$BACKUP_DIR"

if [ -f "$SOURCE_DB" ]; then
    # Check if database has data (not empty)
    SIZE=$(stat -f%z "$SOURCE_DB" 2>/dev/null || stat -c%s "$SOURCE_DB" 2>/dev/null)
    if [ "$SIZE" -gt 1000 ]; then
        cp "$SOURCE_DB" "$BACKUP_DIR/digest.db.$TIMESTAMP"
        echo "✓ Backup created: $BACKUP_DIR/digest.db.$TIMESTAMP ($(numfmt --to=iec-i --suffix=B $SIZE 2>/dev/null || echo "${SIZE} bytes"))"

        # Keep only last 10 backups
        cd "$BACKUP_DIR"
        ls -t digest.db.* 2>/dev/null | tail -n +11 | xargs rm -f 2>/dev/null
        echo "✓ Keeping last 10 backups"
        ls -la "$BACKUP_DIR"
    else
        echo "⚠ Database file is empty or too small (${SIZE} bytes), skipping backup"
        exit 1
    fi
else
    echo "✗ Database not found at $SOURCE_DB"
    exit 1
fi
