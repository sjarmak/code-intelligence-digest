# Audio Rendering API Reference

## Endpoint

```
POST /api/podcast/render-audio
Content-Type: application/json
```

## Request

### Required (one of):
- `transcript: string` - Transcript text to render to audio
- `podcastId: string` - Podcast ID (for future: fetch stored transcript)

### Required:
- `provider: string` - TTS provider: `"openai"`, `"elevenlabs"`, `"nemo"`

### Optional:
- `format: string` - Output format: `"mp3"` (default) or `"wav"`
- `voice: string` - Provider-specific voice ID/name
- `sampleRate: number` - Audio sample rate (default: 24000)
- `segmentsMode: string` - `"single"` (default) or `"per-segment"`
- `music: object` - Music config (placeholder for future)

## Response (Success - 200)

```json
{
  "id": "aud-550e8400-e29b-41d4-a716-446655440000",
  "generatedAt": "2025-01-21T10:35:23.456Z",
  "provider": "openai",
  "format": "mp3",
  "voice": "alloy",
  "duration": "0:08",
  "audioUrl": "/public/audio/podcasts/550e8400-e29b-41d4-a716-446655440000.mp3",
  "segmentAudio": null,
  "generationMetadata": {
    "providerLatency": "1.23s",
    "bytes": 12800,
    "transcriptHash": "sha256:abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
    "cached": false
  }
}
```

## Response (Error - 400/500)

```json
{
  "error": "Descriptive error message"
}
```

## Examples

### OpenAI (Basic)
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Welcome to the show",
    "provider": "openai"
  }'
```

### OpenAI (With Voice)
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Welcome to the show",
    "provider": "openai",
    "voice": "nova"
  }'
```

### OpenAI (WAV Format)
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Welcome to the show",
    "provider": "openai",
    "format": "wav"
  }'
```

### ElevenLabs
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Welcome to the show",
    "provider": "elevenlabs",
    "voice": "21m00Tcm4TlvDq8ikWAM"
  }'
```

### NeMo
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Welcome to the show",
    "provider": "nemo"
  }'
```

## Status Codes

| Code | Meaning | Example |
|------|---------|---------|
| 200 | Success | Audio rendered and saved |
| 400 | Bad Request | Invalid provider, empty transcript |
| 500 | Server Error | API key missing, provider failure, timeout |

## Error Messages

| Error | Cause | Solution |
|-------|-------|----------|
| `Either 'podcastId' or 'transcript' must be provided` | Missing both | Provide one |
| `provider must be one of: openai, elevenlabs, nemo` | Invalid provider | Use valid provider |
| `Transcript is empty after sanitization` | Only cues in transcript | Add meaningful content |
| `OPENAI_API_KEY not found` | Missing API key | `export OPENAI_API_KEY=sk-...` |
| `ELEVENLABS_API_KEY not found` | Missing API key | `export ELEVENLABS_API_KEY=sk_...` |
| `NEMO_TTS_BASE_URL not configured` | Missing config | `export NEMO_TTS_BASE_URL=...` |
| `Failed to render audio: ...` | Provider error | Check logs, try again |

## Provider Details

### OpenAI
- **Voices:** alloy, echo, fable, onyx, nova, shimmer
- **Models:** tts-1 (fast), tts-1-hd (quality)
- **Env:** `OPENAI_API_KEY=sk-...`

### ElevenLabs
- **Voice Format:** Voice ID string (e.g., "21m00Tcm4TlvDq8ikWAM")
- **Env:** `ELEVENLABS_API_KEY=sk_...`

### NeMo
- **Endpoint:** `POST {NEMO_TTS_BASE_URL}/api/v1/synthesize`
- **Env:** `NEMO_TTS_BASE_URL=http://...` `NEMO_TTS_API_KEY=...`

## Caching Behavior

The system automatically deduplicates requests:

**First request:**
```json
{"generationMetadata": {"cached": false}}
```

**Identical second request (same transcript + provider + voice + format):**
```json
{"generationMetadata": {"cached": true}}
```

Cache key computed as: `sha256(sanitized_transcript + provider + voice + format)`

## Transcript Preprocessing

Automatically removes before rendering:
- `[INTRO MUSIC]`, `[OUTRO MUSIC]`, `[BACKGROUND MUSIC]`
- `[PAUSE]`, `[SILENCE]`, `[SOUND EFFECT]`, `[SFX]`
- `[APPLAUSE]`, `[LAUGHTER]`

Example:
```
Input:  "[INTRO]\nHost: Hello\n[PAUSE]\nGuest: Hi\n[OUTRO]"
Output: "Host: Hello\nGuest: Hi"
```

## Response Fields

| Field | Type | Description |
|-------|------|-------------|
| `id` | string | Unique audio ID |
| `generatedAt` | ISO-8601 | When audio was generated |
| `provider` | string | Provider used |
| `format` | string | Output format (mp3/wav) |
| `voice` | string | Voice used |
| `duration` | string | Duration in MM:SS format |
| `audioUrl` | string | Public URL to download audio |
| `segmentAudio` | array | Per-segment audio URLs (optional) |
| `generationMetadata.providerLatency` | string | How long provider took |
| `generationMetadata.bytes` | number | File size in bytes |
| `generationMetadata.transcriptHash` | string | Cache key |
| `generationMetadata.cached` | boolean | Was result from cache? |

## Usage Patterns

### Pattern 1: Generate Once, Cache Automatically
```bash
# First call renders audio
RESPONSE=$(curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Test","provider":"openai"}')

# Second identical call returns cached result (instant)
RESPONSE=$(curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Test","provider":"openai"}')

# Check cached status
echo $RESPONSE | jq '.generationMetadata.cached'  # true
```

### Pattern 2: Extract Audio URL
```bash
RESPONSE=$(curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{"transcript":"Test","provider":"openai"}')

AUDIO_URL=$(echo $RESPONSE | jq -r '.audioUrl')
echo "Download at: http://localhost:3002$AUDIO_URL"
```

### Pattern 3: Integrate with Podcast Generation
```bash
# Generate podcast
PODCAST=$(curl -s -X POST http://localhost:3002/api/podcast/generate \
  -H "Content-Type: application/json" \
  -d '{"categories":["ai_news"],"period":"week"}')

TRANSCRIPT=$(echo $PODCAST | jq -r '.transcript')

# Render to audio
AUDIO=$(curl -s -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d "{\"transcript\":$(echo $TRANSCRIPT | jq -Rs .),\"provider\":\"openai\"}")

AUDIO_URL=$(echo $AUDIO | jq -r '.audioUrl')
echo "Podcast audio: $AUDIO_URL"
```

## Performance

| Operation | Time | Notes |
|-----------|------|-------|
| OpenAI TTS (100 words) | 1-2 seconds | Provider latency |
| Cache hit | <10ms | Database lookup |
| Storage write | <10ms | Local file system |
| Total (first) | 1-3 seconds | Provider dependent |
| Total (cached) | <50ms | Instant for repeat |

## Limits

- **Transcript:** No hard limit, but recommend <5000 words for single request
- **Timeout:** 2 minutes per request
- **Concurrent:** No limit (stateless API)
- **Storage:** Depends on deployment (local uses `.data/audio/`)

## Implementation Notes

- **Type-safe:** Full TypeScript with strict mode
- **Stateless:** Each request is independent
- **Idempotent:** Same input always produces same output
- **Logged:** All operations logged for debugging
- **Extensible:** Easy to add new providers or storage backends
