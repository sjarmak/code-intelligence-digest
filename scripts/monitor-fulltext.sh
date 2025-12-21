#!/bin/bash

# Real-time monitoring for full text population progress
# Run this in a separate terminal while populate-research-fulltext.ts is running

DB_PATH=".data/digest.db"

echo "📊 Full Text Coverage Monitor"
echo "=================================="
echo ""

# Function to get stats
show_stats() {
  sqlite3 "$DB_PATH" << EOF
    WITH stats AS (
      SELECT
        '📈 OVERALL' as metric,
        COUNT(*) as total,
        SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) as cached,
        ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1) as pct_cached,
        ROUND(SUM(LENGTH(COALESCE(full_text, ''))) / 1024.0 / 1024.0, 2) as cache_mb
      FROM items
      UNION ALL
      SELECT
        category as metric,
        COUNT(*),
        SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END),
        ROUND(100.0 * SUM(CASE WHEN full_text IS NOT NULL THEN 1 ELSE 0 END) / COUNT(*), 1),
        ROUND(SUM(LENGTH(COALESCE(full_text, ''))) / 1024.0 / 1024.0, 2)
      FROM items
      GROUP BY category
    )
    SELECT * FROM stats ORDER BY pct_cached DESC;
EOF
}

# Format output nicely
format_stats() {
  column -t -s'|' -N "Metric,Total,Cached,Coverage%,CacheMB"
}

# Show initial state
echo "Initial status:"
echo ""
show_stats | format_stats

echo ""
echo "Refreshing every 5 seconds... (Ctrl+C to stop)"
echo ""

# Loop for continuous monitoring
while true; do
  sleep 5
  clear
  echo "📊 Full Text Coverage Monitor"
  echo "=================================="
  echo "Last updated: $(date '+%Y-%m-%d %H:%M:%S')"
  echo ""
  show_stats | format_stats
  echo ""
  echo "Press Ctrl+C to stop monitoring"
done
