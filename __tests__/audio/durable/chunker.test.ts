/**
 * Tests for the deterministic chunk planner (chunker-v1) and the
 * eight-chunk demo fixture (spec: fixture must plan to exactly eight
 * chunks, each at or below 3,800 chars, under a named chunker version).
 */

import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { planChunks, CHUNKER_VERSION, MAX_CHUNK_CHARS } from "../../../src/lib/audio/durable/chunker";
import { sanitizeTranscriptForTts } from "../../../src/lib/audio/sanitize";

const FIXTURE_PATH = path.join(__dirname, "../../fixtures/podcast-8chunk-transcript.txt");
const RENDER_KEY = "f".repeat(64);

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

function loadSanitizedFixture(): string {
  return sanitizeTranscriptForTts(readFileSync(FIXTURE_PATH, "utf8"));
}

// Golden values pinned against chunker-v1. If any of these change, chunk
// boundaries moved: that is a new chunkerVersion (and a new renderKey for
// every render), not a test to update casually.
const GOLDEN_SANITIZED_SHA256 =
  "e6ce8f63c444504397bd1e3d319e4f3bb5f563782705132cb7cdaaeb295eff35";
const GOLDEN_PLAN_HASH =
  "78905729afdedcae5d1b23f096193851bd73c90f624faa1116627e4195d66bc7";
const GOLDEN_CHUNK_HASHES = [
  "1e36998d6a56a53e81af561dd9dc60f043cf35d9bd96852bacc42f0d473c8315",
  "dd335a0e122473d858ba7573a95c63c972894192999fa824be5ac438e92aaa49",
  "8444ee11f96141297c38d22a92de74925bc1cf938dc53014a6333cdb26d6de16",
  "eb826f2cd5e85334ec3a3c93c7ace8154e03aa1086fb0f5b0fea1fe9061e60e2",
  "60e46af01ede2160cd761d2d22ec2fcf59b31feece01678bbe647ceb910d9624",
  "16f5200e781a1f231459a18001fbcde453ea93880aff5069e7664924d17b3c17",
  "bf03245cedfe5a793dc2cd3d7985d8a039465f1d717397a930ed5ebdc0675db0",
  "cc30b4cce5c0affef205ce8d3125b22b07787ddbf25ff3286034c312c6c39ffb",
];

describe("eight-chunk fixture under chunker-v1", () => {
  it("sanitizes to the pinned transcript bytes", () => {
    expect(sha256Hex(loadSanitizedFixture())).toBe(GOLDEN_SANITIZED_SHA256);
  });

  it("plans to exactly eight chunks", () => {
    const plan = planChunks(RENDER_KEY, loadSanitizedFixture());
    expect(plan.totalChunks).toBe(8);
    expect(plan.chunks).toHaveLength(8);
  });

  it("keeps every chunk at or below 3,800 chars and none trivially small", () => {
    const plan = planChunks(RENDER_KEY, loadSanitizedFixture());
    for (const chunk of plan.chunks) {
      const size = chunk.charEnd - chunk.charStart;
      expect(size).toBeLessThanOrEqual(MAX_CHUNK_CHARS);
      expect(size).toBeGreaterThan(1000);
    }
  });

  it("matches the golden per-chunk hashes and plan hash", () => {
    const plan = planChunks(RENDER_KEY, loadSanitizedFixture());
    expect(plan.chunks.map((c) => c.chunkTextHash)).toEqual(GOLDEN_CHUNK_HASHES);
    expect(plan.planHash).toBe(GOLDEN_PLAN_HASH);
  });

  it("carries the render identity and chunker version", () => {
    const plan = planChunks(RENDER_KEY, loadSanitizedFixture());
    expect(plan.renderKey).toBe(RENDER_KEY);
    expect(plan.chunkerVersion).toBe(CHUNKER_VERSION);
    expect(CHUNKER_VERSION).toBe("chunker-v1");
  });

  it("addresses slices whose hashes and byte ranges are self-consistent", () => {
    const sanitized = loadSanitizedFixture();
    const plan = planChunks(RENDER_KEY, sanitized);
    for (const chunk of plan.chunks) {
      const slice = sanitized.slice(chunk.charStart, chunk.charEnd);
      expect(sha256Hex(slice)).toBe(chunk.chunkTextHash);
      expect(chunk.byteEnd - chunk.byteStart).toBe(Buffer.byteLength(slice, "utf8"));
    }
  });

  it("orders chunks by strictly increasing, non-overlapping [start, end) ranges", () => {
    const sanitized = loadSanitizedFixture();
    const plan = planChunks(RENDER_KEY, sanitized);
    plan.chunks.forEach((chunk, i) => {
      expect(chunk.index).toBe(i);
      expect(chunk.charEnd).toBeGreaterThan(chunk.charStart);
      if (i > 0) {
        expect(chunk.charStart).toBeGreaterThanOrEqual(plan.chunks[i - 1].charEnd);
        expect(chunk.byteStart).toBeGreaterThanOrEqual(plan.chunks[i - 1].byteEnd);
      }
    });
    expect(plan.chunks[0].charStart).toBe(0);
    expect(plan.chunks[7].charEnd).toBe(sanitized.length);
  });
});

