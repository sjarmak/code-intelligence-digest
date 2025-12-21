# Audio Rendering Guide

This guide covers the new audio rendering system that converts podcast transcripts to audio files.

## Overview

The audio rendering system is built on a **pluggable provider architecture** that supports:

- **OpenAI TTS** (tts-1, tts-1-hd)
- **ElevenLabs TTS** (high-quality synthesis)
- **NeMo TTS** (NVIDIA Riva/NeMo - stub, awaiting configuration)

Audio rendering is **separate from transcript generation**:
- `/api/podcast/generate` - Generate transcript (unchanged)
- `/api/podcast/render-audio` - Render transcript to audio (new)

## Architecture

### Components

```
src/lib/audio/
├── types.ts              # Type definitions & interfaces
├── sanitize.ts           # Transcript preprocessing (remove cues, format)
├── render.ts             # Provider orchestration
└── providers/
    ├── openaiTts.ts      # OpenAI provider implementation
    ├── elevenlabsTts.ts  # ElevenLabs provider implementation
    └── nemoTts.ts        # NeMo provider stub

src/lib/storage/
└── local.ts              # Local file storage adapter (dev/testing)

src/lib/db/
└── podcast-audio.ts      # Database helpers for caching

app/api/podcast/render-audio/
└── route.ts              # Endpoint handler
```

### Type System

**RenderAudioRequest** - Internal provider input:
```typescript
{
  transcript: string;
  provider: "openai" | "elevenlabs" | "nemo";
  format: "mp3" | "wav";
  voice?: string;
  sampleRate?: number;
}
```

**RenderAudioEndpointRequest** - API input:
```typescript
{
  // One required:
  podcastId?: string;        // Fetch stored transcript
  transcript?: string;       // Provide directly

  // Configuration:
  provider: "openai" | "elevenlabs" | "nemo";
  format?: "mp3" | "wav";
  voice?: string;
  sampleRate?: number;
  segmentsMode?: "single" | "per-segment";
  music?: {
    intro?: boolean;
    outro?: boolean;
  };
}
```

**RenderAudioEndpointResponse** - API output:
```typescript
{
  id: string;               // Audio ID (aud-uuid)
  generatedAt: string;      // ISO timestamp
  provider: string;         // Provider used
  format: string;           // "mp3" or "wav"
  voice: string;           // Voice name/ID
  duration: string;        // "MM:SS" format
  audioUrl: string;        // Public/signed URL to audio
  segmentAudio?: Array;    // Per-segment audio URLs (optional)
  generationMetadata: {
    providerLatency: string;    // Time taken by provider
    bytes: number;              // File size
    transcriptHash: string;     // Cache key
    cached: boolean;            // Whether from cache
  };
}
```

## Usage

### Prerequisites

Set environment variables for your chosen provider:

```bash
# OpenAI (required for tts provider)
export OPENAI_API_KEY=sk-...

# ElevenLabs (required for elevenlabs provider)
export ELEVENLABS_API_KEY=sk_...

# NeMo (required for nemo provider)
export NEMO_TTS_BASE_URL=http://localhost:8000
export NEMO_TTS_API_KEY=optional-api-key
```

### Example 1: Render from explicit transcript (stateless)

```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Host: Hello everyone, welcome to the show. Today we are discussing code intelligence. Guest: Great to be here!",
    "provider": "openai",
    "format": "mp3",
    "voice": "alloy",
    "segmentsMode": "single"
  }' | jq .
```

Response:
```json
{
  "id": "aud-550e8400-e29b-41d4-a716-446655440000",
  "generatedAt": "2025-01-21T10:35:00.000Z",
  "provider": "openai",
  "format": "mp3",
  "voice": "alloy",
  "duration": "0:15",
  "audioUrl": "/public/audio/podcasts/550e8400-e29b-41d4-a716-446655440000.mp3",
  "generationMetadata": {
    "providerLatency": "2.34s",
    "bytes": 45678,
    "transcriptHash": "sha256:abcdef123456...",
    "cached": false
  }
}
```

