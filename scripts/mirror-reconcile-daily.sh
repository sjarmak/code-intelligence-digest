#!/bin/bash
#
# launchd-invoked daily wrapper around scripts/mirror-reconcile-deletes.ts.
# Runs once a day to catch rows that were hard-deleted in prod (the hourly
# watermark-driven sync can only observe INSERTs / UPDATEs).
#
# Manual invocation (for testing):
#   bash scripts/mirror-reconcile-daily.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="${MIRROR_LOG_DIR:-$HOME/.code-intel-digest-logs}"
LOG_FILE="$LOG_DIR/reconcile.log"

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -maxdepth 1 -type f -name 'reconcile.log*' -mtime +60 -delete 2>/dev/null || true

export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin:$PATH"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

log "=== reconcile run start (pid $$) ==="
START=$(date +%s)

set +e
npx tsx scripts/mirror-reconcile-deletes.ts >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

DURATION=$(($(date +%s) - START))
if [ "$EXIT_CODE" -eq 0 ]; then
  log "=== reconcile run ok (${DURATION}s) ==="
else
  log "=== reconcile run FAILED exit=${EXIT_CODE} duration=${DURATION}s ==="
fi
exit "$EXIT_CODE"