describe("planChunks determinism", () => {
  it("produces identical plans across runs", () => {
    const sanitized = loadSanitizedFixture();
    const first = planChunks(RENDER_KEY, sanitized);
    const second = planChunks(RENDER_KEY, sanitized);
    expect(second).toEqual(first);
    expect(second.planHash).toBe(first.planHash);
  });

  it("planHash pins the chunk list, not the renderKey", () => {
    const sanitized = loadSanitizedFixture();
    const a = planChunks("a".repeat(64), sanitized);
    const b = planChunks("b".repeat(64), sanitized);
    expect(a.planHash).toBe(b.planHash);
    expect(a.renderKey).not.toBe(b.renderKey);
  });
});

describe("chunker-v1 boundary behavior (legacy chunkText parity)", () => {
  it("returns one whole-text chunk at or below the ceiling", () => {
    const text = "Short transcript. It fits in one provider call.";
    const plan = planChunks(RENDER_KEY, text);
    expect(plan.totalChunks).toBe(1);
    expect(plan.chunks[0]).toMatchObject({
      index: 0,
      charStart: 0,
      charEnd: text.length,
      byteStart: 0,
      byteEnd: Buffer.byteLength(text, "utf8"),
    });
  });

  it("breaks at the last sentence boundary before the ceiling", () => {
    // Two sentences of 2,000 chars each: the ". " after the first ends
    // past the midpoint, so the break lands there, not at the hard cut.
    const first = `${"a".repeat(1998)}. `;
    const second = "b".repeat(2000);
    const plan = planChunks(RENDER_KEY, first + second);
    expect(plan.totalChunks).toBe(2);
    // Pushed chunks are trimmed, so chunk 0 excludes the trailing space.
    expect(plan.chunks[0]).toMatchObject({ charStart: 0, charEnd: 1999 });
    expect(plan.chunks[1]).toMatchObject({ charStart: 2000, charEnd: 4000 });
  });

  it("cuts hard at the ceiling when no break candidate passes the midpoint", () => {
    const text = "x".repeat(MAX_CHUNK_CHARS + 100);
    const plan = planChunks(RENDER_KEY, text);
    expect(plan.totalChunks).toBe(2);
    expect(plan.chunks[0]).toMatchObject({ charStart: 0, charEnd: MAX_CHUNK_CHARS });
    expect(plan.chunks[1]).toMatchObject({
      charStart: MAX_CHUNK_CHARS,
      charEnd: MAX_CHUNK_CHARS + 100,
    });
  });

  it("tracks UTF-8 byte offsets separately from char offsets for multibyte text", () => {
    const text = "É".repeat(MAX_CHUNK_CHARS + 10); // 2 bytes per char
    const plan = planChunks(RENDER_KEY, text);
    expect(plan.totalChunks).toBe(2);
    expect(plan.chunks[0].byteEnd).toBe(MAX_CHUNK_CHARS * 2);
    expect(plan.chunks[1].byteStart).toBe(MAX_CHUNK_CHARS * 2);
    expect(plan.chunks[1].byteEnd).toBe((MAX_CHUNK_CHARS + 10) * 2);
  });

  it("rejects an empty or whitespace-only transcript", () => {
    expect(() => planChunks(RENDER_KEY, "")).toThrow(/sanitized transcript is empty/);
    expect(() => planChunks(RENDER_KEY, "  \n ")).toThrow(/sanitized transcript is empty/);
  });
});
