#!/usr/bin/env bash
#
# Local-primary nomic embedding refresh (bead code-intel-digest-i4t.3 / epic i4t).
#
# Embeds items that are MISSING a normalized nomic (768d) row in
# item_model_embeddings, so new arrivals become visible to the HNSW/nomic serve
# path. Runs AFTER the daily ingestion (ordered by systemd: this unit declares
# After=code-intel-daily.service, and the daily unit Wants= this one), so it
# always sees the items the sync just wrote.
#
# Selection uses `populate-model-embeddings.ts --missing` (an anti-join against
# item_model_embeddings, NO published_at window), which:
#   - catches newly-ingested items with OLD publish dates (a --since-days window
#     silently skips them), and
#   - loads full_text for the missing set only (not the ~116K corpus), so it
#     stays within the memory budget instead of OOM-killing.
#
# USE_LOCAL_DB=true forces the driver onto LOCAL_DATABASE_URL; the preflight
# guard refuses to run unless that URL is a local postgres host, so a missing or
# misconfigured .env.local can NEVER let the scheduled job write the (being
# decommissioned) Render production database.
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

# Preflight: assert LOCAL_DATABASE_URL is a local postgres URL (same guard as
# run-local-cron.sh). Uses dotenv so .env.local is parsed exactly as the app does.
npx tsx -e "
require('dotenv').config({ path: '.env.local', quiet: true });
const u = process.env.LOCAL_DATABASE_URL || '';
if (!/^postgres(ql)?:\/\/.*@(localhost|127\.0\.0\.1):/.test(u)) {
  console.error('run-local-embed: LOCAL_DATABASE_URL is not a local postgres URL; refusing to run.');
  process.exit(1);
}
"

export USE_LOCAL_DB=true

# GPU mode: if the CUDA-12 runtime libs are present (.gpu-libs/) and a GPU is
# visible, run the encoder on it (~1000x faster than CPU). Mirrors the detection
# in scripts/run-nomic-backfill.sh.
if [ -d .gpu-libs ] && command -v nvidia-smi >/dev/null 2>&1; then
  export LD_LIBRARY_PATH="$(find "$PWD/.gpu-libs/nvidia" -name lib -type d | tr '\n' ':')${LD_LIBRARY_PATH:-}"
  export NOMIC_DEVICE="${NOMIC_DEVICE:-cuda}"
  # Measured 2026-09-01: page=256/batch=16 dies partway through the corpus with
  # an onnxruntime BFCArena allocation failure (a [16, 1956] batch asks for a
  # 2.9GB BiasSoftmax buffer: batch x heads x seq^2 x 4B). page=64/batch=4 keeps
  # the peak near 8.7GB of the 32GB card and completed the corpus.
  PAGE_SIZE="${PAGE_SIZE:-64}"
  BATCH_SIZE="${BATCH_SIZE:-4}"
  echo "GPU mode: NOMIC_DEVICE=$NOMIC_DEVICE page=$PAGE_SIZE batch=$BATCH_SIZE"
else
  PAGE_SIZE="${PAGE_SIZE:-64}"
  BATCH_SIZE="${BATCH_SIZE:-16}"
  echo "CPU mode: page=$PAGE_SIZE batch=$BATCH_SIZE (no .gpu-libs / no GPU)"
fi

# Bounded passes, each in a FRESH process. onnxruntime's BFC arena grows to the
# largest batch it has seen and never shrinks, so one long-lived process walking
# the whole corpus eventually fails even a small allocation (measured
# 2026-09-01: died at 92.5% coverage, then could not allocate 89MB). Exiting
# between chunks resets the arena. A pass killed mid-flight (SIGABRT/rc=134)
# still commits what it embedded, and --missing re-derives the set, so the next
# pass resumes with no bookkeeping.
#
# Stop on the first pass that makes NO progress. Two things look alike there,
# and the pass's own exit code separates them:
#   rc == 0, no progress -> converged. Everything still missing is the
#            permanently-unembeddable tail (URL-unresolvable / empty-text /
#            norm-poisoned items; see i4t.3 notes), or the ingest added nothing
#            new. Steady state, not an error.
#   rc != 0, no progress -> the pass died without committing anything. Real
#            failure; surface it.
# Looping past a no-progress pass would spin every night and mask both.
PASS_LIMIT="${PASS_LIMIT:-2000}"
MAX_PASSES="${MAX_PASSES:-60}"

missing_count() {
  psql "$LOCAL_DATABASE_URL" -tAc "select count(*) from items i where not exists (select 1 from item_model_embeddings e where e.item_id = i.id and e.model_name = 'nomic-embed-text-v1.5');"
}

# The progress probe needs the URL in the shell. Read it through dotenv rather
# than sourcing .env.local, so shell word-splitting can never parse it
# differently from the way the app does.
LOCAL_DATABASE_URL="$(npx tsx -e "
require('dotenv').config({ path: '.env.local', quiet: true });
process.stdout.write(process.env.LOCAL_DATABASE_URL || '');
")"

prev_missing="$(missing_count)"
echo "=== embed start $(date -u +%FT%TZ): ${prev_missing} item(s) missing a nomic row ==="
pass=0
stalled=0
while [ "$pass" -lt "$MAX_PASSES" ]; do
  pass=$((pass + 1))
  pass_rc=0
  npx tsx scripts/populate-model-embeddings.ts --missing \
      --page-size "$PAGE_SIZE" --batch-size "$BATCH_SIZE" --limit "$PASS_LIMIT" || pass_rc=$?
  now_missing="$(missing_count)"
  echo "=== embed pass ${pass}: rc=${pass_rc} missing ${prev_missing} -> ${now_missing} $(date -u +%FT%TZ) ==="
  if [ "$now_missing" -eq 0 ]; then
    break
  fi
  if [ "$now_missing" -ge "$prev_missing" ]; then
    if [ "$pass_rc" -ne 0 ]; then
      stalled=1
      echo "=== embed pass ${pass} died (rc=${pass_rc}) without embedding anything; ${now_missing} remaining ===" >&2
    else
      echo "=== embed converged: ${now_missing} item(s) remain unembeddable ==="
    fi
    break
  fi
  prev_missing="$now_missing"
done

# Coverage report for visibility only — non-fatal (it exits non-zero on the
# unembeddable tail by design, which is not a failure of this job).
npx tsx scripts/model-embedding-coverage.ts || true

if [ "$stalled" -ne 0 ]; then
  echo "run-local-embed: embed pass failed without committing any embeddings" >&2
  exit 1
fi
