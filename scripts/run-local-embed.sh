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
  PAGE_SIZE="${PAGE_SIZE:-256}"
  BATCH_SIZE="${BATCH_SIZE:-16}"
  echo "GPU mode: NOMIC_DEVICE=$NOMIC_DEVICE page=$PAGE_SIZE batch=$BATCH_SIZE"
else
  PAGE_SIZE="${PAGE_SIZE:-64}"
  BATCH_SIZE="${BATCH_SIZE:-16}"
  echo "CPU mode: page=$PAGE_SIZE batch=$BATCH_SIZE (no .gpu-libs / no GPU)"
fi

# `--missing` paginates to exhaustion in ONE process, so a single successful pass
# embeds every currently-missing item. Retry ONLY on a non-zero exit (an OOM /
# SIGKILL mid-pass): --missing re-derives the set, so a retry naturally resumes
# from whatever already committed. We deliberately do NOT loop until coverage is
# green — coverage can never reach 100% while the permanently-unembeddable tail
# exists (URL-unresolvable / empty-text / norm-poisoned items; see i4t.3 notes),
# and looping on it would spin every night and mask a real failure.
MAX_ATTEMPTS="${MAX_ATTEMPTS:-3}"
attempt=0
embedded_ok=0
while [ "$attempt" -lt "$MAX_ATTEMPTS" ]; do
  attempt=$((attempt + 1))
  echo "=== embed pass ${attempt}/${MAX_ATTEMPTS} start $(date -u +%FT%TZ) ==="
  if npx tsx scripts/populate-model-embeddings.ts --missing \
      --page-size "$PAGE_SIZE" --batch-size "$BATCH_SIZE"; then
    embedded_ok=1
    echo "=== embed pass ${attempt} ok $(date -u +%FT%TZ) ==="
    break
  fi
  echo "=== embed pass ${attempt} exited non-zero $(date -u +%FT%TZ); retrying ===" >&2
done

# Coverage report for visibility only — non-fatal (it exits non-zero on the
# unembeddable tail by design, which is not a failure of this job).
npx tsx scripts/model-embedding-coverage.ts || true

if [ "$embedded_ok" -ne 1 ]; then
  echo "run-local-embed: all ${MAX_ATTEMPTS} embed passes failed" >&2
  exit 1
fi
