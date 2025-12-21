#!/bin/bash

# Audio Rendering Endpoint - Manual Test Suite
# Run this to test the /api/podcast/render-audio endpoint

set -e

API_URL="http://localhost:3002/api/podcast/render-audio"
RESULTS_FILE="/tmp/audio_test_results.txt"

echo "🧪 Audio Rendering Endpoint Tests" > "$RESULTS_FILE"
echo "=================================" >> "$RESULTS_FILE"
echo "" >> "$RESULTS_FILE"

# Helper function for tests
run_test() {
  local test_name="$1"
  local request="$2"
  local expected_field="$3"
  
  echo -n "Testing: $test_name... "
  
  RESPONSE=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "$request")
  
  if echo "$RESPONSE" | jq -e "$expected_field" > /dev/null 2>&1; then
    echo "✅ PASS"
    echo "✅ $test_name" >> "$RESULTS_FILE"
    return 0
  else
    echo "❌ FAIL"
    echo "❌ $test_name" >> "$RESULTS_FILE"
    echo "   Response: $RESPONSE" >> "$RESULTS_FILE"
    return 1
  fi
}

# Test 1: Basic OpenAI render
echo ""
echo "Test 1: Basic OpenAI render"
run_test "Basic OpenAI render" \
  '{"transcript":"Welcome to the podcast","provider":"openai"}' \
  '.audioUrl'

# Test 2: Cache hit
echo ""
echo "Test 2: Cache hit (same request)"
CACHE_TEST=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Welcome to the podcast","provider":"openai"}')

CACHED=$(echo "$CACHE_TEST" | jq -r '.generationMetadata.cached')
if [ "$CACHED" = "true" ]; then
  echo "✅ Cache hit detected"
  echo "✅ Cache hit detected" >> "$RESULTS_FILE"
else
  echo "❌ Cache hit not detected (expected true, got $CACHED)"
  echo "❌ Cache hit not detected" >> "$RESULTS_FILE"
fi

# Test 3: Error - missing provider
echo ""
echo "Test 3: Error handling - missing provider"
ERROR_TEST=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"test"}')

ERROR=$(echo "$ERROR_TEST" | jq -r '.error // "no error"')
if [ "$ERROR" != "no error" ]; then
  echo "✅ Error correctly returned"
  echo "✅ Error handling - missing provider" >> "$RESULTS_FILE"
else
  echo "❌ Expected error, got none"
  echo "❌ Error handling - missing provider" >> "$RESULTS_FILE"
fi

# Test 4: Error - invalid provider
echo ""
echo "Test 4: Error handling - invalid provider"
ERROR_TEST=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"test","provider":"invalid"}')

ERROR=$(echo "$ERROR_TEST" | jq -r '.error // "no error"')
if [ "$ERROR" != "no error" ]; then
  echo "✅ Error correctly returned for invalid provider"
  echo "✅ Error handling - invalid provider" >> "$RESULTS_FILE"
else
  echo "❌ Expected error for invalid provider"
  echo "❌ Error handling - invalid provider" >> "$RESULTS_FILE"
fi

# Test 5: With voice selection
echo ""
echo "Test 5: OpenAI with voice selection"
run_test "OpenAI with voice (nova)" \
  '{"transcript":"Test with nova voice","provider":"openai","voice":"nova"}' \
  '.voice'

# Test 6: Different OpenAI voice
echo ""
echo "Test 6: OpenAI with different voice (echo)"
run_test "OpenAI with voice (echo)" \
  '{"transcript":"Test with echo voice","provider":"openai","voice":"echo"}' \
  '.voice'

# Test 7: WAV format
echo ""
echo "Test 7: WAV format output"
run_test "WAV format" \
  '{"transcript":"Test WAV format","provider":"openai","format":"wav"}' \
  '.format'

# Test 8: Cue stripping (transcript with cues)
echo ""
echo "Test 8: Cue stripping [INTRO MUSIC]"
run_test "Cue stripping" \
  '{"transcript":"[INTRO MUSIC]\nHost: Hello\n[OUTRO MUSIC]","provider":"openai"}' \
  '.audioUrl'

# Test 9: Empty transcript (all cues)
echo ""
echo "Test 9: Error - empty transcript after cue stripping"
ERROR_TEST=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"[INTRO] [PAUSE] [OUTRO]","provider":"openai"}')

ERROR=$(echo "$ERROR_TEST" | jq -r '.error // "no error"')
if [ "$ERROR" != "no error" ]; then
  echo "✅ Error correctly returned for empty transcript"
  echo "✅ Error - empty transcript after stripping" >> "$RESULTS_FILE"
else
  echo "❌ Expected error for empty transcript"
  echo "❌ Error - empty transcript after stripping" >> "$RESULTS_FILE"
fi

# Test 10: Response metadata
echo ""
echo "Test 10: Response metadata validation"
METADATA_TEST=$(curl -s -X POST "$API_URL" \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Metadata test","provider":"openai"}')

HAS_ID=$(echo "$METADATA_TEST" | jq 'has("id")')
HAS_DURATION=$(echo "$METADATA_TEST" | jq 'has("duration")')
HAS_METADATA=$(echo "$METADATA_TEST" | jq 'has("generationMetadata")')

if [ "$HAS_ID" = "true" ] && [ "$HAS_DURATION" = "true" ] && [ "$HAS_METADATA" = "true" ]; then
  echo "✅ All required metadata fields present"
  echo "✅ Response metadata validation" >> "$RESULTS_FILE"
else
  echo "❌ Missing metadata fields"
  echo "❌ Response metadata validation" >> "$RESULTS_FILE"
fi

# Summary
echo ""
echo "================================="
echo "Test Summary"
echo "================================="
cat "$RESULTS_FILE"

# Count results
PASSED=$(grep "✅" "$RESULTS_FILE" | wc -l)
FAILED=$(grep "❌" "$RESULTS_FILE" | wc -l)

echo ""
echo "Results: $PASSED passed, $FAILED failed"

if [ "$FAILED" -eq 0 ]; then
  echo "✅ ALL TESTS PASSED!"
  exit 0
else
  echo "❌ SOME TESTS FAILED"
  exit 1
fi
