# Podcast Generation & Audio Rendering Testing Guide

Complete instructions for testing the podcast generation pipeline and audio rendering system.

---

## Prerequisites

Ensure these environment variables are set:

```bash
export OPENAI_API_KEY=sk-...          # Required for LLM scoring & transcript generation
export ELEVENLABS_API_KEY=sk_...      # Optional, for ElevenLabs audio rendering
```

Verify database is seeded with items:
```bash
curl http://localhost:3002/api/admin/sync-daily
```

---

## Part 1: Podcast Generation Testing

### Test 1.1: Basic Generation (All Categories)

**Request:**
```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["newsletters", "tech_articles", "ai_news"],
    "period": "week",
    "limit": 15,
    "voiceStyle": "conversational"
  }' | jq .
```

**Expected Response:**
```json
{
  "id": "pod-...",
  "title": "Code Intelligence Weekly – Episode X",
  "generatedAt": "2025-...",
  "categories": ["newsletters", "tech_articles", "ai_news"],
  "period": "week",
  "duration": "~20:00",
  "itemsRetrieved": 45,
  "itemsIncluded": 12,
  "transcript": "[INTRO MUSIC]\n\nHost: Welcome to Code Intelligence Weekly...",
  "segments": [
    {
      "title": "Segment 1",
      "startTime": "0:00",
      "endTime": "5:30",
      "duration": 330,
      "itemsReferenced": [...],
      "highlights": [...]
    }
  ],
  "showNotes": "# Show Notes\n\n## Segment 1\n- [Article](url) — Source\n\n## All Items\n...",
  "generationMetadata": {
    "promptUsed": "",
    "modelUsed": "gpt-4o-mini",
    "tokensUsed": 3900,
    "voiceStyle": "conversational",
    "duration": "2.3s",
    "promptProfile": null
  }
}
```

**Verify:**
- ✅ `itemsRetrieved > 0` (database has items)
- ✅ `itemsIncluded <= limit`
- ✅ `segments.length > 0` (transcript parsed correctly)
- ✅ All segment references point to valid items
- ✅ `transcript` contains speaker labels and references like `(ref: item-0)`

---

### Test 1.2: Generation with Custom Prompt

**Request:**
```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["ai_news"],
    "period": "month",
    "limit": 10,
    "voiceStyle": "technical",
    "prompt": "Focus on reasoning models and code agents. Avoid theory."
  }' | jq .
```

**Expected Behavior:**
- `generationMetadata.promptProfile` contains parsed topics: `{"focusTopics": ["reasoning models", "code agents"], "excludeTopics": ["theory"]}`
- Selected items emphasize prompt focus topics
- Reasoning field includes `[PROMPT-RERANK: ...]` annotations
- Items tagged with excluded topics are filtered out

---

### Test 1.3: Different Voice Styles

Run three requests with different `voiceStyle` values:

```bash
# Conversational
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["newsletters"],"period":"week","limit":5,"voiceStyle":"conversational"}' \
  | jq '.transcript | head -c 200'

# Technical
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["research"],"period":"week","limit":5,"voiceStyle":"technical"}' \
  | jq '.transcript | head -c 200'

# Executive
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["product_news"],"period":"week","limit":5,"voiceStyle":"executive"}' \
  | jq '.transcript | head -c 200'
```

**Verify:** Transcript tone matches the selected voice style.

---

### Test 1.4: Period Comparison

Generate episodes for both weekly and monthly periods from the same category:

```bash
# Weekly
WEEKLY=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["tech_articles"],"period":"week","limit":10}')

# Monthly
MONTHLY=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["tech_articles"],"period":"month","limit":10}')

echo "Weekly items: $(echo "$WEEKLY" | jq '.itemsIncluded')"
echo "Monthly items: $(echo "$MONTHLY" | jq '.itemsIncluded')"
```

**Verify:**
- Weekly episode has fewer/more recent items
- Monthly episode includes older items (within 30-day window)
- Both use appropriate recency half-lives (3 days for week, 10 days for month)

---

### Test 1.5: Error Cases

**Missing categories:**
```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"period":"week","limit":10}' \
  | jq '.error'
# Expected: "categories must be non-empty array"
```

**Invalid category:**
```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["invalid_cat"],"period":"week","limit":10}' \
  | jq '.error'
# Expected: "Invalid category: invalid_cat"
```

**Invalid period:**
```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["newsletters"],"period":"quarter","limit":10}' \
  | jq '.error'
# Expected: 'period must be "week" or "month"'
```

**Limit out of range:**
```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["newsletters"],"period":"week","limit":100}' \
  | jq '.error'
# Expected: "limit must be between 1 and 50"
```

**Invalid voice style:**
```bash
curl -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["newsletters"],"period":"week","limit":10,"voiceStyle":"robotic"}' \
  | jq '.error'
# Expected: "voiceStyle must be one of: conversational, technical, executive"
```

---

## Part 2: Audio Rendering Testing

### Test 2.1: Render Audio from Transcript

