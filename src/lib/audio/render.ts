/**
 * Audio rendering orchestrator
 * Coordinates provider selection, caching, and storage
 */

import { AudioProvider, RenderAudioRequest, RenderAudioResult, TtsProvider } from "./types";
import { sanitizeTranscriptForTts, computeTranscriptHash } from "./sanitize";
import { createOpenAIProvider } from "./providers/openaiTts";
import { createElevenLabsProvider } from "./providers/elevenlabsTts";
import { createNemoProvider } from "./providers/nemoTts";
import { logger } from "../logger";

/**
 * Get provider instance by name
 */
export function getProvider(provider: AudioProvider): TtsProvider {
  switch (provider) {
    case "openai":
      return createOpenAIProvider();
    case "elevenlabs":
      return createElevenLabsProvider();
    case "nemo":
      return createNemoProvider();
    default:
      throw new Error(`Unknown provider: ${provider}`);
  }
}

/**
 * Render transcript to audio bytes
 * Handles sanitization, provider selection, and basic caching
 */
export async function renderAudio(
  transcript: string,
  provider: AudioProvider,
  voice?: string,
  format: "mp3" | "wav" = "mp3"
): Promise<RenderAudioResult> {
  if (!transcript || transcript.trim().length === 0) {
    throw new Error("Transcript cannot be empty");
  }

  // Sanitize transcript for TTS
  const sanitized = sanitizeTranscriptForTts(transcript);

  if (sanitized.trim().length === 0) {
    throw new Error("Transcript is empty after sanitization");
  }

  // Get provider
  const ttsProvider = getProvider(provider);

  logger.info("Starting audio render", {
    provider: ttsProvider.getName(),
    voice: voice || "default",
    format,
    transcriptLength: sanitized.length,
  });

  const startTime = Date.now();

  try {
    // Render audio
    const result = await ttsProvider.render({
      transcript: sanitized,
      provider,
      format,
      voice,
    });

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(2);
    logger.info("Audio render completed", {
      provider: ttsProvider.getName(),
      bytes: result.bytes.length,
      duration: result.durationSeconds,
      elapsed: `${elapsed}s`,
    });

    return result;
  } catch (error) {
    logger.error("Audio render failed", {
      provider: ttsProvider.getName(),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Render multiple segments to audio
 * Returns array of audio buffers in order
 */
export async function renderAudioSegments(
  segments: string[],
  provider: AudioProvider,
  voice?: string,
  format: "mp3" | "wav" = "mp3"
): Promise<Buffer[]> {
  const results: Buffer[] = [];

  logger.info("Rendering audio segments", {
    provider,
    segmentCount: segments.length,
  });

  for (let i = 0; i < segments.length; i++) {
    try {
      const result = await renderAudio(segments[i], provider, voice, format);
      results.push(result.bytes);
      logger.info(`Segment ${i + 1}/${segments.length} rendered`);
    } catch (error) {
      logger.warn(`Failed to render segment ${i}`, {
        error: error instanceof Error ? error.message : String(error),
      });
      // Continue with next segment rather than failing entire operation
      throw error; // Propagate for now, caller can decide retry policy
    }
  }

  return results;
}

/**
 * Stitch audio buffers together (simple concatenation)
 * Note: For production, use a proper audio library like fluent-ffmpeg
 */
export function stitchAudioBuffers(buffers: Buffer[]): Buffer {
  if (buffers.length === 0) {
    throw new Error("No audio buffers to stitch");
  }

  if (buffers.length === 1) {
    return buffers[0];
  }

  // Simple concatenation for MP3
  // Note: This is a naive approach. For production:
  // - Use ffmpeg to re-encode and properly concatenate
  // - Handle format-specific requirements
  return Buffer.concat(buffers);
}

/**
 * Compute cache key for transcript + rendering config
 */
export function computeCacheKey(
  transcript: string,
  provider: AudioProvider,
  voice?: string,
  format: "mp3" | "wav" = "mp3"
): string {
  const sanitized = sanitizeTranscriptForTts(transcript);
  return computeTranscriptHash(transcript, sanitized, provider, voice, format);
}
