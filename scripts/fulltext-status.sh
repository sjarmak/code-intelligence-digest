#!/bin/bash

# Quick full text status dashboard
# Run with: bash scripts/fulltext-status.sh

echo ""
echo "╔════════════════════════════════════════════════════════════╗"
echo "║           Full Text Coverage Status Dashboard             ║"
echo "╚════════════════════════════════════════════════════════════╝"
echo ""

DB_PATH=".data/digest.db"

# Overall stats
echo "📊 OVERALL STATS"
echo "────────────────────────────────────────────────────────────"
sqlite3 "$DB_PATH" << SQL
SELECT
  'Total Items' as metric,
  COUNT(*) as value
FROM items
UNION ALL
SELECT 'Cached (Full Text)', SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END)
FROM items
UNION ALL
SELECT 'Coverage %', ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1)
FROM items
UNION ALL
SELECT 'Cache Size (MB)', ROUND(SUM(LENGTH(COALESCE(full_text, ''))) / 1024.0 / 1024.0, 2)
FROM items
UNION ALL
SELECT 'Never Attempted', SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END)
FROM items
UNION ALL
SELECT 'Errors', SUM(CASE WHEN full_text_source = 'error' THEN 1 ELSE 0 END)
FROM items;
SQL

echo ""
echo "📂 BY CATEGORY"
echo "────────────────────────────────────────────────────────────"
sqlite3 "$DB_PATH" << SQL
SELECT
  category as 'Category',
  COUNT(*) as 'Total',
  SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as 'Cached',
  ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as 'Pct %'
FROM items
GROUP BY category
ORDER BY CAST(ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) AS FLOAT) DESC;
SQL

echo ""
echo "🔧 NEXT ACTIONS"
echo "────────────────────────────────────────────────────────────"

NEVER_ATTEMPTED=$(sqlite3 "$DB_PATH" "SELECT SUM(CASE WHEN full_text IS NULL AND full_text_source IS NULL THEN 1 ELSE 0 END) FROM items;")
RESEARCH_CACHED=$(sqlite3 "$DB_PATH" "SELECT SUM(CASE WHEN category = 'research' AND full_text IS NOT NULL THEN 1 ELSE 0 END) FROM items;")
RESEARCH_TOTAL=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM items WHERE category = 'research';")

if [ "$RESEARCH_CACHED" -lt "$((RESEARCH_TOTAL * 80 / 100))" ]; then
  echo "1. ⏳ Research still populating via ADS:"
  echo "   bash scripts/monitor-fulltext.sh"
else
  echo "1. ✅ Research population nearly complete"
fi

if [ "$NEVER_ATTEMPTED" -gt 100 ]; then
  echo ""
  echo "2. 📥 Run web scraping population:"
  echo "   npx tsx scripts/populate-fulltext-fast.ts"
else
  echo ""
  echo "2. ✅ Mostly complete!"
fi

echo ""
echo "3. 📊 Check detailed diagnostics:"
echo "   npx tsx scripts/diagnose-fulltext-failures.ts"
echo ""
echo "4. 🤖 Setup automated post-sync:"
echo "   curl -X POST http://localhost:3002/api/admin/fulltext-after-sync"
echo ""
echo "════════════════════════════════════════════════════════════"
echo ""
