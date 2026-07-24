/**
 * Deterministic rehearsal TTS adapter ("demo" provider, model
 * "deterministic-v1").
 *
 * Emits a valid 44.1kHz mono 16-bit PCM WAV of a short tone sequence
 * derived from sha256(renderKey + chunkIndex + chunkTextHash), so output
 * is byte-for-byte stable across runs, machines, and retries. No
 * network, no provider cost, and retry counts are assertable: every
 * render appends provider_attempt before synthesis and provider_commit
 * after, and honors fault gates at the "before_provider_commit"
 * boundary (the demo's worker-kill hold and one-shot 503 injection).
 *
 * Tones use integer square-wave arithmetic, not Math.sin, so bytes do
 * not depend on the JS engine's transcendental implementations.
 */

import { createHash } from "node:crypto";
import { appendLedgerEvent } from "../ledger";
import { checkFaultGate, GateCheckOptions } from "../faultGates";
import { DurableProvider } from "../types";

export const DETERMINISTIC_PROVIDER: DurableProvider = "demo";
export const DETERMINISTIC_MODEL = "deterministic-v1";

export const SAMPLE_RATE = 44100;
const CHANNELS = 1;
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = BITS_PER_SAMPLE / 8;
const AMPLITUDE = 9000; // ~27% of int16 range; audible without clipping
const TONE_COUNT = 8;
const WAV_HEADER_BYTES = 44;

const HEX64 = /^[0-9a-f]{64}$/;

/** Identity of one chunk render; everything the byte stream derives from. */
export interface DeterministicChunkRequest {
  renderKey: string;
  /** 0-based chunk index. */
  chunkIndex: number;
  /** sha256 hex of the chunk's exact text slice (from the plan). */
  chunkTextHash: string;
  /** Temporal Activity attempt, 1-based. */
  attempt: number;
}

/** Bytes plus the compact metadata the renderChunk Activity records. */
export interface DeterministicChunkResult {
  bytes: Buffer;
  byteCount: number;
  durationMs: number;
  checksumSha256: string;
  /** Stable across attempts: the idempotency handle a real provider would get. */
  providerRequestId: string;
}

export class DeterministicTtsProvider {
  constructor(private readonly gateOptions: GateCheckOptions = {}) {}

  getName(): string {
    return `${DETERMINISTIC_PROVIDER}-${DETERMINISTIC_MODEL}`;
  }

  async renderChunk(req: DeterministicChunkRequest): Promise<DeterministicChunkResult> {
    validateRequest(req);
    const seedHash = chunkSeedHash(req.renderKey, req.chunkIndex, req.chunkTextHash);
    const providerRequestId = `demo-${seedHash.toString("hex").slice(0, 32)}`;

    appendLedgerEvent(
      {
        type: "provider_attempt",
        ts: new Date().toISOString(),
        renderKey: req.renderKey,
        chunkIndex: req.chunkIndex,
        attempt: req.attempt,
        provider: DETERMINISTIC_PROVIDER,
        providerModel: DETERMINISTIC_MODEL,
      },
      this.gateOptions.ledgerPath
    );

    const bytes = synthesizeWav(seedHash);
    const durationMs = Math.round(
      ((bytes.length - WAV_HEADER_BYTES) / BYTES_PER_SAMPLE / SAMPLE_RATE) * 1000
    );

    await checkFaultGate(
      {
        renderKey: req.renderKey,
        phase: "render_chunk",
        boundary: "before_provider_commit",
        chunkIndex: req.chunkIndex,
        attempt: req.attempt,
      },
      this.gateOptions
    );

    const checksumSha256 = createHash("sha256").update(bytes).digest("hex");
    appendLedgerEvent(
      {
        type: "provider_commit",
        ts: new Date().toISOString(),
        renderKey: req.renderKey,
        chunkIndex: req.chunkIndex,
        attempt: req.attempt,
        providerRequestId,
        checksumSha256,
        byteCount: bytes.length,
      },
      this.gateOptions.ledgerPath
    );

    return {
      bytes,
      byteCount: bytes.length,
      durationMs,
      checksumSha256,
      providerRequestId,
    };
  }
}

