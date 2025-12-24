/**
 * POST /api/podcast/render-audio
 * Render podcast transcript to audio file
 *
 * Accepts either podcastId (to fetch stored transcript) or transcript directly (stateless)
 * Returns audio URL + metadata with optional per-segment audio
 */

import { NextRequest, NextResponse } from "next/server";
import { v4 as uuid } from "uuid";
import {
  RenderAudioEndpointResponse,
  AudioProvider,
  AudioFormat,
} from "@/src/lib/audio/types";
import {
  sanitizeTranscriptForTts,
  computeTranscriptHash,
  formatDuration,
  estimateDurationFromTranscript,
  hasMultipleSpeakers,
} from "@/src/lib/audio/sanitize";
import { renderAudio, renderMultiVoiceAudio, DEFAULT_VOICE_PAIRS, MultiVoiceConfig } from "@/src/lib/audio/render";
import { getPodcastAudioByHash, savePodcastAudio } from "@/src/lib/db/podcast-audio";
import { initializeDatabase } from "@/src/lib/db/index";
import { getLocalStorage } from "@/src/lib/storage/local";
import { logger } from "@/src/lib/logger";

const ALLOWED_PROVIDERS: AudioProvider[] = ["openai", "elevenlabs", "nemo"];
const ALLOWED_FORMATS: AudioFormat[] = ["mp3", "wav"];
const DEFAULT_VOICE = "alloy";
const DEFAULT_FORMAT: AudioFormat = "mp3";
const TIMEOUT_MS = 120_000; // 2 minutes for full render

interface ValidatedRequest {
  transcript: string;
  provider: AudioProvider;
  format: AudioFormat;
  voice: string;
  segmentsMode: "single" | "per-segment";
  multiVoice: boolean;
  hostVoice?: string;
  cohostVoice?: string;
}

function validateRequest(body: unknown): { valid: boolean; error?: string; data?: ValidatedRequest } {
  if (typeof body !== "object" || body === null) {
    return { valid: false, error: "Request body must be JSON object" };
  }

  const req = body as Record<string, unknown>;

  // Must provide either podcastId or transcript
  if (!req.podcastId && !req.transcript) {
    return {
      valid: false,
      error: "Either 'podcastId' or 'transcript' must be provided",
    };
  }

  // If transcript provided, validate it
  let transcript = "";
  if (req.transcript) {
    if (typeof req.transcript !== "string") {
      return { valid: false, error: "transcript must be string" };
    }
    transcript = req.transcript.trim();
    if (transcript.length === 0) {
      return { valid: false, error: "transcript cannot be empty" };
    }
  }

  // Validate provider
  const provider = req.provider as string;
  if (!ALLOWED_PROVIDERS.includes(provider as AudioProvider)) {
    return {
      valid: false,
      error: `provider must be one of: ${ALLOWED_PROVIDERS.join(", ")}`,
    };
  }

  // Validate format
  const format = (req.format as string) || DEFAULT_FORMAT;
  if (!ALLOWED_FORMATS.includes(format as AudioFormat)) {
    return {
      valid: false,
      error: `format must be one of: ${ALLOWED_FORMATS.join(", ")}`,
    };
  }

  // Validate voice
  const voice = (req.voice as string) || DEFAULT_VOICE;

  // Validate segmentsMode
  const segmentsMode =
    (req.segmentsMode as "single" | "per-segment") || "single";
  if (!["single", "per-segment"].includes(segmentsMode)) {
    return {
      valid: false,
      error: 'segmentsMode must be "single" or "per-segment"',
    };
  }

  // Multi-voice option (default true for conversational podcasts)
  const multiVoice = req.multiVoice !== false;
  const hostVoice = req.hostVoice as string | undefined;
  const cohostVoice = req.cohostVoice as string | undefined;

  return {
    valid: true,
    data: {
      transcript,
      provider: provider as AudioProvider,
      format: format as AudioFormat,
      voice,
      segmentsMode,
      multiVoice,
      hostVoice,
      cohostVoice,
    },
  };
}

