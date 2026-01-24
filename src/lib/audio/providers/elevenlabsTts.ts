/**
 * ElevenLabs TTS provider
 * Uses ElevenLabs API for high-quality speech synthesis
 */

import { TtsProvider, RenderAudioRequest, RenderAudioResult } from "../types";
import { logger } from "../../logger";

export class ElevenLabsTtsProvider implements TtsProvider {
  private apiKey: string;
  private baseUrl: string = "https://api.elevenlabs.io/v1";

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ELEVENLABS_API_KEY;
    if (!key) {
      throw new Error("ELEVENLABS_API_KEY not found");
    }
    this.apiKey = key;
  }

  getName(): string {
    return "elevenlabs";
  }

  async render(req: RenderAudioRequest): Promise<RenderAudioResult> {
    if (!req.transcript || req.transcript.trim().length === 0) {
      throw new Error("Transcript is empty");
    }

    // ElevenLabs voice IDs (e.g., "21m00Tcm4TlvDq8ikWAM" for Rachel)
    const voiceId = req.voice || "21m00Tcm4TlvDq8ikWAM";

    try {
      logger.info("Rendering audio with ElevenLabs TTS", {
        voiceId,
        textLength: req.transcript.length,
      });

      const response = await fetch(
        `${this.baseUrl}/text-to-speech/${voiceId}`,
        {
          method: "POST",
          headers: {
            "xi-api-key": this.apiKey,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            text: req.transcript,
            model_id: "eleven_monolingual_v1",
            voice_settings: {
              stability: 0.5,
              similarity_boost: 0.75,
            },
          }),
        }
      );

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`ElevenLabs API error: ${response.status} - ${error}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);

      // Validate buffer has content
      if (!bytes || bytes.length === 0) {
        throw new Error("ElevenLabs TTS returned empty audio buffer");
      }

      logger.info("Audio rendered successfully", {
        provider: "elevenlabs",
        bytes: bytes.length,
      });

      return {
        bytes,
        durationSeconds: this.estimateDuration(req.transcript),
      };
    } catch (error) {
      logger.error("ElevenLabs TTS rendering failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }

  /**
   * Estimate duration from text (150 wpm = 2.5 words per second)
   */
  private estimateDuration(text: string): number {
    const wordCount = text.split(/\s+/).length;
    return Math.ceil((wordCount / 150) * 60);
  }
}

/**
 * Create ElevenLabs provider instance
 */
export function createElevenLabsProvider(apiKey?: string): ElevenLabsTtsProvider {
  return new ElevenLabsTtsProvider(apiKey);
}
