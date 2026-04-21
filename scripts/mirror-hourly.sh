#!/bin/bash
#
# launchd-invoked hourly wrapper around scripts/mirror-from-production.ts.
#
# Expected to be called non-interactively (no TTY). Handles:
#   - locating the repo + cd'ing to it
#   - ensuring $PATH has Node/npm (launchd inherits a minimal PATH)
#   - concurrency via a lockfile (if a previous run is still going, skip)
#   - timestamped append-only logging to ~/.code-intel-digest-logs/mirror.log
#   - rotation: logs older than 30 days get deleted
#
# Manual invocation (for testing):
#   bash scripts/mirror-hourly.sh

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

LOG_DIR="${MIRROR_LOG_DIR:-$HOME/.code-intel-digest-logs}"
LOG_FILE="$LOG_DIR/mirror.log"
LOCK_FILE="$LOG_DIR/mirror.lock"

mkdir -p "$LOG_DIR"

# Rotate: remove log files older than 30 days
find "$LOG_DIR" -maxdepth 1 -type f \( -name 'mirror.log*' -o -name 'launchd.*.log*' \) \
  -mtime +30 -delete 2>/dev/null || true

# launchd provides a minimal PATH; prepend common install locations.
export PATH="/opt/homebrew/bin:/usr/local/bin:/opt/homebrew/opt/node/bin:$PATH"

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

# Concurrency: if the previous run is still running, skip this tick.
if [ -f "$LOCK_FILE" ]; then
  PREV_PID="$(cat "$LOCK_FILE" 2>/dev/null || true)"
  if [ -n "$PREV_PID" ] && kill -0 "$PREV_PID" 2>/dev/null; then
    log "SKIP: previous run (pid $PREV_PID) still in progress"
    exit 0
  fi
  log "WARN: stale lock file (pid ${PREV_PID:-unknown} not running); clearing"
  rm -f "$LOCK_FILE"
fi

echo $$ > "$LOCK_FILE"
trap 'rm -f "$LOCK_FILE"' EXIT

log "=== mirror run start (pid $$) ==="
START=$(date +%s)

set +e
npx tsx scripts/mirror-from-production.ts >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

DURATION=$(($(date +%s) - START))

if [ "$EXIT_CODE" -eq 0 ]; then
  log "=== mirror run ok (${DURATION}s) ==="
else
  log "=== mirror run FAILED exit=${EXIT_CODE} duration=${DURATION}s ==="
fi

exit "$EXIT_CODE"
