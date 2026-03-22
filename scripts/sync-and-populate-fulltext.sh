#!/bin/bash

# Combined sync and full text population script
# Run after daily sync to ensure new items get full text fetched
#
# Usage:
#   bash scripts/sync-and-populate-fulltext.sh       # Sync + smart population
#   bash scripts/sync-and-populate-fulltext.sh fast  # Quick research-only
#   bash scripts/sync-and-populate-fulltext.sh skip  # Sync only, no fulltext

set -euo pipefail

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Set LOCAL_DATABASE_URL (preferred) or DATABASE_URL to your Postgres connection string."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for scripts/sync-and-populate-fulltext.sh (install Postgres client tools)."
  exit 1
fi

SKIP_FULLTEXT=${1:-false}

log_step() {
  echo ""
  echo "=================================="
  echo "🔄 $1"
  echo "=================================="
  echo ""
}

log_step "STEP 1: Running daily sync"
curl -X POST http://localhost:3002/api/admin/sync-daily | jq '.itemsAdded, .apiCallsUsed'

log_step "STEP 2: Checking full text coverage before"
psql "$DB_URL" <<'EOF'
\pset pager off
SELECT
  category,
  COUNT(*) AS total,
  SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) AS cached,
  ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS pct
FROM items
GROUP BY category
ORDER BY pct DESC NULLS LAST;
EOF

if [ "$SKIP_FULLTEXT" = "skip" ]; then
  log_step "Skipping full text population (use 'skip' flag)"
  exit 0
fi

if [ "$SKIP_FULLTEXT" = "fast" ]; then
  log_step "STEP 3: Fast research-only population (arXiv via ADS)"
  set -a && source .env.local && set +a
  npx tsx scripts/populate-research-fulltext.ts
else
  log_step "STEP 3: Smart full text population"
  log_step "   3a: Research category (via ADS API)"
  set -a && source .env.local && set +a
  timeout 15m npx tsx scripts/populate-research-fulltext.ts || true

  log_step "   3b: Other categories (web scraping)"
  npx tsx scripts/populate-fulltext-fast.ts || true
fi

log_step "STEP 4: Final coverage report"
psql "$DB_URL" <<'EOF'
\pset pager off
SELECT
  '📊 FINAL COVERAGE' AS metric,
  COUNT(*)::bigint AS total,
  SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END)::bigint AS cached,
  ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS pct,
  ROUND(SUM(LENGTH(COALESCE(full_text, '')))::numeric / 1024.0 / 1024.0, 2) AS cache_mb
FROM items
UNION ALL
SELECT
  category::text,
  COUNT(*)::bigint,
  SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END)::bigint,
  ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1),
  ROUND(SUM(LENGTH(COALESCE(full_text, '')))::numeric / 1024.0 / 1024.0, 2)
FROM items
GROUP BY category
ORDER BY (ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1))::float DESC NULLS LAST;
EOF

log_step "✅ Sync and population complete!"
