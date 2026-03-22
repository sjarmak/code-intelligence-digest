#!/bin/bash

# Quick full text status dashboard
# Run with: bash scripts/fulltext-status.sh

set -euo pipefail

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Set LOCAL_DATABASE_URL (preferred) or DATABASE_URL to your Postgres connection string."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for scripts/fulltext-status.sh (install Postgres client tools)."
  exit 1
fi

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║           Full Text Coverage Status Dashboard             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

echo "📊 OVERALL STATS"
echo "────────────────────────────────────────────────────────────"
psql "$DB_URL" <<'SQL'
\pset pager off
SELECT
  'Total Items' AS metric,
  COUNT(*)::text AS value
FROM items
UNION ALL
SELECT 'Cached (Full Text)', SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END)::text
FROM items
UNION ALL
SELECT 'Coverage %', ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1)::text
FROM items
UNION ALL
SELECT 'Cache Size (MB)', ROUND(SUM(LENGTH(COALESCE(full_text, '')))::numeric / 1024.0 / 1024.0, 2)::text
FROM items
UNION ALL
SELECT 'Never Attempted', SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END)::text
FROM items
UNION ALL
SELECT 'Errors', SUM(CASE WHEN full_text_source = 'error' THEN 1 ELSE 0 END)::text
FROM items;
SQL

echo ""
echo "📂 BY CATEGORY"
echo "────────────────────────────────────────────────────────────"
psql "$DB_URL" <<'SQL'
\pset pager off
SELECT
  category AS "Category",
  COUNT(*) AS "Total",
  SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) AS "Cached",
  ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS "Pct %"
FROM items
GROUP BY category
ORDER BY (ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1))::float DESC NULLS LAST;
SQL

echo ""
echo "🔧 NEXT ACTIONS"
echo "────────────────────────────────────────────────────────────"

NEVER_ATTEMPTED=$(psql "$DB_URL" -t -A -c "SELECT COALESCE(SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END),0)::bigint FROM items;")
RESEARCH_CACHED=$(psql "$DB_URL" -t -A -c "SELECT COALESCE(SUM(CASE WHEN category = 'research' AND full_text IS NOT NULL THEN 1 ELSE 0 END),0)::bigint FROM items;")
RESEARCH_TOTAL=$(psql "$DB_URL" -t -A -c "SELECT COUNT(*)::bigint FROM items WHERE category = 'research';")

if [ "${RESEARCH_TOTAL:-0}" -gt 0 ] && [ "${RESEARCH_CACHED:-0}" -lt "$((RESEARCH_TOTAL * 80 / 100))" ]; then
  echo "1. ⏳ Research still populating via ADS:"
  echo "   bash scripts/monitor-fulltext.sh"
else
  echo "1. ✅ Research population nearly complete"
fi

if [ "${NEVER_ATTEMPTED:-0}" -gt 100 ]; then
  echo ""
  echo "2. 📥 Run web scraping population:"
  echo "   npx tsx scripts/populate-fulltext-fast.ts"
else
  echo ""
  echo "2. ✅ Mostly complete!"
fi

echo ""
echo "3. 📊 Check detailed diagnostics:"
echo "   npx tsx scripts/archive/diagnose-fulltext-failures.ts"
echo ""
echo "4. 🤖 Setup automated post-sync:"
echo "   curl -X POST http://localhost:3002/api/admin/fulltext-after-sync"
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""
