# Audio Rendering Examples

Copy-paste examples for testing the audio rendering endpoint.

## Setup

Ensure environment variables are set:

```bash
# OpenAI
export OPENAI_API_KEY=sk-...

# Or ElevenLabs
export ELEVENLABS_API_KEY=sk_...
```

## Basic Example: Simple Transcript

**Request:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Welcome to the Code Intelligence Digest. Today we discuss semantic search and code agents.",
    "provider": "openai",
    "format": "mp3",
    "voice": "alloy"
  }'
```

**Response:**
```json
{
  "id": "aud-550e8400-e29b-41d4-a716-446655440000",
  "generatedAt": "2025-01-21T10:35:23.456Z",
  "provider": "openai",
  "format": "mp3",
  "voice": "alloy",
  "duration": "0:08",
  "audioUrl": "/public/audio/podcasts/550e8400-e29b-41d4-a716-446655440000.mp3",
  "generationMetadata": {
    "providerLatency": "1.23s",
    "bytes": 12800,
    "transcriptHash": "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "cached": false
  }
}
```

---

## Example: Transcript with Cues (Automatically Stripped)

**Request:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "[INTRO MUSIC]\n\nHost: Hello everyone, welcome back!\n[PAUSE]\nGuest: Thanks for having me.\n[BACKGROUND MUSIC]\nHost: Today we are discussing context windows in LLMs.\n[OUTRO MUSIC]",
    "provider": "openai",
    "format": "mp3"
  }'
```

**What happens:**
- `[INTRO MUSIC]` is removed
- `[PAUSE]` is removed
- `[BACKGROUND MUSIC]` is removed
- `[OUTRO MUSIC]` is removed
- Speaker labels are preserved

**Effective transcript sent to TTS:**
```
Host: Hello everyone, welcome back!
Guest: Thanks for having me.
Host: Today we are discussing context windows in LLMs.
```

---

## Example: Using Different OpenAI Voices

### Voice: nova (more natural)
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "The new semantic search API enables cross-repository symbol resolution.",
    "provider": "openai",
    "voice": "nova"
  }'
```

### Voice: echo (deeper)
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Monorepo tooling has become essential for enterprise codebases.",
    "provider": "openai",
    "voice": "echo"
  }'
```

### Voice: fable (storytelling)
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "The journey of code intelligence began with simple keyword search.",
    "provider": "openai",
    "voice": "fable"
  }'
```

Available voices: `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

---

## Example: Cache Hit

Run the same request twice:

**First request (cache miss):**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Semantic code search is transforming how developers navigate large codebases.",
    "provider": "openai"
  }' | jq '.generationMetadata.cached'
```
Output: `false`

**Second request (cache hit - response is instant):**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Semantic code search is transforming how developers navigate large codebases.",
    "provider": "openai"
  }' | jq '.generationMetadata.cached'
```
Output: `true`

The response includes the same `audioUrl` and metadata, but:
- `cached: true`
- `providerLatency: "0ms"` (approximately instant)

---

## Example: ElevenLabs Provider

```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "AI coding agents are reshaping developer productivity workflows.",
    "provider": "elevenlabs",
    "voice": "21m00Tcm4TlvDq8ikWAM"
  }'
```

Find voice IDs at https://elevenlabs.io/voice-lab

---

## Example: Error Cases

### Missing transcript
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "openai"
  }'
```
**Response (400):**
```json
{
  "error": "Either 'podcastId' or 'transcript' must be provided"
}
```

### Empty transcript (or only cues)
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "[MUSIC] [PAUSE]",
    "provider": "openai"
  }'
```
**Response (400):**
```json
{
  "error": "Transcript is empty after sanitization (all cues removed?)"
}
```

### Invalid provider
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Test",
    "provider": "acme-tts"
  }'
```
**Response (400):**
```json
{
  "error": "provider must be one of: openai, elevenlabs, nemo"
}
```

### API key not configured
```bash
# Without OPENAI_API_KEY set
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Test",
    "provider": "openai"
  }'