**Request:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Host: Welcome to the Code Intelligence Digest. Today we discuss semantic search and code agents.",
    "provider": "openai",
    "voice": "nova",
    "format": "mp3"
  }' | jq .
```

**Expected Response:**
```json
{
  "id": "aud-...",
  "generatedAt": "2025-...",
  "provider": "openai",
  "format": "mp3",
  "voice": "nova",
  "duration": "0:08",
  "audioUrl": "/public/audio/podcasts/550e8400-e29b-41d4-a716-446655440000.mp3",
  "generationMetadata": {
    "providerLatency": "1.23s",
    "bytes": 12800,
    "transcriptHash": "sha256:abcdef...",
    "cached": false
  }
}
```

**Verify:**
- ✅ Audio file exists at path: `/public/audio/podcasts/{id}.mp3`
- ✅ File is readable and valid MP3
- ✅ Duration matches word count (~150 wpm)

---

### Test 2.2: Caching Behavior

Run the same audio request twice:

```bash
TRANSCRIPT='Host: Semantic code search is transforming how developers navigate large codebases.'

# First request
RESP1=$(curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{
    \"transcript\": \"$TRANSCRIPT\",
    \"provider\": \"openai\",
    \"voice\": \"nova\"
  }")

echo "First request cached: $(echo "$RESP1" | jq '.generationMetadata.cached')"
LATENCY1=$(echo "$RESP1" | jq -r '.generationMetadata.providerLatency')
echo "Latency: $LATENCY1"

# Second request (should hit cache)
RESP2=$(curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{
    \"transcript\": \"$TRANSCRIPT\",
    \"provider\": \"openai\",
    \"voice\": \"nova\"
  }")

echo "Second request cached: $(echo "$RESP2" | jq '.generationMetadata.cached')"
LATENCY2=$(echo "$RESP2" | jq -r '.generationMetadata.providerLatency')
echo "Latency: $LATENCY2 (should be ~0ms)"
```

**Verify:**
- ✅ First request: `cached: false`, latency ~1-2s
- ✅ Second request: `cached: true`, latency ~0ms
- ✅ Both return same `audioUrl`

---

### Test 2.3: Cue Stripping

**Request with cues:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "[INTRO MUSIC]\n\nHost: Hello everyone, welcome back!\n[PAUSE]\nGuest: Thanks for having me.\n[BACKGROUND MUSIC]\nHost: Today we discuss context windows.\n[OUTRO MUSIC]",
    "provider": "openai",
    "voice": "alloy"
  }' | jq '.duration'
```

**Expected Behavior:**
- Cues are stripped before sending to TTS
- Effective audio includes only: "Hello everyone, welcome back! Thanks for having me. Today we discuss context windows."
- Duration is ~7-10 seconds (not ~15 seconds if cues were included)

---

### Test 2.4: Different Providers

Test with all supported providers:

```bash
TRANSCRIPT="AI coding agents are reshaping developer productivity."

# OpenAI (default voice: alloy)
curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{\"transcript\":\"$TRANSCRIPT\",\"provider\":\"openai\"}" | jq '.provider'

# ElevenLabs
curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{\"transcript\":\"$TRANSCRIPT\",\"provider\":\"elevenlabs\",\"voice\":\"21m00Tcm4TlvDq8ikWAM\"}" | jq '.provider'
```

**Verify:**
- ✅ Both providers return valid audio files
- ✅ Metadata correctly reflects provider name

---

### Test 2.5: Error Cases

**Missing transcript:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"provider":"openai"}' \
  | jq '.error'
# Expected: "Either 'podcastId' or 'transcript' must be provided"
```

**Empty transcript (only cues):**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"[MUSIC] [PAUSE]","provider":"openai"}' \
  | jq '.error'
# Expected: "Transcript is empty after sanitization (all cues removed?)"
```

**Invalid provider:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Test","provider":"acme-tts"}' \
  | jq '.error'
# Expected: "provider must be one of: openai, elevenlabs, nemo"
```

**Missing API key:**
```bash
unset OPENAI_API_KEY
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Test","provider":"openai"}' \
  | jq '.error'
# Expected: "OPENAI_API_KEY not found"
```

---

## Part 3: End-to-End Integration Testing

### Test 3.1: Full Pipeline (Generate → Render)

**Bash Script:**
```bash
#!/bin/bash

echo "=== Step 1: Generate Podcast ==="
PODCAST=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["ai_news", "product_news"],
    "period": "week",
    "limit": 10,
    "voiceStyle": "conversational"
  }')

TRANSCRIPT=$(echo "$PODCAST" | jq -r '.transcript')
POD_ID=$(echo "$PODCAST" | jq -r '.id')
ITEMS_COUNT=$(echo "$PODCAST" | jq -r '.itemsIncluded')

echo "✓ Generated podcast $POD_ID with $ITEMS_COUNT items"
echo "Transcript length: $(echo "$TRANSCRIPT" | wc -w) words"

