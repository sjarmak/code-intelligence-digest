#!/bin/bash
# Fix Relevance Scores: Run Daily Sync and Check Coverage

set -e

echo "=== Code Intelligence Digest: Relevance Score Fix ==="
echo

# Check current coverage
echo "1. Current score coverage:"
sqlite3 .data/digest.db "
  SELECT 
    i.category,
    COUNT(DISTINCT i.id) as total_items,
    COUNT(DISTINCT s.item_id) as scored_items,
    ROUND(100.0 * COUNT(DISTINCT s.item_id) / COUNT(DISTINCT i.id), 1) as coverage_pct
  FROM items i
  LEFT JOIN item_scores s ON i.id = s.item_id
  WHERE i.published_at > datetime('now', '-7 days')
  GROUP BY i.category
  ORDER BY coverage_pct ASC;
" || echo "  (Scores table may be empty)"
echo

# Check last sync
echo "2. Last sync state:"
sqlite3 .data/digest.db "
  SELECT last_sync, last_error FROM sync_state ORDER BY last_sync DESC LIMIT 1;
" || echo "  (No sync state)"
echo

# Option A: Run daily sync (if server is running)
echo "3. Running daily sync (requires server running on :3002)..."
echo

ADMIN_TOKEN="${ADMIN_API_TOKEN:-admin-token}"

if curl -s http://localhost:3002/api/admin/sync-daily \
  -H "Authorization: Bearer $ADMIN_TOKEN" 2>/dev/null | grep -q success; then
  echo "✅ Sync triggered successfully"
  echo
  echo "   Waiting 30 seconds for sync to complete..."
  sleep 30
  
  echo "4. Score coverage after sync:"
  sqlite3 .data/digest.db "
    SELECT 
      i.category,
      COUNT(DISTINCT i.id) as total_items,
      COUNT(DISTINCT s.item_id) as scored_items,
      ROUND(100.0 * COUNT(DISTINCT s.item_id) / COUNT(DISTINCT i.id), 1) as coverage_pct
    FROM items i
    LEFT JOIN item_scores s ON i.id = s.item_id
    WHERE i.published_at > datetime('now', '-7 days')
    GROUP BY i.category
    ORDER BY coverage_pct ASC;
  "
  echo
  echo "✅ Sync complete. Now regenerate the digest:"
  echo
  echo "   curl -X POST http://localhost:3002/api/newsletter/generate \\
     -H 'Content-Type: application/json' \\
     -d '{
       \"categories\": [\"tech_articles\", \"ai_news\", \"newsletters\"],
       \"period\": \"week\",
       \"limit\": 20
     }'"
else
  echo "⚠️  Sync failed or server not running"
  echo
  echo "   Make sure the server is running:"
  echo "   npm run dev"
fi