export async function POST(
  request: NextRequest
): Promise<NextResponse<RenderAudioEndpointResponse | { error: string }>> {
  const startTime = Date.now();

  try {
    // Initialize database to ensure tables exist
    await initializeDatabase();

    // Check rate limits
    const { enforceRateLimit, recordUsage, checkRequestSize } = await import('@/src/lib/rate-limit');
    const rateLimitResponse = await enforceRateLimit(request, '/api/podcast/render-audio');
    if (rateLimitResponse) {
      return rateLimitResponse as NextResponse<RenderAudioEndpointResponse | { error: string }>;
    }

    const body = await request.json();
    const validation = validateRequest(body);

    if (!validation.valid) {
      return NextResponse.json({ error: validation.error! }, { status: 400 });
    }

    const req = validation.data!;

    // Check request size limits (transcript length)
    const sizeCheck = checkRequestSize('/api/podcast/render-audio', req.transcript.length);
    if (!sizeCheck.allowed) {
      return NextResponse.json({ error: sizeCheck.error || 'Request size too large' }, { status: 400 });
    }

    // Check if transcript has multiple speakers for multi-voice
    const hasMultiple = hasMultipleSpeakers(req.transcript);
    const useMultiVoice = req.multiVoice && hasMultiple;

    // Build voice config for multi-voice
    const voiceConfig: MultiVoiceConfig | undefined = useMultiVoice
      ? {
          hostVoice: req.hostVoice || DEFAULT_VOICE_PAIRS[req.provider].hostVoice,
          cohostVoice: req.cohostVoice || DEFAULT_VOICE_PAIRS[req.provider].cohostVoice,
        }
      : undefined;

    logger.info("Render audio request", {
      provider: req.provider,
      format: req.format,
      voice: req.voice,
      segmentsMode: req.segmentsMode,
      transcriptLength: req.transcript.length,
      multiVoice: useMultiVoice,
      hostVoice: voiceConfig?.hostVoice,
      cohostVoice: voiceConfig?.cohostVoice,
    });

    // Step 1: Sanitize transcript
    const sanitized = sanitizeTranscriptForTts(req.transcript);

    if (sanitized.trim().length === 0) {
      return NextResponse.json(
        { error: "Transcript is empty after sanitization (all cues removed?)" },
        { status: 400 }
      );
    }

    // Step 2: Compute hash for caching (include multi-voice config in hash)
    const voiceKey = useMultiVoice
      ? `${voiceConfig!.hostVoice}+${voiceConfig!.cohostVoice}`
      : req.voice;
    const transcriptHash = computeTranscriptHash(
      req.transcript,
      sanitized,
      req.provider,
      voiceKey,
      req.format
    );

    logger.info("Transcript hash computed", {
      hash: transcriptHash,
    });

    // Step 3: Check cache
    const cached = await getPodcastAudioByHash(transcriptHash);
    if (cached) {
      logger.info("Audio found in cache", {
        id: cached.id,
        audioUrl: cached.audioUrl,
      });

      const response: RenderAudioEndpointResponse = {
        id: cached.id,
        podcastId: cached.podcastId,
        generatedAt: new Date((cached.createdAt || Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        provider: cached.provider as AudioProvider,
        format: cached.format as AudioFormat,
        voice: cached.voice || req.voice,
        duration: cached.duration || "0:00",
        audioUrl: cached.audioUrl,
        segmentAudio: cached.segmentAudio,
        generationMetadata: {
          providerLatency: "0ms",
          bytes: cached.bytes,
          transcriptHash,
          cached: true,
        },
      };

      return NextResponse.json(response);
    }

    // Step 4: Render audio (with timeout)
    let audioBuffer: Buffer;
    let durationSeconds: number;
    const renderStartTime = Date.now();

    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Audio render timeout")), TIMEOUT_MS)
      );

      const renderPromise = (async () => {
        if (useMultiVoice) {
          // Multi-voice render: use original transcript (not sanitized) for speaker parsing
          const result = await renderMultiVoiceAudio(
            req.transcript,
            req.provider,
            voiceConfig,
            req.format
          );
          return result;
        } else {
          // Single-voice render: use sanitized transcript
          const result = await renderAudio(
            sanitized,
            req.provider,
            req.voice,
            req.format
          );
          return result;
        }
      })();

      const result = await Promise.race([renderPromise, timeoutPromise]);
      audioBuffer = result.bytes;
      durationSeconds = result.durationSeconds || estimateDurationFromTranscript(sanitized);
    } catch (error) {
      logger.error("Audio render failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      return NextResponse.json(
        { error: `Failed to render audio: ${error instanceof Error ? error.message : "Unknown error"}` },
        { status: 500 }
      );
    }

    const providerLatency = ((Date.now() - renderStartTime) / 1000).toFixed(2);

    // Step 5: Store audio
    const storage = getLocalStorage();
    const audioKey = `podcasts/${uuid()}.${req.format}`;
    const { url: audioUrl, bytes: fileBytes } = await storage.putObject(
      audioKey,
      audioBuffer,
      `audio/${req.format}`
    );

    // Step 6: Save to database
    const audioId = `aud-${uuid()}`;
    const duration = formatDuration(durationSeconds);

    await savePodcastAudio({
      id: audioId,
      transcriptHash,
      provider: req.provider,
      voice: voiceKey,
      format: req.format,
      duration,
      durationSeconds,
      audioUrl,
      bytes: fileBytes,
    });

    const totalDuration = ((Date.now() - startTime) / 1000).toFixed(2);

    logger.info("Audio render completed", {
      id: audioId,
      provider: req.provider,
      bytes: fileBytes,
      duration,
      totalDuration: `${totalDuration}s`,
      providerLatency: `${providerLatency}s`,
    });

    const response: RenderAudioEndpointResponse = {
      id: audioId,
      generatedAt: new Date().toISOString(),
      provider: req.provider,
      format: req.format,
      voice: voiceKey,
      duration,
      audioUrl,
      generationMetadata: {
        providerLatency: `${providerLatency}s`,
        bytes: fileBytes,
        transcriptHash,
        cached: false,
        multiVoice: useMultiVoice,
      },
    };

    // Record successful usage
    await recordUsage(request, '/api/podcast/render-audio');

    return NextResponse.json(response);
  } catch (error) {
    logger.error("Render audio endpoint failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
