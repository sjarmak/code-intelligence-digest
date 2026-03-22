#!/bin/bash

# Real-time monitoring for full text population progress
# Run this in a separate terminal while populate-research-fulltext.ts is running

set -euo pipefail

DB_URL="${LOCAL_DATABASE_URL:-${DATABASE_URL:-}}"
if [ -z "$DB_URL" ]; then
  echo "Set LOCAL_DATABASE_URL (preferred) or DATABASE_URL to your Postgres connection string."
  exit 1
fi

if ! command -v psql >/dev/null 2>&1; then
  echo "psql is required for scripts/monitor-fulltext.sh (install Postgres client tools)."
  exit 1
fi

echo "📊 Full Text Coverage Monitor"
echo "=================================="
echo ""

show_stats() {
  psql "$DB_URL" <<'EOF'
\pset pager off
WITH stats AS (
  SELECT
    '📈 OVERALL'::text AS metric,
    COUNT(*)::bigint AS total,
    SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END)::bigint AS cached,
    ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / NULLIF(COUNT(*), 0), 1) AS pct_cached,
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
)
SELECT * FROM stats ORDER BY pct_cached DESC NULLS LAST;
EOF
}

echo "Initial status:"
echo ""
show_stats

echo ""
echo "Refreshing every 5 seconds... (Ctrl+C to stop)"
echo ""

while true; do
  sleep 5
  clear
  echo "📊 Full Text Coverage Monitor"
  echo "=================================="
  echo "Last updated: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
  show_stats
  echo ""
  echo "Press Ctrl+C to stop monitoring"
done
