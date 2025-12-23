#!/bin/bash
# Restore the database from the most recent backup
# Usage: ./scripts/restore-db.sh [backup_file]

BACKUP_DIR="$HOME/.code-intel-digest-backups"
TARGET_DB=".data/digest.db"

if [ -n "$1" ]; then
    # Use specified backup file
    BACKUP_FILE="$1"
else
    # Find most recent backup
    BACKUP_FILE=$(ls -t "$BACKUP_DIR"/digest.db.* 2>/dev/null | head -1)
fi

if [ -z "$BACKUP_FILE" ] || [ ! -f "$BACKUP_FILE" ]; then
    echo "✗ No backup found"
    echo "Available backups:"
    ls -la "$BACKUP_DIR"/digest.db.* 2>/dev/null || echo "  (none)"
    exit 1
fi

# Check backup has data
SIZE=$(stat -f%z "$BACKUP_FILE" 2>/dev/null || stat -c%s "$BACKUP_FILE" 2>/dev/null)
if [ "$SIZE" -lt 1000 ]; then
    echo "✗ Backup file is empty or too small"
    exit 1
fi

echo "Restoring from: $BACKUP_FILE"
echo "Size: $SIZE bytes"

# Backup current db first (if exists and not empty)
if [ -f "$TARGET_DB" ]; then
    CURRENT_SIZE=$(stat -f%z "$TARGET_DB" 2>/dev/null || stat -c%s "$TARGET_DB" 2>/dev/null)
    if [ "$CURRENT_SIZE" -gt 1000 ]; then
        mv "$TARGET_DB" "$TARGET_DB.before-restore"
        echo "✓ Current database saved as $TARGET_DB.before-restore"
    fi
fi

cp "$BACKUP_FILE" "$TARGET_DB"
echo "✓ Database restored from $BACKUP_FILE"

# Verify
sqlite3 "$TARGET_DB" "SELECT COUNT(*) || ' items' FROM items;" 2>/dev/null || echo "⚠ Could not verify (sqlite3 not available)"