```
**Response (500):**
```json
{
  "error": "OPENAI_API_KEY not found"
}
```

---

## Example: Long Form Content

**Request:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Host: Welcome to the Code Intelligence weekly digest. This week we have some incredible updates from the LLM world.\n\nGuest: Thanks for having me. One of the biggest stories is the new reasoning models that can handle complex problem-solving tasks.\n\nHost: Can you elaborate on the implications for code?\n\nGuest: Absolutely. These models can now maintain context over long code files and reason about cross-file dependencies. This is a game-changer for refactoring and code review automation.\n\nHost: Fascinating. What else?\n\nGuest: Vector databases have matured significantly. We now have sub-millisecond semantic search over millions of code snippets.\n\nHost: That is exciting. Thanks for sharing your insights.\n\nGuest: Always a pleasure to discuss these developments.",
    "provider": "openai",
    "voice": "nova",
    "format": "mp3"
  }'
```

This generates audio approximately **2-3 minutes long**.

---

## Example: Checking Audio URL

After generating audio, you can directly access it:

```bash
# From response: "audioUrl": "/public/audio/podcasts/550e8400-e29b-41d4-a716-446655440000.mp3"

# Download it
wget http://localhost:3002/public/audio/podcasts/550e8400-e29b-41d4-a716-446655440000.mp3

# Or play it in browser
open http://localhost:3002/public/audio/podcasts/550e8400-e29b-41d4-a716-446655440000.mp3
```

---

## Example: Bash Script for Batch Processing

```bash
#!/bin/bash

# batch-render-podcasts.sh
# Render multiple transcripts to audio

API_URL="http://localhost:3002/api/podcast/render-audio"
PROVIDER="openai"

declare -a TRANSCRIPTS=(
  "Welcome to episode one. Code search is transforming development."
  "In episode two, we discuss context compression techniques."
  "Episode three covers agentic workflows and multi-step coding."
)

for i in "${!TRANSCRIPTS[@]}"; do
  echo "Rendering episode $((i+1))..."
  
  RESPONSE=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "{
      \"transcript\": \"${TRANSCRIPTS[$i]}\",
      \"provider\": \"$PROVIDER\",
      \"format\": \"mp3\"
    }")
  
  AUDIO_URL=$(echo "$RESPONSE" | jq -r '.audioUrl')
  echo "✓ Episode $((i+1)) ready at: $AUDIO_URL"
done
```

Run it:
```bash
chmod +x batch-render-podcasts.sh
./batch-render-podcasts.sh
```

---

## Example: Integration with Podcast Generator

Combine `/api/podcast/generate` and `/api/podcast/render-audio`:

```bash
#!/bin/bash

# generate-and-render-podcast.sh
# Generate transcript, then render to audio

# Step 1: Generate transcript
PODCAST=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{
    "categories": ["ai_news", "product_news"],
    "period": "week",
    "limit": 10,
    "voiceStyle": "conversational"
  }')

TRANSCRIPT=$(echo "$PODCAST" | jq -r '.transcript')
echo "Generated transcript ($(echo "$TRANSCRIPT" | wc -w) words)"

# Step 2: Render to audio
AUDIO=$(curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{
    \"transcript\": $(echo "$TRANSCRIPT" | jq -Rs .),
    \"provider\": \"openai\",
    \"voice\": \"nova\"
  }")

AUDIO_URL=$(echo "$AUDIO" | jq -r '.audioUrl')
DURATION=$(echo "$AUDIO" | jq -r '.duration')

echo "✓ Podcast ready!"
echo "  Audio: $AUDIO_URL"
echo "  Duration: $DURATION"
```

Run it:
```bash
chmod +x generate-and-render-podcast.sh
./generate-and-render-podcast.sh
```

---

## Tips

- **Voice selection:** Try different voices (`nova`, `onyx`) to see which sounds best for your use case
- **Caching:** Identical transcripts + provider + voice combos return cached results (instant)
- **Duration estimation:** All transcripts are estimated at 150 words per minute
- **Error retry:** If TTS API fails, try again in a few seconds
- **Large content:** For transcripts >5000 words, consider splitting and stitching segments