echo ""
echo "=== Step 2: Render Audio ==="
AUDIO=$(curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{
    \"transcript\": $(echo "$TRANSCRIPT" | jq -Rs .),
    \"provider\": \"openai\",
    \"voice\": \"nova\",
    \"format\": \"mp3\"
  }")

AUDIO_ID=$(echo "$AUDIO" | jq -r '.id')
AUDIO_URL=$(echo "$AUDIO" | jq -r '.audioUrl')
DURATION=$(echo "$AUDIO" | jq -r '.duration')
CACHED=$(echo "$AUDIO" | jq -r '.generationMetadata.cached')

echo "✓ Rendered audio $AUDIO_ID"
echo "  Duration: $DURATION"
echo "  Cached: $CACHED"
echo "  URL: $AUDIO_URL"

echo ""
echo "=== Step 3: Verify Audio File ==="
if [ -f ".data/audio/podcasts/$(basename $AUDIO_URL)" ]; then
  SIZE=$(ls -lh ".data/audio/podcasts/$(basename $AUDIO_URL)" | awk '{print $5}')
  echo "✓ Audio file exists ($SIZE)"
else
  echo "✗ Audio file not found at $AUDIO_URL"
  exit 1
fi

echo ""
echo "=== Complete Pipeline Summary ==="
echo "Podcast ID: $POD_ID"
echo "Audio ID: $AUDIO_ID"
echo "Items included: $ITEMS_COUNT"
echo "Duration: $DURATION"
echo "Status: ✅ SUCCESS"
```

**Run it:**
```bash
chmod +x test-full-pipeline.sh
./test-full-pipeline.sh
```

---

### Test 3.2: Batch Generation

Generate episodes for all category combinations:

```bash
#!/bin/bash

CATEGORIES=("newsletters" "podcasts" "tech_articles" "ai_news" "product_news" "community" "research")

for cat in "${CATEGORIES[@]}"; do
  echo "Testing category: $cat"
  RESULT=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
    -H "Content-Type: application/json" \
    -d "{\"categories\":[\"$cat\"],\"period\":\"week\",\"limit\":5}")
  
  ITEMS=$(echo "$RESULT" | jq '.itemsIncluded')
  DURATION=$(echo "$RESULT" | jq -r '.duration')
  STATUS=$( [ "$ITEMS" -gt 0 ] && echo "✓" || echo "✗")
  
  echo "  $STATUS Items: $ITEMS, Duration: $DURATION"
done
```

---

## Part 4: Performance & Load Testing

### Test 4.1: Response Time Benchmarks

```bash
#!/bin/bash

echo "=== Podcast Generation Performance ==="
time curl -s -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["newsletters","tech_articles"],"period":"week","limit":10}' \
  > /dev/null

echo ""
echo "=== Audio Rendering Performance (First Request) ==="
time curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Welcome to the digest. We discuss code search.","provider":"openai"}' \
  > /dev/null

echo ""
echo "=== Audio Rendering Performance (Cached) ==="
time curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Welcome to the digest. We discuss code search.","provider":"openai"}' \
  > /dev/null
```

**Expected Benchmarks:**
- Podcast generation: 2-5 seconds
- Audio rendering (uncached): 1-3 seconds
- Audio rendering (cached): <100ms

---

## Part 5: Database & Logging Checks

### Test 5.1: Verify Database Writes

```bash
# Check podcast audio records
sqlite3 .data/database.db \
  'SELECT id, podcast_id, provider, created_at FROM podcast_audio LIMIT 5;'

# Check transcript hash caching
sqlite3 .data/database.db \
  'SELECT transcript_hash, provider, created_at FROM transcript_cache LIMIT 5;'
```

### Test 5.2: Check Logs

```bash
# View recent logs
tail -100 .data/logs/*.log | grep -i "podcast\|audio"
```

---

## Checklist: Pre-Production Verification

Before deploying, verify:

- [ ] All 5 podcast generation tests pass
- [ ] All 5 audio rendering tests pass
- [ ] End-to-end pipeline test succeeds
- [ ] Cache behavior verified (second request is instant)
- [ ] All error cases return correct status codes (400/500)
- [ ] Audio files are valid MP3 and playable
- [ ] Database writes are recorded correctly
- [ ] Logs contain expected info/warn/error messages
- [ ] Response times meet performance benchmarks
- [ ] No memory leaks during batch processing

---

## Troubleshooting

### Audio file not found
- Check `.data/audio/podcasts/` directory exists
- Verify OpenAI API key is set
- Check logs for file write errors

### Cache not working
- Verify SQLite database table exists: `podcast_audio`
- Ensure `transcript_hash` column is present
- Check logs for cache lookup failures

### Empty transcript generation
- Verify database has items: `curl http://localhost:3002/api/admin/sync-daily`
- Check category configuration in `src/config/categories.ts`
- Review logs for ranking/selection warnings

### Segment parsing issues
- Verify transcript contains `## SEGMENT:` markers
- Check for item references format: `(ref: item-N)`
- Review `generatePodcastFallback()` output if LLM fails