### Example 2: Test transcript with cues (gets stripped)

```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "[INTRO MUSIC]\nHost: Hello everyone.\n[PAUSE]\nGuest: Great!\n[OUTRO MUSIC]",
    "provider": "openai",
    "format": "mp3",
    "voice": "nova"
  }' | jq .
```

The cues (`[INTRO MUSIC]`, `[PAUSE]`, `[OUTRO MUSIC]`) are automatically removed before rendering.

### Example 3: ElevenLabs provider with custom voice

```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Welcome to the show. Today we discuss agents.",
    "provider": "elevenlabs",
    "format": "mp3",
    "voice": "21m00Tcm4TlvDq8ikWAM"
  }' | jq .
```

### Example 4: NeMo provider (stub)

```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "This is a test.",
    "provider": "nemo",
    "format": "mp3"
  }' | jq .
```

Will fail with error if `NEMO_TTS_BASE_URL` is not set. To enable NeMo:

1. Set up local NeMo/Riva endpoint
2. Set `NEMO_TTS_BASE_URL` environment variable
3. Optionally set `NEMO_TTS_API_KEY` if endpoint requires auth

## Features

### Transcript Sanitization

Automatically removes TTS-incompatible cues:

- `[INTRO MUSIC]`, `[OUTRO MUSIC]`, `[BACKGROUND MUSIC]`
- `[PAUSE]`, `[SILENCE]`
- `[SOUND EFFECT]`, `[SFX]`
- `[APPLAUSE]`, `[LAUGHTER]`

**Options** (via `sanitizeTranscriptForTts`):
- `stripCues: boolean` (default: true) - Remove cues
- `keepSpeakerLabels: boolean` (default: true) - Keep "Host:", "Guest:" labels
- `stripAllMarkup: boolean` (default: false) - Remove all markup

### Caching by Transcript Hash

- Computed as: `sha256(sanitized_transcript + provider + voice + format)`
- Stored in `generated_podcast_audio` table
- Returns cached result if hash matches (marked as `"cached": true`)
- Prevents duplicate renders for identical content

### Duration Estimation

- Estimated at **150 words per minute**
- Formatted as "MM:SS" or "H:MM:SS"
- Provided in response as both string and seconds

### Storage

Currently uses **local file storage** (`.data/audio/`):
- Accessible via `/public/audio/podcasts/{id}.{format}`
- Suitable for development and testing
- **For production**, swap `LocalStorageAdapter` with S3/GCS/R2 adapter

## Database

### Table: `generated_podcast_audio`

```sql
CREATE TABLE generated_podcast_audio (
  id TEXT PRIMARY KEY,
  podcast_id TEXT,
  transcript_hash TEXT NOT NULL UNIQUE,
  provider TEXT NOT NULL,
  voice TEXT,
  format TEXT NOT NULL,
  duration TEXT,
  duration_seconds INTEGER,
  audio_url TEXT NOT NULL,
  segment_audio TEXT,              -- JSON array of segment metadata
  bytes INTEGER NOT NULL,
  generated_at INTEGER,
  created_at INTEGER DEFAULT CURRENT_TIMESTAMP
);
```

### Indexes

- `idx_podcast_audio_hash` - Fast cache lookups by transcript hash
- `idx_podcast_audio_created_at` - Fast listing of recent renders

## API Endpoints

### `POST /api/podcast/render-audio`

Render podcast transcript to audio file.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `transcript` | string | Yes (or `podcastId`) | Transcript text to render |
| `podcastId` | string | Yes (or `transcript`) | Fetch stored transcript (future) |
| `provider` | string | Yes | "openai", "elevenlabs", or "nemo" |
| `format` | string | No | "mp3" (default) or "wav" |
| `voice` | string | No | Provider-specific voice ID |
| `sampleRate` | number | No | Audio sample rate (24000 default) |
| `segmentsMode` | string | No | "single" (default) or "per-segment" |
| `music` | object | No | Music config (future expansion) |

