/**
 * NeMo TTS provider (NVIDIA NeMo/Riva)
 * Uses NVIDIA Riva (or local NeMo) for speech synthesis
 * Provider stub - configure via environment variables
 */

import { TtsProvider, RenderAudioRequest, RenderAudioResult } from "../types";
import { logger } from "../../logger";

export class NemoTtsProvider implements TtsProvider {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl?: string, apiKey?: string) {
    this.baseUrl = baseUrl || process.env.NEMO_TTS_BASE_URL || "";
    this.apiKey = apiKey || process.env.NEMO_TTS_API_KEY;

    if (!this.baseUrl) {
      throw new Error(
        "NEMO_TTS_BASE_URL not configured. Set NEMO_TTS_BASE_URL environment variable."
      );
    }
  }

  getName(): string {
    return "nemo";
  }

  async render(req: RenderAudioRequest): Promise<RenderAudioResult> {
    if (!req.transcript || req.transcript.trim().length === 0) {
      throw new Error("Transcript is empty");
    }

    const voice = req.voice || "default";

    try {
      logger.info("Rendering audio with NeMo TTS", {
        baseUrl: this.baseUrl,
        voice,
        textLength: req.transcript.length,
      });

      // Example: POST to /api/v1/synthesize
      const endpoint = `${this.baseUrl}/api/v1/synthesize`;

      const headers: Record<string, string> = {
        "Content-Type": "application/json",
      };

      if (this.apiKey) {
        headers["Authorization"] = `Bearer ${this.apiKey}`;
      }

      const response = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({
          text: req.transcript,
          voice: voice,
          language: "en-US",
          sample_rate: req.sampleRate || 24000,
        }),
      });

      if (!response.ok) {
        const error = await response.text();
        throw new Error(`NeMo API error: ${response.status} - ${error}`);
      }

      // Expect binary audio in response
      const arrayBuffer = await response.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);

      logger.info("Audio rendered successfully", {
        provider: "nemo",
        bytes: bytes.length,
      });

      return {
        bytes,
        durationSeconds: this.estimateDuration(req.transcript),
      };
    } catch (error) {
      logger.error("NeMo TTS rendering failed", {
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
 * Create NeMo provider instance
 */
export function createNemoProvider(
  baseUrl?: string,
  apiKey?: string
): NemoTtsProvider {
  return new NemoTtsProvider(baseUrl, apiKey);
}
