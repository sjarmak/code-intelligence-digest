#!/usr/bin/env bash
# dv0.5.8: run the local nomic backfill to convergence.
#
# Re-runs the keyset-paginated encoder job (resuming from the checkpoint cursor
# in .data/nomic-backfill-cursor.json) until model-embedding-coverage reports
# embedded >= expected. Safe to re-run and to kill/restart: already-embedded
# items are skipped via source_hash, and each page checkpoints before the next.
#
# Run it in a REAL terminal (not an agent's background runner, which SIGKILLs
# the encoder). Foreground:
#   bash scripts/run-nomic-backfill.sh
# Detached (survives logout), logging to .data/:
#   nohup bash scripts/run-nomic-backfill.sh > .data/nomic-backfill-manual.log 2>&1 &
#   tail -f .data/nomic-backfill-manual.log
#
# Tunables (env): PAGE_SIZE (default 64), BATCH_SIZE (default 16). Lower the
# batch size if the machine is memory-constrained.
set -uo pipefail
cd "$(dirname "$0")/.."

# Self-log: mirror ALL output to .data/nomic-backfill-manual.log so you never
# have to type a fragile `> file 2>&1` redirect (which keeps getting split by
# multi-line terminal pastes). Just run `bash scripts/run-nomic-backfill.sh`.
mkdir -p .data
exec > >(tee -a .data/nomic-backfill-manual.log) 2>&1

PAGE_SIZE="${PAGE_SIZE:-64}"
BATCH_SIZE="${BATCH_SIZE:-16}"

pass=0
while true; do
  pass=$((pass + 1))
  echo "=== populate pass ${pass} start $(date -u +%FT%TZ) (page=${PAGE_SIZE} batch=${BATCH_SIZE}) ==="
  npx tsx scripts/populate-model-embeddings.ts --page-size "${PAGE_SIZE}" --batch-size "${BATCH_SIZE}"
  echo "=== populate pass ${pass} exit=$? $(date -u +%FT%TZ) ==="
  if npx tsx scripts/model-embedding-coverage.ts; then
    echo "=== CONVERGED at pass ${pass} $(date -u +%FT%TZ) ==="
    break
  fi
done