**Success Response (200):**
```json
{
  "id": "aud-...",
  "generatedAt": "2025-01-21T10:35:00Z",
  "provider": "openai",
  "format": "mp3",
  "voice": "alloy",
  "duration": "2:30",
  "audioUrl": "https://...",
  "generationMetadata": { ... }
}
```

**Error Response (400/500):**
```json
{
  "error": "Transcript cannot be empty"
}
```

## Provider Details

### OpenAI TTS (`provider: "openai"`)

**Setup:**
```bash
export OPENAI_API_KEY=sk-...
```

**Models:**
- `tts-1` - Fast, lower quality
- `tts-1-hd` - Slower, higher quality

**Voices:**
- `alloy`, `echo`, `fable`, `onyx`, `nova`, `shimmer`

**Cost:**
- ~$0.015 per 1 minute of audio

**Example:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Hello world",
    "provider": "openai",
    "voice": "nova"
  }'
```

### ElevenLabs TTS (`provider: "elevenlabs"`)

**Setup:**
```bash
export ELEVENLABS_API_KEY=sk_...
```

**Voices:**
- Voice IDs: `21m00Tcm4TlvDq8ikWAM` (Rachel), etc.
- Use ElevenLabs dashboard to find voice IDs

**Cost:**
- Varies by plan (0-0.3 credits per 1000 characters)

**Example:**
```bash
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Hello world",
    "provider": "elevenlabs",
    "voice": "21m00Tcm4TlvDq8ikWAM"
  }'
```

### NeMo TTS (`provider: "nemo"`)

**Status:** Provider stub - awaiting configuration

**Setup:**
```bash
export NEMO_TTS_BASE_URL=http://localhost:8000
export NEMO_TTS_API_KEY=optional-api-key
```

**Prerequisites:**
1. Deploy NeMo TTS service or Riva inference service
2. Expose HTTP API on configured endpoint
3. Expected endpoint: `POST {NEMO_TTS_BASE_URL}/api/v1/synthesize`

**Request format** (from provider):
```json
{
  "text": "Hello world",
  "voice": "default",
  "language": "en-US",
  "sample_rate": 24000
}
```

**Expected response:** Binary audio/mpeg stream

## Testing

### Unit Tests

```bash
npm test -- __tests__/audio/sanitize.test.ts --run
```

Tests cover:
- Cue stripping
- Duration estimation
- Hash computation
- Formatting

### Integration Test (Manual)

```bash
# Generate audio
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Host: Welcome to the show.",
    "provider": "openai",
    "format": "mp3"
  }' | jq .

# Check cache hit
curl -X POST http://localhost:3002/api/podcast/render-audio \
  -H "Content-Type: application/json" \
  -d '{
    "transcript": "Host: Welcome to the show.",
    "provider": "openai",
    "format": "mp3"
  }' | jq '.generationMetadata.cached'
# Should output: true
```

## Error Handling

### Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `OPENAI_API_KEY not found` | Missing API key | Set `OPENAI_API_KEY` env var |
| `Transcript is empty after sanitization` | All content was cues | Ensure meaningful text in transcript |
| `Provider not found: xyz` | Invalid provider name | Use "openai", "elevenlabs", or "nemo" |
| `Audio render timeout` | Provider too slow | Increase timeout or split transcript |
| `NEMO_TTS_BASE_URL not configured` | NeMo not set up | Set env vars or choose different provider |

### Fallback Strategy

If audio rendering fails:
- Endpoint returns error with 5xx status
- Caller can retry or fall back to transcript-only
- Errors are logged for debugging

## Future Enhancements

- [ ] Per-segment rendering with stitching
- [ ] Music/intro/outro support
- [ ] Batch rendering API
- [ ] WebM/Opus output formats
- [ ] Voice cloning support
- [ ] Emotional/prosody control
- [ ] S3/GCS/R2 storage adapters
- [ ] Audio caching by URL
- [ ] Signed URL expiration
