#!/bin/bash
# Run weekly sync and display status
# Optimized: 1 API call (caches user ID after first run)

set -e

API_URL="${API_URL:-http://localhost:3002}"
ENDPOINT="$API_URL/api/admin/sync-weekly"

echo "🔄 Starting weekly sync (last 7 days, ~1 API call)..."
echo "POST $ENDPOINT"
echo ""

# Run sync
RESPONSE=$(curl -s -X POST "$ENDPOINT")

# Parse JSON response
SUCCESS=$(echo "$RESPONSE" | jq -r '.success // false')
ITEMS=$(echo "$RESPONSE" | jq -r '.itemsAdded // 0')
CALLS=$(echo "$RESPONSE" | jq -r '.apiCallsUsed // 0')
PAUSED=$(echo "$RESPONSE" | jq -r '.paused // false')
ERROR=$(echo "$RESPONSE" | jq -r '.error // empty')

# Display results
if [ "$SUCCESS" = "true" ]; then
  echo "✅ Sync completed successfully!"
  echo "   Items added: $ITEMS"
  echo "   API calls used: $CALLS/100"
  echo "   Remaining: $((100 - CALLS)) calls"
elif [ "$PAUSED" = "true" ]; then
  echo "⏸️  Sync paused (rate limit approaching)"
  echo "   Items added: $ITEMS"
  echo "   API calls used: $CALLS/100"
  echo "   Will resume tomorrow or on next manual run"
  if [ ! -z "$ERROR" ]; then
    echo "   Reason: $ERROR"
  fi
else
  echo "❌ Sync failed"
  echo "$RESPONSE" | jq '.'
fi

echo ""
echo "📊 Full response:"
echo "$RESPONSE" | jq '.'
