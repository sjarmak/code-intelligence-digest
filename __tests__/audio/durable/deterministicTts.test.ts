/**
 * Tests for the deterministic rehearsal TTS adapter: WAV validity,
 * byte-for-byte stability, ledger attempt/commit ordering, and fault
 * gates at before_provider_commit.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationFailure } from "@temporalio/common";
import {
  DeterministicTtsProvider,
  SAMPLE_RATE,
} from "../../../src/lib/audio/durable/providers/deterministicTts";
import { readLedger, waitForLedgerEvent } from "../../../src/lib/audio/durable/ledger";

const RENDER_KEY = "0a591a85913c48557f5873010825325a900f0574f07d6ddaa4246070d6d16990";
const CHUNK_TEXT_HASH = createHash("sha256").update("chunk seven text").digest("hex");

describe("DeterministicTtsProvider", () => {
  let dir: string;
  let controlPath: string;
  let ledgerPath: string;
  let provider: DeterministicTtsProvider;

  const request = (overrides: Partial<Parameters<DeterministicTtsProvider["renderChunk"]>[0]> = {}) => ({
    renderKey: RENDER_KEY,
    chunkIndex: 6,
    chunkTextHash: CHUNK_TEXT_HASH,
    attempt: 1,
    ...overrides,
  });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "durable-tts-"));
    controlPath = join(dir, "fault-control.json");
    ledgerPath = join(dir, "ledger.jsonl");
    provider = new DeterministicTtsProvider({ controlPath, ledgerPath, pollIntervalMs: 5 });
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("names itself demo-deterministic-v1", () => {
    expect(provider.getName()).toBe("demo-deterministic-v1");
  });

  it("emits a valid 44.1kHz mono 16-bit PCM WAV with consistent lengths", async () => {
    const { bytes, byteCount, durationMs, checksumSha256 } = await provider.renderChunk(request());

    expect(byteCount).toBe(bytes.length);
    expect(bytes.toString("ascii", 0, 4)).toBe("RIFF");
    expect(bytes.toString("ascii", 8, 12)).toBe("WAVE");
    expect(bytes.toString("ascii", 12, 16)).toBe("fmt ");
    expect(bytes.readUInt32LE(4)).toBe(bytes.length - 8); // RIFF chunk size
    expect(bytes.readUInt32LE(16)).toBe(16); // PCM fmt subchunk size
    expect(bytes.readUInt16LE(20)).toBe(1); // PCM
    expect(bytes.readUInt16LE(22)).toBe(1); // mono
    expect(bytes.readUInt32LE(24)).toBe(SAMPLE_RATE);
    expect(bytes.readUInt32LE(28)).toBe(SAMPLE_RATE * 2); // byte rate
    expect(bytes.readUInt16LE(32)).toBe(2); // block align
    expect(bytes.readUInt16LE(34)).toBe(16); // bits per sample
    expect(bytes.toString("ascii", 36, 40)).toBe("data");
    const dataBytes = bytes.readUInt32LE(40);
    expect(dataBytes).toBe(bytes.length - 44);
    expect(dataBytes % 2).toBe(0);

    // 8 tones of 250-505ms each: 2.0s-4.04s, and durationMs matches the data.
    expect(durationMs).toBe(Math.round((dataBytes / 2 / SAMPLE_RATE) * 1000));
    expect(durationMs).toBeGreaterThanOrEqual(2000);
    expect(durationMs).toBeLessThanOrEqual(4040);

    expect(checksumSha256).toBe(createHash("sha256").update(bytes).digest("hex"));
  });

  it("is byte-for-byte stable across runs and attempts", async () => {
    const first = await provider.renderChunk(request({ attempt: 1 }));
    const second = await provider.renderChunk(request({ attempt: 2 }));
    expect(second.bytes.equals(first.bytes)).toBe(true);
    expect(second.checksumSha256).toBe(first.checksumSha256);
    expect(second.durationMs).toBe(first.durationMs);
    // providerRequestId is the idempotency handle: stable across attempts.
    expect(second.providerRequestId).toBe(first.providerRequestId);
    expect(first.providerRequestId).toMatch(/^demo-[0-9a-f]{32}$/);
  });

  it("changes bytes when any identity component changes", async () => {
    const base = await provider.renderChunk(request());
    const otherChunk = await provider.renderChunk(request({ chunkIndex: 7 }));
    const otherText = await provider.renderChunk(
      request({ chunkTextHash: createHash("sha256").update("different text").digest("hex") })
    );
    expect(otherChunk.bytes.equals(base.bytes)).toBe(false);
    expect(otherText.bytes.equals(base.bytes)).toBe(false);
    expect(otherChunk.providerRequestId).not.toBe(base.providerRequestId);
  });

  it("records provider_attempt before provider_commit with matching identity", async () => {
    const result = await provider.renderChunk(request({ attempt: 3 }));
    const events = readLedger(ledgerPath);
    expect(events.map((e) => e.type)).toEqual(["provider_attempt", "provider_commit"]);
    expect(events[0]).toMatchObject({
      renderKey: RENDER_KEY,
      chunkIndex: 6,
      attempt: 3,
      provider: "demo",
      providerModel: "deterministic-v1",
    });
    expect(events[1]).toMatchObject({
      renderKey: RENDER_KEY,
      chunkIndex: 6,
      attempt: 3,
      providerRequestId: result.providerRequestId,
      checksumSha256: result.checksumSha256,
      byteCount: result.byteCount,
    });
  });

  it("consumes fail_503_once at before_provider_commit exactly once, then the retry commits", async () => {
    writeFileSync(
      controlPath,
      JSON.stringify({
        gates: [
          {
            renderKey: RENDER_KEY,
            phase: "render_chunk",
            boundary: "before_provider_commit",
            chunkIndex: 6,
            action: { kind: "fail_503_once" },
          },
        ],
      })
    );

    let thrown: unknown;
    try {
      await provider.renderChunk(request({ attempt: 1 }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    expect((thrown as ApplicationFailure).nonRetryable).toBe(false);

    const retry = await provider.renderChunk(request({ attempt: 2 }));
    expect(retry.byteCount).toBeGreaterThan(44);

    const events = readLedger(ledgerPath);
    expect(events.map((e) => e.type)).toEqual([
      "provider_attempt", // attempt 1, no commit
      "injected_failure",
      "provider_attempt", // attempt 2
      "provider_commit",
    ]);
    const commits = events.filter((e) => e.type === "provider_commit");
    expect(commits).toHaveLength(1);
    expect(commits[0]).toMatchObject({ chunkIndex: 6, attempt: 2 });
    expect(events[1]).toMatchObject({ attempt: 1, message: expect.stringMatching(/503/) });
  });

  it("holds before committing until the gate is released", async () => {
    writeFileSync(
      controlPath,
      JSON.stringify({
        gates: [
          {
            renderKey: RENDER_KEY,
            phase: "render_chunk",
            boundary: "before_provider_commit",
            chunkIndex: 6,
            attempt: 1,
            action: { kind: "hold" },
          },
        ],
      })
    );

    let committed = false;
    const rendering = provider.renderChunk(request()).then((result) => {
      committed = true;
      return result;
    });

    await waitForLedgerEvent((e) => e.type === "gate_reached", {
      path: ledgerPath,
      pollIntervalMs: 5,
      timeoutMs: 2000,
    });
    // Attempt is durably recorded while held; commit is not.
    const held = readLedger(ledgerPath);
    expect(held.map((e) => e.type)).toEqual(["provider_attempt", "gate_reached"]);
    await new Promise((resolve) => setImmediate(resolve));
    expect(committed).toBe(false);

    unlinkSync(controlPath); // release
    const result = await rendering;
    expect(committed).toBe(true);
    const events = readLedger(ledgerPath);
    expect(events.map((e) => e.type)).toEqual([
      "provider_attempt",
      "gate_reached",
      "provider_commit",
    ]);
    expect(events[2]).toMatchObject({ checksumSha256: result.checksumSha256 });
  });

  it("rejects malformed identity inputs", async () => {
    await expect(provider.renderChunk(request({ renderKey: "short" }))).rejects.toThrow(
      /renderKey must be 64-char lowercase hex/
    );
    await expect(provider.renderChunk(request({ chunkTextHash: "XYZ" }))).rejects.toThrow(
      /chunkTextHash must be 64-char lowercase hex/
    );
    await expect(provider.renderChunk(request({ chunkIndex: -1 }))).rejects.toThrow(
      /chunkIndex must be a non-negative integer/
    );
    await expect(provider.renderChunk(request({ attempt: 0 }))).rejects.toThrow(
      /attempt must be a 1-based integer/
    );
    // Validation failures precede any ledger write.
    expect(readLedger(ledgerPath)).toEqual([]);
  });
});
