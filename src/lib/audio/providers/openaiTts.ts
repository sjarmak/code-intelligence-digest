/**
 * OpenAI TTS provider
 * Uses OpenAI's text-to-speech API (tts-1 or tts-1-hd)
 */

import OpenAI from "openai";
import { TtsProvider, RenderAudioRequest, RenderAudioResult } from "../types";
import { logger } from "../../logger";

export class OpenAITtsProvider implements TtsProvider {
  private client: OpenAI;
  private model: "tts-1" | "tts-1-hd";

  constructor(apiKey?: string, model: "tts-1" | "tts-1-hd" = "tts-1") {
    const key = apiKey || process.env.OPENAI_API_KEY;
    if (!key) {
      throw new Error("OPENAI_API_KEY not found");
    }
    this.client = new OpenAI({ apiKey: key });
    this.model = model;
  }

  getName(): string {
    return `openai-${this.model}`;
  }

  async render(req: RenderAudioRequest): Promise<RenderAudioResult> {
    if (!req.transcript || req.transcript.trim().length === 0) {
      throw new Error("Transcript is empty");
    }

    // OpenAI TTS supports: alloy, echo, fable, onyx, nova, shimmer
    const voice = (req.voice as any) || "alloy";

    try {
      logger.info("Rendering audio with OpenAI TTS", {
        model: this.model,
        voice,
        textLength: req.transcript.length,
      });

      // Call OpenAI TTS API
      const response = await this.client.audio.speech.create({
        model: this.model,
        voice,
        input: req.transcript,
        response_format: "mp3",
      });

      // Convert response to buffer
      const arrayBuffer = await response.arrayBuffer();
      const bytes = Buffer.from(arrayBuffer);

      logger.info("Audio rendered successfully", {
        provider: "openai",
        bytes: bytes.length,
        voice,
      });

      return {
        bytes,
        // OpenAI API doesn't return duration, estimate from transcript
        durationSeconds: this.estimateDuration(req.transcript),
      };
    } catch (error) {
      logger.error("OpenAI TTS rendering failed", {
        error: error instanceof Error ? error.message : String(error),
        voice,
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
 * Create OpenAI provider instance
 */
export function createOpenAIProvider(
  apiKey?: string,
  model?: "tts-1" | "tts-1-hd"
): OpenAITtsProvider {
  return new OpenAITtsProvider(apiKey, model);
}
