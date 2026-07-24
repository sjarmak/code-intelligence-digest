/**
 * Tests for the format-aware stitcher ("stitcher-v1").
 *
 * Includes the Stage-0 format-validation gate the spec demands: proof that
 * naive Buffer.concat of WAV or MP3 chunk files yields an artifact the
 * validator rejects, while the ffmpeg concat path produces a playable
 * container whose duration matches the chunk-duration sum.
 *
 * Requires /usr/bin/ffmpeg and /usr/bin/ffprobe (present in CI and dev).
 */

import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  stitchChunks,
  validateStitchedFile,
  durationToleranceMs,
  STITCHER_VERSION,
  StitchObjectStore,
  StitchInputError,
  ChunkObjectMissingError,
  ChunkChecksumMismatchError,
  StitchValidationError,
} from "../../../src/lib/audio/durable/stitcher";
import { chunkKeyFor, finalKeyFor } from "../../../src/lib/audio/durable/keys";
import { ChunkMetadata } from "../../../src/lib/audio/durable/types";
import { AudioFormat } from "../../../src/lib/audio/types";

const RENDER_KEY = "ab".repeat(32);
const TONE_DURATIONS_MS = [300, 400, 500];
const SUM_MS = 1200;

const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "stitcher-test-"));
afterAll(() => {
  fs.rmSync(tmpRoot, { recursive: true, force: true });
});

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Deterministic mono 16-bit PCM WAV sine tone with an exact sample count. */
function makeWavTone(freqHz: number, durationMs: number, sampleRate = 16000): Buffer {
  const samples = Math.round((sampleRate * durationMs) / 1000);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i++) {
    const value = Math.round(0.3 * 32767 * Math.sin((2 * Math.PI * freqHz * i) / sampleRate));
    data.writeInt16LE(value, i * 2);
  }
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16); // fmt chunk size
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * 2, 28); // byte rate
  header.writeUInt16LE(2, 32); // block align
  header.writeUInt16LE(16, 34); // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  return Buffer.concat([header, data]);
}

function tmpFile(name: string, bytes: Buffer): string {
  const filePath = path.join(tmpRoot, name);
  fs.writeFileSync(filePath, bytes);
  return filePath;
}

interface ProbeSummary {
  formatName: string;
  codecName: string;
  durationMs: number;
}

/** Independent ffprobe call so assertions do not trust the stitcher's own validator. */
function probe(filePath: string): ProbeSummary {
  const raw = execFileSync("/usr/bin/ffprobe", [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]).toString();
  const parsed = JSON.parse(raw);
  return {
    formatName: parsed.format.format_name,
    codecName: parsed.streams[0].codec_name,
    durationMs: Math.round(Number(parsed.format.duration) * 1000),
  };
}

function encodeMp3(wavBytes: Buffer, name: string): Buffer {
  const wavPath = tmpFile(`${name}.wav`, wavBytes);
  const mp3Path = path.join(tmpRoot, `${name}.mp3`);
  execFileSync("/usr/bin/ffmpeg", [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-i",
    wavPath,
    "-c:a",
    "libmp3lame",
    "-q:a",
    "2",
    mp3Path,
  ]);
  return fs.readFileSync(mp3Path);
}

/** In-memory StitchObjectStore that counts writes for idempotency assertions. */
class MemoryStore implements StitchObjectStore {
  private objects = new Map<string, Buffer>();
  putCount = 0;

  async getObject(key: string): Promise<Buffer> {
    const bytes = this.objects.get(key);
    if (!bytes) {
      throw new Error(`no such object: ${key}`);
    }
    return bytes;
  }

  async putObject(key: string, bytes: Buffer): Promise<{ url: string; bytes: number }> {
    this.putCount++;
    this.objects.set(key, bytes);
    return { url: `/memory/${key}`, bytes: bytes.length };
  }

  async exists(key: string): Promise<boolean> {
    return this.objects.has(key);
  }

  seed(key: string, bytes: Buffer): void {
    this.objects.set(key, bytes);
  }

  get(key: string): Buffer {
    const bytes = this.objects.get(key);
    if (!bytes) {
      throw new Error(`no such object: ${key}`);
    }
    return bytes;
  }
}

function seedChunks(
  store: MemoryStore,
  format: AudioFormat,
  chunkBytes: Buffer[],
  durationsMs: number[]
): ChunkMetadata[] {
  return chunkBytes.map((bytes, i) => {
    const objectKey = chunkKeyFor(RENDER_KEY, i, format);
    store.seed(objectKey, bytes);
    return {
      chunkIndex: i,
      objectKey,
      checksumSha256: sha256Hex(bytes),
      byteCount: bytes.length,
      durationMs: durationsMs[i],
      providerRequestId: `req-${i}`,
    };
  });
}

function wavTones(): Buffer[] {
  return TONE_DURATIONS_MS.map((ms, i) => makeWavTone(440 + 110 * i, ms));
}

