#!/bin/bash
#
# launchd-invoked weekly wrapper around scripts/mirror-check-schema-drift.ts.
# Exits non-zero if prod schema has diverged in a way the mirror would
# silently drop (new tables/columns/extensions in prod not yet in local).
#
# Manual invocation (for testing):
#   bash scripts/mirror-schema-drift-weekly.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="${MIRROR_LOG_DIR:-$HOME/.code-intel-digest-logs}"
LOG_FILE="$LOG_DIR/schema-drift.log"

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -maxdepth 1 -type f -name 'schema-drift.log*' -mtime +90 -delete 2>/dev/null || true

export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin:$PATH"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

log "=== schema-drift check start (pid $$) ==="

set +e
npx tsx scripts/mirror-check-schema-drift.ts >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

if [ "$EXIT_CODE" -eq 0 ]; then
  log "=== schema-drift check ok (no drift) ==="
else
  log "=== schema-drift check FOUND DRIFT exit=${EXIT_CODE} — see report above ==="
fi
exit "$EXIT_CODE"