function validateRequest(req: DeterministicChunkRequest): void {
  if (!HEX64.test(req.renderKey)) {
    throw new Error(`deterministicTts: renderKey must be 64-char lowercase hex, got ${JSON.stringify(req.renderKey)}`);
  }
  if (!HEX64.test(req.chunkTextHash)) {
    throw new Error(`deterministicTts: chunkTextHash must be 64-char lowercase hex, got ${JSON.stringify(req.chunkTextHash)}`);
  }
  if (!Number.isInteger(req.chunkIndex) || req.chunkIndex < 0) {
    throw new Error(`deterministicTts: chunkIndex must be a non-negative integer, got ${req.chunkIndex}`);
  }
  if (!Number.isInteger(req.attempt) || req.attempt < 1) {
    throw new Error(`deterministicTts: attempt must be a 1-based integer, got ${req.attempt}`);
  }
}

/**
 * Seed = sha256(renderKey + chunkIndex + chunkTextHash), the spec's
 * derivation. renderKey and chunkTextHash are fixed-length hex, so the
 * plain concatenation with the decimal index is unambiguous.
 */
function chunkSeedHash(renderKey: string, chunkIndex: number, chunkTextHash: string): Buffer {
  return createHash("sha256")
    .update(`${renderKey}${chunkIndex}${chunkTextHash}`)
    .digest();
}

/**
 * Map the 32 seed bytes to 8 tones. Byte 2i picks the frequency
 * (220-1240 Hz), byte 2i+1 the duration (250-505 ms), so a chunk lasts
 * 2.0-4.04 s and any seed change is audible and byte-visible.
 */
function synthesizeWav(seedHash: Buffer): Buffer {
  const tones: { periodSamples: number; sampleCount: number }[] = [];
  let totalSamples = 0;
  for (let i = 0; i < TONE_COUNT; i++) {
    const freqHz = 220 + seedHash[2 * i] * 4;
    const durationMs = 250 + seedHash[2 * i + 1];
    const sampleCount = Math.round((SAMPLE_RATE * durationMs) / 1000);
    tones.push({ periodSamples: Math.round(SAMPLE_RATE / freqHz), sampleCount });
    totalSamples += sampleCount;
  }

  const dataBytes = totalSamples * BYTES_PER_SAMPLE;
  const wav = Buffer.alloc(WAV_HEADER_BYTES + dataBytes);
  writeWavHeader(wav, dataBytes);

  let offset = WAV_HEADER_BYTES;
  for (const tone of tones) {
    const half = Math.floor(tone.periodSamples / 2);
    for (let n = 0; n < tone.sampleCount; n++) {
      const sample = n % tone.periodSamples < half ? AMPLITUDE : -AMPLITUDE;
      wav.writeInt16LE(sample, offset);
      offset += BYTES_PER_SAMPLE;
    }
  }
  return wav;
}

/** Canonical 44-byte RIFF/WAVE header for PCM mono 16-bit audio. */
function writeWavHeader(wav: Buffer, dataBytes: number): void {
  const byteRate = SAMPLE_RATE * CHANNELS * BYTES_PER_SAMPLE;
  const blockAlign = CHANNELS * BYTES_PER_SAMPLE;
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + dataBytes, 4); // RIFF chunk size = file length - 8
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16); // fmt subchunk size (PCM)
  wav.writeUInt16LE(1, 20); // audio format 1 = PCM
  wav.writeUInt16LE(CHANNELS, 22);
  wav.writeUInt32LE(SAMPLE_RATE, 24);
  wav.writeUInt32LE(byteRate, 28);
  wav.writeUInt16LE(blockAlign, 32);
  wav.writeUInt16LE(BITS_PER_SAMPLE, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(dataBytes, 40);
}
