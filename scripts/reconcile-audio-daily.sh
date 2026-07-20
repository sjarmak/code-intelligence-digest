#!/usr/bin/env bash
#
# Daily audio orphan sweep wrapper (bead code-intel-digest-b1l).
#
# Invoked by the systemd user timer (deploy/systemd/code-intel-reconcile-audio.timer)
# around scripts/reconcile-audio-storage.ts, which deletes stored audio objects
# that no generated_podcast_audio row references.
#
# Three guards matter here, because the sweep compares LOCAL DISK against DB ROWS:
#
#   1. USE_LOCAL_DB=true, preflight-asserted. The driver otherwise falls back to
#      LOCAL_DATABASE_URL || DATABASE_URL, so a missing or misconfigured
#      .env.local would have it read the (being decommissioned) Render prod DB
#      while sweeping the local store. Every local file would then look
#      unreferenced and the sweep would delete the whole store.
#
#   2. Dry-run by default. Set RECONCILE_AUDIO_APPLY=true to let it delete.
#      bd-b1l calls for reading orphaned/reclaimable counts for a few runs
#      before arming it; making that the default means an un-promoted job is
#      inert rather than destructive.
#
#   3. The empty-reference-set interlock, in the sweep itself (bd-jow). Guard 1
#      proves this URL is *a* local postgres; it cannot prove it is the instance
#      whose rows back this store, and a second local instance reads as "nothing
#      is referenced" rather than as an error. The sweep refuses to delete when
#      it resolves zero references against a non-empty store. Override with
#      --allow-empty-reference-set once the store is confirmed all-orphan.
#
# Manual invocation (for testing):
#   bash scripts/reconcile-audio-daily.sh                        # report only
#   RECONCILE_AUDIO_APPLY=true bash scripts/reconcile-audio-daily.sh
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

LOG_DIR="${MIRROR_LOG_DIR:-$HOME/.code-intel-digest-logs}"
LOG_FILE="$LOG_DIR/reconcile-audio.log"

mkdir -p "$LOG_DIR"
find "$LOG_DIR" -maxdepth 1 -type f -name 'reconcile-audio.log*' -mtime +60 -delete 2>/dev/null || true

log() {
  printf '[%s] %s\n' "$(date '+%Y-%m-%d %H:%M:%S')" "$*" >> "$LOG_FILE"
}

if ! bash scripts/lib/assert-local-db.sh reconcile-audio-daily >> "$LOG_FILE" 2>&1; then
  log "=== audio sweep ABORTED: LOCAL_DATABASE_URL preflight failed ==="
  exit 1
fi

export USE_LOCAL_DB=true

if [ "${RECONCILE_AUDIO_APPLY:-false}" = "true" ]; then
  MODE="apply"
  NPM_SCRIPT="reconcile:audio"
else
  MODE="dry-run"
  NPM_SCRIPT="reconcile:audio:dry-run"
fi

log "=== audio sweep start (pid $$, mode=$MODE) ==="
START=$(date +%s)

set +e
npm run --silent "$NPM_SCRIPT" >> "$LOG_FILE" 2>&1
EXIT_CODE=$?
set -e

DURATION=$(($(date +%s) - START))
if [ "$EXIT_CODE" -eq 0 ]; then
  log "=== audio sweep ok (mode=$MODE ${DURATION}s) ==="
else
  log "=== audio sweep FAILED exit=${EXIT_CODE} mode=$MODE duration=${DURATION}s ==="
fi
exit "$EXIT_CODE"
