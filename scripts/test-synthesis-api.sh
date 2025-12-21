#!/bin/bash

# Test script for newsletter and podcast synthesis endpoints
# Usage: bash scripts/test-synthesis-api.sh

set -e

BASE_URL="${BASE_URL:-http://localhost:3000}"
ADMIN_TOKEN="${ADMIN_API_TOKEN:-demo-token}"

echo "=== Testing Synthesis APIs ==="
echo "Base URL: $BASE_URL"
echo ""

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Test 1: Newsletter with prompt
echo -e "${BLUE}Test 1: Newsletter Generation with Prompt${NC}"
echo "Request:"
cat <<'EOF'
{
  "categories": ["tech_articles", "ai_news"],
  "period": "week",
  "limit": 10,
  "prompt": "Focus on code search and developer productivity. Emphasize actionable takeaways."
}
EOF

RESPONSE=$(curl -s -X POST "$BASE_URL/api/newsletter/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["tech_articles", "ai_news"],
    "period": "week",
    "limit": 10,
    "prompt": "Focus on code search and developer productivity. Emphasize actionable takeaways."
  }')

echo ""
echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

# Check response has required fields
if echo "$RESPONSE" | jq -e '.id and .title and .markdown and .summary' >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Newsletter with prompt: PASS${NC}"
else
  echo -e "${RED}✗ Newsletter with prompt: FAIL${NC}"
fi
echo ""

# Test 2: Newsletter without prompt
echo -e "${BLUE}Test 2: Newsletter Generation without Prompt${NC}"
echo "Request:"
cat <<'EOF'
{
  "categories": ["research", "product_news"],
  "period": "month",
  "limit": 15
}
EOF

RESPONSE=$(curl -s -X POST "$BASE_URL/api/newsletter/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["research", "product_news"],
    "period": "month",
    "limit": 15
  }')

echo ""
echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

if echo "$RESPONSE" | jq -e '.id and .title' >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Newsletter without prompt: PASS${NC}"
else
  echo -e "${RED}✗ Newsletter without prompt: FAIL${NC}"
fi
echo ""

# Test 3: Podcast with prompt
echo -e "${BLUE}Test 3: Podcast Generation with Prompt${NC}"
echo "Request:"
cat <<'EOF'
{
  "categories": ["podcasts", "tech_articles"],
  "period": "week",
  "limit": 10,
  "prompt": "Create an engaging episode about AI agents for code generation",
  "voiceStyle": "conversational"
}
EOF

RESPONSE=$(curl -s -X POST "$BASE_URL/api/podcast/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["podcasts", "tech_articles"],
    "period": "week",
    "limit": 10,
    "prompt": "Create an engaging episode about AI agents for code generation",
    "voiceStyle": "conversational"
  }')

echo ""
echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

if echo "$RESPONSE" | jq -e '.id and .transcript and .segments' >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Podcast with prompt: PASS${NC}"
else
  echo -e "${RED}✗ Podcast with prompt: FAIL${NC}"
fi
echo ""

# Test 4: Podcast without prompt
echo -e "${BLUE}Test 4: Podcast Generation without Prompt${NC}"
echo "Request:"
cat <<'EOF'
{
  "categories": ["ai_news", "product_news"],
  "period": "week",
  "voiceStyle": "technical"
}
EOF

RESPONSE=$(curl -s -X POST "$BASE_URL/api/podcast/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["ai_news", "product_news"],
    "period": "week",
    "voiceStyle": "technical"
  }')

echo ""
echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

if echo "$RESPONSE" | jq -e '.id and .transcript' >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Podcast without prompt: PASS${NC}"
else
  echo -e "${RED}✗ Podcast without prompt: FAIL${NC}"
fi
echo ""

# Test 5: Validation - invalid category
echo -e "${BLUE}Test 5: Validation - Invalid Category${NC}"
RESPONSE=$(curl -s -X POST "$BASE_URL/api/newsletter/generate" \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["invalid_category"],
    "period": "week"
  }')

echo "Response:"
echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
echo ""

if echo "$RESPONSE" | jq -e '.error' >/dev/null 2>&1; then
  echo -e "${GREEN}✓ Validation error handling: PASS${NC}"
else
  echo -e "${RED}✗ Validation error handling: FAIL${NC}"
fi
echo ""

echo -e "${BLUE}=== All Manual Tests Complete ===${NC}"