describe("stitchChunks (wav)", () => {
  it("stitches three wav tones into a valid container with duration == sum within 50ms", async () => {
    const store = new MemoryStore();
    const chunks = seedChunks(store, "wav", wavTones(), TONE_DURATIONS_MS);

    const result = await stitchChunks(
      { renderKey: RENDER_KEY, format: "wav", stitcherVersion: STITCHER_VERSION, chunks },
      store
    );

    expect(result.objectKey).toBe(finalKeyFor(RENDER_KEY, "wav"));
    expect(Math.abs(result.durationMs - SUM_MS)).toBeLessThanOrEqual(50);

    const finalBytes = store.get(result.objectKey);
    expect(result.checksumSha256).toBe(sha256Hex(finalBytes));
    expect(result.byteCount).toBe(finalBytes.length);

    // Independent ffprobe on the stored artifact.
    const probed = probe(tmpFile("independent-final.wav", finalBytes));
    expect(probed.formatName).toBe("wav");
    expect(probed.codecName).toBe("pcm_s16le");
    expect(Math.abs(probed.durationMs - SUM_MS)).toBeLessThanOrEqual(50);
  }, 20000);

  it("reuses a valid existing final object instead of re-stitching", async () => {
    const store = new MemoryStore();
    const chunks = seedChunks(store, "wav", wavTones(), TONE_DURATIONS_MS);
    const input = {
      renderKey: RENDER_KEY,
      format: "wav" as const,
      stitcherVersion: STITCHER_VERSION,
      chunks,
    };

    const first = await stitchChunks(input, store);
    expect(store.putCount).toBe(1);

    const second = await stitchChunks(input, store);
    expect(store.putCount).toBe(1); // no second write: existing final validated and reused
    expect(second.checksumSha256).toBe(first.checksumSha256);
    expect(second.byteCount).toBe(first.byteCount);
  }, 20000);

  it("throws ChunkObjectMissingError for a non-existent chunk object", async () => {
    const store = new MemoryStore();
    const chunks = seedChunks(store, "wav", wavTones(), TONE_DURATIONS_MS);
    // Reference a chunk that was never stored.
    const withMissing = chunks.map((c) =>
      c.chunkIndex === 1 ? { ...c, objectKey: chunkKeyFor("cd".repeat(32), 1, "wav") } : c
    );

    const promise = stitchChunks(
      {
        renderKey: RENDER_KEY,
        format: "wav",
        stitcherVersion: STITCHER_VERSION,
        chunks: withMissing,
      },
      store
    );
    await expect(promise).rejects.toBeInstanceOf(ChunkObjectMissingError);
    await expect(promise).rejects.toThrow(/chunk object missing from store/);
  }, 20000);

  it("throws ChunkChecksumMismatchError when stored bytes do not match the manifest", async () => {
    const store = new MemoryStore();
    const chunks = seedChunks(store, "wav", wavTones(), TONE_DURATIONS_MS);
    store.seed(chunks[2].objectKey, makeWavTone(999, 500)); // corrupt chunk 2 in place

    await expect(
      stitchChunks(
        { renderKey: RENDER_KEY, format: "wav", stitcherVersion: STITCHER_VERSION, chunks },
        store
      )
    ).rejects.toBeInstanceOf(ChunkChecksumMismatchError);
  }, 20000);

  it("rejects a stitcherVersion this stitcher does not implement", async () => {
    const store = new MemoryStore();
    const chunks = seedChunks(store, "wav", wavTones(), TONE_DURATIONS_MS);

    await expect(
      stitchChunks(
        { renderKey: RENDER_KEY, format: "wav", stitcherVersion: "stitcher-v2", chunks },
        store
      )
    ).rejects.toBeInstanceOf(StitchInputError);
  });
});

describe("Stage-0 format validation: naive Buffer.concat is rejected", () => {
  it("rejects naive Buffer.concat of WAV files (duration collapses to first chunk)", async () => {
    const naive = Buffer.concat(wavTones());
    const naivePath = tmpFile("naive.wav", naive);

    // The RIFF header of the first chunk claims only its own data length.
    expect(probe(naivePath).durationMs).toBe(TONE_DURATIONS_MS[0]);

    await expect(
      validateStitchedFile(naivePath, "wav", SUM_MS, 50)
    ).rejects.toBeInstanceOf(StitchValidationError);
    await expect(validateStitchedFile(naivePath, "wav", SUM_MS, 50)).rejects.toThrow(
      /duration mismatch/
    );
  }, 20000);

  it("rejects naive Buffer.concat of MP3 files (mid-stream metadata breaks decode)", async () => {
    const mp3Chunks = wavTones().map((wav, i) => encodeMp3(wav, `tone-${i}`));
    const durations = mp3Chunks.map((bytes, i) =>
      probe(tmpFile(`probe-chunk-${i}.mp3`, bytes)).durationMs
    );
    const naive = Buffer.concat(mp3Chunks);
    const naivePath = tmpFile("naive.mp3", naive);
    const expected = durations.reduce((a, b) => a + b, 0);

    await expect(
      validateStitchedFile(
        naivePath,
        "mp3",
        expected,
        durationToleranceMs("mp3", mp3Chunks.length)
      )
    ).rejects.toBeInstanceOf(StitchValidationError);
  }, 30000);
});

describe("stitchChunks (mp3)", () => {
  it("re-encodes mp3 chunks into one valid mp3 within the frame-padding tolerance", async () => {
    const mp3Chunks = wavTones().map((wav, i) => encodeMp3(wav, `stitch-tone-${i}`));
    const durations = mp3Chunks.map((bytes, i) =>
      probe(tmpFile(`stitch-probe-${i}.mp3`, bytes)).durationMs
    );
    const store = new MemoryStore();
    const chunks = seedChunks(store, "mp3", mp3Chunks, durations);

    const result = await stitchChunks(
      { renderKey: RENDER_KEY, format: "mp3", stitcherVersion: STITCHER_VERSION, chunks },
      store
    );

    expect(result.objectKey).toBe(finalKeyFor(RENDER_KEY, "mp3"));
    const finalBytes = store.get(result.objectKey);
    const probed = probe(tmpFile("independent-final.mp3", finalBytes));
    expect(probed.formatName).toBe("mp3");
    expect(probed.codecName).toBe("mp3");
    // Source tones total 1200ms; mp3 framing quantizes but stays in the tolerance band.
    const expected = durations.reduce((a, b) => a + b, 0);
    expect(Math.abs(probed.durationMs - expected)).toBeLessThanOrEqual(
      durationToleranceMs("mp3", chunks.length)
    );
  }, 30000);
});
