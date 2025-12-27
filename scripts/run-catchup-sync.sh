#!/bin/bash
# Run catch-up sync to fetch items from the last N days
# Usage: ./scripts/run-catchup-sync.sh [days]
# Example: ./scripts/run-catchup-sync.sh 7

set -e

DAYS="${1:-7}"  # Default to 7 days if not specified
API_URL="${API_URL:-http://localhost:3002}"
ENDPOINT="$API_URL/api/admin/sync-catchup?days=$DAYS"

echo "🔄 Starting catch-up sync (last $DAYS days)..."
echo "POST $ENDPOINT"
echo ""

# Run sync
RESPONSE=$(curl -s -X POST "$ENDPOINT")

# Check if we got redirected to login
if echo "$RESPONSE" | grep -q "login"; then
  echo "❌ Authentication required"
  echo "Please ensure you're logged in or provide authentication token"
  echo ""
  echo "You can also run it directly with:"
  echo "  npx tsx -e \"import { initializeDatabase } from './src/lib/db/index'; import { runDailySync } from './src/lib/sync/daily-sync'; (async () => { await initializeDatabase(); const result = await runDailySync({ lookbackDays: $DAYS }); console.log(JSON.stringify(result, null, 2)); })();\""
  exit 1
fi

# Parse JSON response
SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false' 2>/dev/null || echo "false")
ITEMS=$(echo "$RESPONSE" | jq -r '.itemsAdded // 0' 2>/dev/null || echo "0")
CALLS=$(echo "$RESPONSE" | jq -r '.apiCallsUsed // 0' 2>/dev/null || echo "0")
PAUSED=$(echo "$RESPONSE" | jq -r '.paused // false' 2>/dev/null || echo "false")
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty' 2>/dev/null || echo "")

# Display results
if [ "$SUCCESS" = "true" ]; then
  echo "✅ Catch-up sync completed successfully!"
  echo "   Items added: $ITEMS"
  echo "   API calls used: $CALLS"
  if [ ! -z "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "   Note: $ERROR"
  fi
elif [ "$PAUSED" = "true" ]; then
  echo "⏸️  Sync paused (rate limit approaching)"
  echo "   Items added: $ITEMS"
  echo "   API calls used: $CALLS"
  echo "   Will resume on next run"
  if [ ! -z "$ERROR" ] && [ "$ERROR" != "null" ]; then
    echo "   Reason: $ERROR"
  fi
else
  echo "❌ Sync failed or requires authentication"
  echo ""
  echo "Full response:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
fi

echo ""

