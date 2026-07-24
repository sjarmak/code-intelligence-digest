/**
 * Tests for the invariant checker: the demo's happy path (eight chunks,
 * one injected 503 on chunk index 6) plus one fixture per violation class.
 * The core checker is pure, so evidence is synthesized directly; the IO
 * helpers (ledger read, object walk) get their own temp-dir tests.
 */

import { describe, it, expect } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  InvariantEvidence,
  ObjectStat,
  checkInvariants,
  collectObjects,
  readLedgerFile,
  transcriptProbes,
} from "../../../src/lib/audio/durable/invariants";
import { chunkKeyFor, finalKeyFor } from "../../../src/lib/audio/durable/keys";
import { LedgerEvent } from "../../../src/lib/audio/durable/types";

const RENDER_KEY = "0123456789abcdef".repeat(4);
const OTHER_KEY = "fedcba9876543210".repeat(4);
const TOTAL_CHUNKS = 8;
const INJECTED_CHUNK = 6; // narrated "chunk seven"
const AUDIO_ID = "audio-row-1";
const AUDIO_URL = `/api/audio/podcast-renders/${RENDER_KEY}/final.wav`;

const sha256 = (input: string): string => createHash("sha256").update(input).digest("hex");
const TS = "2026-07-23T00:00:00.000Z";

const TRANSCRIPT =
  "An eight-chunk podcast render has completed six provider calls when the " +
  "application process dies. Six valid audio fragments existed in memory, but " +
  "the request owned all progress, so the replacement process knows only that " +
  "the final cache row is absent.";

function chunkChecksum(index: number): string {
  return sha256(`chunk-bytes-${index}`);
}

const FINAL_CHECKSUM = sha256("final-bytes");
const FINAL_BYTES = 4096;

/** Ledger for the demo run: chunks 0..7, one injected failure on chunk 6. */
function happyEvents(): LedgerEvent[] {
  const events: LedgerEvent[] = [];
  for (let i = 0; i < TOTAL_CHUNKS; i++) {
    events.push({
      type: "provider_attempt",
      ts: TS,
      renderKey: RENDER_KEY,
      chunkIndex: i,
      attempt: 1,
      provider: "demo",
      providerModel: "deterministic-v1",
    });
    if (i === INJECTED_CHUNK) {
      events.push({
        type: "injected_failure",
        ts: TS,
        renderKey: RENDER_KEY,
        phase: "render_chunk",
        boundary: "before_provider_commit",
        chunkIndex: i,
        attempt: 1,
        message: "injected 503",
      });
      events.push({
        type: "provider_attempt",
        ts: TS,
        renderKey: RENDER_KEY,
        chunkIndex: i,
        attempt: 2,
        provider: "demo",
        providerModel: "deterministic-v1",
      });
    }
    events.push({
      type: "provider_commit",
      ts: TS,
      renderKey: RENDER_KEY,
      chunkIndex: i,
      attempt: i === INJECTED_CHUNK ? 2 : 1,
      providerRequestId: `req-${i}`,
      checksumSha256: chunkChecksum(i),
      byteCount: 1000 + i,
    });
    events.push({
      type: "object_write",
      ts: TS,
      renderKey: RENDER_KEY,
      objectKey: chunkKeyFor(RENDER_KEY, i, "wav"),
      checksumSha256: chunkChecksum(i),
      byteCount: 1000 + i,
    });
  }
  events.push({
    type: "object_write",
    ts: TS,
    renderKey: RENDER_KEY,
    objectKey: finalKeyFor(RENDER_KEY, "wav"),
    checksumSha256: FINAL_CHECKSUM,
    byteCount: FINAL_BYTES,
  });
  events.push({
    type: "publish",
    ts: TS,
    renderKey: RENDER_KEY,
    audioId: AUDIO_ID,
    audioUrl: AUDIO_URL,
    finalObjectKey: finalKeyFor(RENDER_KEY, "wav"),
    checksumSha256: FINAL_CHECKSUM,
  });
  return events;
}

function happyObjects(): ObjectStat[] {
  const objects: ObjectStat[] = [];
  for (let i = 0; i < TOTAL_CHUNKS; i++) {
    objects.push({
      objectKey: chunkKeyFor(RENDER_KEY, i, "wav"),
      checksumSha256: chunkChecksum(i),
      byteCount: 1000 + i,
    });
  }
  objects.push({
    objectKey: finalKeyFor(RENDER_KEY, "wav"),
    checksumSha256: FINAL_CHECKSUM,
    byteCount: FINAL_BYTES,
  });
  return objects;
}

function happyEvidence(): InvariantEvidence {
  return {
    renderKey: RENDER_KEY,
    events: happyEvents(),
    ledgerErrors: [],
    objects: happyObjects(),
    db: { kind: "row", row: { id: AUDIO_ID, audioUrl: AUDIO_URL, bytes: FINAL_BYTES } },
    historyText: JSON.stringify({
      events: [
        { eventId: 1, eventType: "WorkflowExecutionStarted", renderKey: RENDER_KEY },
        { eventId: 9, eventType: "ActivityTaskCompleted", checksum: chunkChecksum(0) },
      ],
    }),
    transcriptText: TRANSCRIPT,
    totalChunks: TOTAL_CHUNKS,
  };
}

describe("checkInvariants: the demo run passes", () => {
  it("accepts the eight-chunk run with one injected failure on chunk 6", () => {
    const report = checkInvariants(happyEvidence());
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.publishEvents).toBe(1);
    expect(report.finalObjectsOnDisk).toEqual([finalKeyFor(RENDER_KEY, "wav")]);
    expect(report.db).toMatchObject({ checked: true, ok: true });
    expect(report.history).toMatchObject({ base64Blobs: 0, transcriptLeaks: 0 });

    const byIndex = new Map(report.chunks.map((c) => [c.chunkIndex, c]));
    expect(report.chunks).toHaveLength(TOTAL_CHUNKS);
    expect(byIndex.get(INJECTED_CHUNK)).toEqual({
      chunkIndex: INJECTED_CHUNK,
      attempts: 2,
      commits: 1,
      injectedFailures: 1,
    });
    for (const i of [0, 1, 2, 3, 4, 5, 7]) {
      expect(byIndex.get(i)).toEqual({
        chunkIndex: i,
        attempts: 1,
        commits: 1,
        injectedFailures: 0,
      });
    }
  });

  it("ignores events belonging to a different renderKey", () => {
    const evidence = happyEvidence();
    evidence.events.push({
      type: "provider_commit",
      ts: TS,
      renderKey: OTHER_KEY,
      chunkIndex: 0,
      attempt: 1,
      providerRequestId: "foreign",
      checksumSha256: sha256("foreign"),
      byteCount: 1,
    });
    expect(checkInvariants(evidence).ok).toBe(true);
  });

  it("reports but does not fail when the database check is skipped", () => {
    const evidence = happyEvidence();
    evidence.db = { kind: "skipped" };
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(true);
    expect(report.db).toEqual({ checked: false, ok: null, detail: "database check skipped" });
  });
});

describe("checkInvariants: chunk accounting violations", () => {
  it("flags a repeated provider commit (work redone after a kill)", () => {
    const evidence = happyEvidence();
    evidence.events.push({
      type: "provider_commit",
      ts: TS,
      renderKey: RENDER_KEY,
      chunkIndex: 3,
      attempt: 2,
      providerRequestId: "req-3-repeat",
      checksumSha256: chunkChecksum(3),
      byteCount: 1003,
    });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/chunk 3: expected exactly 1 provider_commit, found 2/);
  });

  it("flags a chunk missing entirely from the ledger", () => {
    const evidence = happyEvidence();
    const key5 = chunkKeyFor(RENDER_KEY, 5, "wav");
    evidence.events = evidence.events.filter(
      (e) =>
        !("chunkIndex" in e && e.chunkIndex === 5) &&
        !(e.type === "object_write" && e.objectKey === key5)
    );
    evidence.objects = evidence.objects.filter((o) => o.objectKey !== key5);
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/chunk 5: expected exactly 1 provider_commit, found 0/);
  });

  it("accepts a kill-interrupted attempt that a later redelivered attempt superseded", () => {
    // The demo's worker-loss scenario: attempt 1 on chunk 6 logs
    // provider_attempt, the worker is SIGKILLed before provider_commit, and
    // Temporal redelivers as attempt 2 (injected 503) then attempt 3 (commit).
    // Attempt 1 has no outcome record and that is legitimate at-least-once
    // evidence, not an inconsistency.
    const evidence = happyEvidence();
    evidence.events = evidence.events.filter(
      (e) => !("chunkIndex" in e && e.chunkIndex === INJECTED_CHUNK)
    );
    evidence.events.push(
      {
        type: "provider_attempt",
        ts: TS,
        renderKey: RENDER_KEY,
        chunkIndex: INJECTED_CHUNK,
        attempt: 1,
        provider: "demo",
        providerModel: "deterministic-v1",
      },
      {
        type: "provider_attempt",
        ts: TS,
        renderKey: RENDER_KEY,
        chunkIndex: INJECTED_CHUNK,
        attempt: 2,
        provider: "demo",
        providerModel: "deterministic-v1",
      },
      {
        type: "injected_failure",
        ts: TS,
        renderKey: RENDER_KEY,
        phase: "render_chunk",
        boundary: "before_provider_commit",
        chunkIndex: INJECTED_CHUNK,
        attempt: 2,
        message: "injected 503",
      },
      {
        type: "provider_attempt",
        ts: TS,
        renderKey: RENDER_KEY,
        chunkIndex: INJECTED_CHUNK,
        attempt: 3,
        provider: "demo",
        providerModel: "deterministic-v1",
      },
      {
        type: "provider_commit",
        ts: TS,
        renderKey: RENDER_KEY,
        chunkIndex: INJECTED_CHUNK,
        attempt: 3,
        providerRequestId: `req-${INJECTED_CHUNK}`,
        checksumSha256: chunkChecksum(INJECTED_CHUNK),
        byteCount: 1000 + INJECTED_CHUNK,
      }
      // chunk 6's object_write carries no chunkIndex, so the filter above
      // retained the original; no replacement write is needed.
    );
    const report = checkInvariants(evidence);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.chunks.find((c) => c.chunkIndex === INJECTED_CHUNK)).toEqual({
      chunkIndex: INJECTED_CHUNK,
      attempts: 3,
      commits: 1,
      injectedFailures: 1,
    });
  });

  it("flags a commit whose attempt number has no matching provider_attempt", () => {
    const evidence = happyEvidence();
    evidence.events = evidence.events.filter(
      (e) => !(e.type === "provider_attempt" && e.chunkIndex === 4)
    );
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(
      /chunk 4: outcome\(s\) on attempt\(s\) \[1\] have no matching provider_attempt/
    );
  });

  it("flags an extra attempt with no injected failure to explain it", () => {
    const evidence = happyEvidence();
    evidence.events.push({
      type: "provider_attempt",
      ts: TS,
      renderKey: RENDER_KEY,
      chunkIndex: 2,
      attempt: 2,
      provider: "demo",
      providerModel: "deterministic-v1",
    });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(
      /chunk 2: 2 provider_attempt\(s\) inconsistent with 1 commit\(s\) \+ 0 injected failure\(s\)/
    );
  });

  it("flags duplicate attempt numbers even when counts balance", () => {
    const evidence = happyEvidence();
    // Chunk 1: add attempt #1 again plus an injected failure, so counts
    // balance (2 attempts = 1 commit + 1 injected) but numbering repeats.
    evidence.events.push(
      {
        type: "provider_attempt",
        ts: TS,
        renderKey: RENDER_KEY,
        chunkIndex: 1,
        attempt: 1,
        provider: "demo",
        providerModel: "deterministic-v1",
      },
      {
        type: "injected_failure",
        ts: TS,
        renderKey: RENDER_KEY,
        phase: "render_chunk",
        boundary: "before_provider_commit",
        chunkIndex: 1,
        attempt: 1,
        message: "injected 503",
      }
    );
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/chunk 1: duplicate provider_attempt attempt numbers/);
  });

  it("carries ledger parse errors through as violations", () => {
    const evidence = happyEvidence();
    evidence.ledgerErrors = ["ledger line 12: invalid JSON (Unexpected token)"];
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations).toContain("ledger line 12: invalid JSON (Unexpected token)");
  });
});

describe("checkInvariants: object storage violations", () => {
  it("flags a recorded object missing on disk", () => {
    const evidence = happyEvidence();
    const key4 = chunkKeyFor(RENDER_KEY, 4, "wav");
    evidence.objects = evidence.objects.filter((o) => o.objectKey !== key4);
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/recorded by object_write but missing on disk/);
  });

  it("flags a checksum mismatch between ledger and disk", () => {
    const evidence = happyEvidence();
    evidence.objects = evidence.objects.map((o) =>
      o.objectKey === chunkKeyFor(RENDER_KEY, 2, "wav")
        ? { ...o, checksumSha256: sha256("bit rot") }
        : o
    );
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/on-disk checksum .* != ledger/);
  });

  it("flags an object on disk that no object_write recorded", () => {
    const evidence = happyEvidence();
    evidence.objects.push({
      objectKey: `podcast-renders/${RENDER_KEY}/chunks/099.wav`,
      checksumSha256: sha256("orphan"),
      byteCount: 12,
    });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/present on disk but no object_write recorded/);
  });

  it("flags more than one final object", () => {
    const evidence = happyEvidence();
    const extraKey = finalKeyFor(RENDER_KEY, "mp3");
    evidence.events.push({
      type: "object_write",
      ts: TS,
      renderKey: RENDER_KEY,
      objectKey: extraKey,
      checksumSha256: sha256("second final"),
      byteCount: 99,
    });
    evidence.objects.push({
      objectKey: extraKey,
      checksumSha256: sha256("second final"),
      byteCount: 99,
    });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/expected exactly 1 final object in the ledger, found 2/);
    expect(report.violations.join("\n")).toMatch(/expected exactly 1 final object on disk, found 2/);
  });

  it("flags a commit whose checksum disagrees with its chunk object_write", () => {
    const evidence = happyEvidence();
    evidence.events = evidence.events.map((e) =>
      e.type === "provider_commit" && e.chunkIndex === 0
        ? { ...e, checksumSha256: sha256("different bytes") }
        : e
    );
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/chunk 0: commit checksum .* != object_write checksum/);
  });
});

describe("checkInvariants: publication violations", () => {
  it("flags a missing publish event", () => {
    const evidence = happyEvidence();
    evidence.events = evidence.events.filter((e) => e.type !== "publish");
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations).toContain("no publish event in the ledger");
    expect(report.db.ok).toBe(null);
  });

  it("flags a published render with no domain row", () => {
    const evidence = happyEvidence();
    evidence.db = { kind: "row", row: null };
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/no domain row found for published audioId/);
    expect(report.db).toMatchObject({ checked: true, ok: false });
  });

  it("flags a domain row inconsistent with the manifest", () => {
    const evidence = happyEvidence();
    evidence.db = {
      kind: "row",
      row: { id: AUDIO_ID, audioUrl: AUDIO_URL, bytes: FINAL_BYTES + 1 },
    };
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/row bytes \d+ != final object size/);
  });

  it("flags publish events that disagree with each other", () => {
    const evidence = happyEvidence();
    evidence.events.push({
      type: "publish",
      ts: TS,
      renderKey: RENDER_KEY,
      audioId: "audio-row-2",
      audioUrl: AUDIO_URL,
      finalObjectKey: finalKeyFor(RENDER_KEY, "wav"),
      checksumSha256: FINAL_CHECKSUM,
    });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/publish events disagree/);
  });
});

describe("checkInvariants: workflow history scan", () => {
  it("flags transcript text leaked into history", () => {
    const evidence = happyEvidence();
    evidence.historyText = JSON.stringify({
      events: [{ eventId: 2, input: TRANSCRIPT }],
    });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.history.transcriptLeaks).toBeGreaterThan(0);
    expect(report.violations.join("\n")).toMatch(/history contains transcript text/);
  });

  it("flags a large base64 blob (audio bytes) in history", () => {
    const evidence = happyEvidence();
    const blob = Buffer.from("wav audio payload ".repeat(32)).toString("base64");
    expect(blob.length).toBeGreaterThan(256);
    evidence.historyText = JSON.stringify({ events: [{ eventId: 3, result: blob }] });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.history.base64Blobs).toBe(1);
    expect(report.violations.join("\n")).toMatch(/base64-like blob/);
  });

  it("does not flag hashes and object keys (below the blob threshold)", () => {
    const evidence = happyEvidence();
    evidence.historyText = JSON.stringify({
      events: [
        {
          eventId: 4,
          workflowId: `podcast-render/${RENDER_KEY}`,
          objectKey: finalKeyFor(RENDER_KEY, "wav"),
          checksum: FINAL_CHECKSUM,
        },
      ],
    });
    expect(checkInvariants(evidence).ok).toBe(true);
  });
});

describe("checkInvariants: CLI-exported history (base64 payloads)", () => {
  const b64 = (input: string | Buffer): string => Buffer.from(input).toString("base64");

  /** History shaped like `temporal workflow show --output json`: every payload's data is base64. */
  function cliExportHistory(payloadValues: unknown[]): string {
    return JSON.stringify({
      events: payloadValues.map((value, i) => ({
        eventId: String(i + 1),
        eventType: "EVENT_TYPE_ACTIVITY_TASK_SCHEDULED",
        activityTaskScheduledEventAttributes: {
          activityType: { name: "renderChunk" },
          input: {
            payloads: [{ metadata: { encoding: b64("json/plain") }, data: b64(JSON.stringify(value)) }],
          },
        },
      })),
    });
  }

  /** Compact metadata payload whose base64 encoding exceeds the blob threshold. */
  function metadataPayload(chunkIndex: number): unknown {
    return {
      renderKey: RENDER_KEY,
      transcriptRef: `transcripts/${sha256("transcript")}.txt`,
      transcriptSha256: sha256("transcript"),
      chunk: { index: chunkIndex, charStart: 0, charEnd: 3800, chunkTextHash: chunkChecksum(chunkIndex) },
      config: { provider: "demo", providerModel: "deterministic-v1", voice: "single-default", format: "wav" },
    };
  }

  it("accepts an export whose payloads are base64-encoded metadata (no false blob positives)", () => {
    const evidence = happyEvidence();
    const payloads = [0, 1, 2].map(metadataPayload);
    // The regression this guards: each encoded payload is itself a long
    // base64 run and must be decoded, not flagged.
    for (const value of payloads) {
      expect(b64(JSON.stringify(value)).length).toBeGreaterThan(256);
    }
    evidence.historyText = cliExportHistory(payloads);
    const report = checkInvariants(evidence);
    expect(report.violations).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.history).toMatchObject({ base64Blobs: 0, transcriptLeaks: 0, decodedPayloads: 3 });
  });

  it("flags transcript text hidden inside a base64-encoded payload", () => {
    const evidence = happyEvidence();
    evidence.historyText = cliExportHistory([{ renderKey: RENDER_KEY, transcript: TRANSCRIPT }]);
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.history.transcriptLeaks).toBeGreaterThan(0);
    expect(report.violations.join("\n")).toMatch(/history contains transcript text/);
  });

  it("flags a base64 audio blob nested inside a decoded payload", () => {
    const evidence = happyEvidence();
    const audio = Buffer.from("wav audio payload ".repeat(32)).toString("base64");
    evidence.historyText = cliExportHistory([{ renderKey: RENDER_KEY, bytes: audio }]);
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.history.base64Blobs).toBe(1);
    expect(report.violations.join("\n")).toMatch(/base64-like blob/);
  });

  it("flags payload data that decodes to non-UTF-8 binary (raw bytes in history)", () => {
    const evidence = happyEvidence();
    // A WAV header followed by 16-bit PCM: not valid UTF-8.
    const rawBytes = Buffer.concat([
      Buffer.from("RIFF"),
      Buffer.from([0xff, 0xfe, 0x80, 0x81, 0x92, 0xa3, 0xb4, 0xc5]),
    ]);
    evidence.historyText = JSON.stringify({
      events: [
        {
          eventId: "1",
          activityTaskCompletedEventAttributes: {
            result: { payloads: [{ metadata: { encoding: b64("binary/plain") }, data: b64(rawBytes) }] },
          },
        },
      ],
    });
    const report = checkInvariants(evidence);
    expect(report.ok).toBe(false);
    expect(report.violations.join("\n")).toMatch(/decodes to \d+ bytes of non-UTF-8 binary/);
  });
});

describe("transcriptProbes", () => {
  it("samples the start, middle, and end of a long transcript", () => {
    const probes = transcriptProbes(TRANSCRIPT);
    expect(probes.length).toBeGreaterThan(1);
    expect(probes[0]).toBe(TRANSCRIPT.slice(0, 48));
    expect(probes[probes.length - 1]).toBe(TRANSCRIPT.slice(-48));
    for (const probe of probes) {
      expect(TRANSCRIPT).toContain(probe);
    }
  });

  it("returns the whole text when shorter than one probe", () => {
    expect(transcriptProbes("tiny")).toEqual(["tiny"]);
  });
});

describe("readLedgerFile", () => {
  it("filters by renderKey and reports malformed lines with line numbers", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "ledger-"));
    try {
      const ledgerPath = path.join(dir, "ledger.jsonl");
      const good: LedgerEvent = {
        type: "provider_attempt",
        ts: TS,
        renderKey: RENDER_KEY,
        chunkIndex: 0,
        attempt: 1,
        provider: "demo",
        providerModel: "deterministic-v1",
      };
      const foreign: LedgerEvent = { ...good, renderKey: OTHER_KEY };
      await fs.writeFile(
        ledgerPath,
        [
          JSON.stringify(good),
          "{not json",
          JSON.stringify(foreign),
          JSON.stringify({ type: "mystery_event", renderKey: RENDER_KEY, ts: TS }),
          JSON.stringify({ hello: "no type" }),
          "",
        ].join("\n")
      );

      const result = await readLedgerFile(ledgerPath, RENDER_KEY);
      expect(result.events).toEqual([good]);
      expect(result.errors).toHaveLength(3);
      expect(result.errors[0]).toMatch(/^ledger line 2: invalid JSON/);
      expect(result.errors[1]).toMatch(/^ledger line 4: unknown event type "mystery_event"/);
      expect(result.errors[2]).toMatch(/^ledger line 5: not a ledger event/);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("reports a missing ledger file as an error, not an empty pass", async () => {
    const result = await readLedgerFile(path.join(os.tmpdir(), "does-not-exist.jsonl"), RENDER_KEY);
    expect(result.events).toEqual([]);
    expect(result.errors[0]).toMatch(/ledger file not found/);
  });
});

describe("render-invariants CLI", () => {
  it(
    "exits 0 on a clean run against a CLI-shaped export, with report-only stdout",
    { timeout: 60_000 },
    async () => {
      const { spawnSync } = await import("node:child_process");
      const root = path.resolve(__dirname, "../../..");
      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "invariants-cli-"));
      try {
        const storeDir = path.join(dir, "store");
        const ledgerPath = path.join(dir, "ledger.jsonl");
        const historyPath = path.join(dir, "history.json");
        const transcriptPath = path.join(dir, "transcript.txt");

        // Self-consistent two-chunk fixture: real bytes on disk, ledger
        // events computed from those bytes.
        const events: LedgerEvent[] = [];
        for (let i = 0; i < 2; i++) {
          const content = Buffer.from(`chunk audio ${i} `.repeat(64));
          const key = chunkKeyFor(RENDER_KEY, i, "wav");
          const filePath = path.join(storeDir, ...key.split("/"));
          await fs.mkdir(path.dirname(filePath), { recursive: true });
          await fs.writeFile(filePath, content);
          const checksum = createHash("sha256").update(content).digest("hex");
          events.push(
            {
              type: "provider_attempt",
              ts: TS,
              renderKey: RENDER_KEY,
              chunkIndex: i,
              attempt: 1,
              provider: "demo",
              providerModel: "deterministic-v1",
            },
            {
              type: "provider_commit",
              ts: TS,
              renderKey: RENDER_KEY,
              chunkIndex: i,
              attempt: 1,
              providerRequestId: `req-${i}`,
              checksumSha256: checksum,
              byteCount: content.length,
            },
            {
              type: "object_write",
              ts: TS,
              renderKey: RENDER_KEY,
              objectKey: key,
              checksumSha256: checksum,
              byteCount: content.length,
            }
          );
        }
        const finalContent = Buffer.from("final audio ".repeat(128));
        const finalKey = finalKeyFor(RENDER_KEY, "wav");
        const finalPath = path.join(storeDir, ...finalKey.split("/"));
        await fs.mkdir(path.dirname(finalPath), { recursive: true });
        await fs.writeFile(finalPath, finalContent);
        const finalChecksum = createHash("sha256").update(finalContent).digest("hex");
        events.push(
          {
            type: "object_write",
            ts: TS,
            renderKey: RENDER_KEY,
            objectKey: finalKey,
            checksumSha256: finalChecksum,
            byteCount: finalContent.length,
          },
          {
            type: "publish",
            ts: TS,
            renderKey: RENDER_KEY,
            audioId: RENDER_KEY,
            audioUrl: `/api/audio/${finalKey}`,
            finalObjectKey: finalKey,
            checksumSha256: finalChecksum,
          }
        );
        await fs.writeFile(ledgerPath, events.map((e) => JSON.stringify(e)).join("\n") + "\n");
        await fs.writeFile(transcriptPath, TRANSCRIPT);

        // History shaped like `temporal workflow show --output json`:
        // payload data is base64-encoded metadata, long enough that the
        // pre-fix raw scan flagged it as a blob.
        const b64 = (s: string): string => Buffer.from(s).toString("base64");
        const payload = JSON.stringify({
          renderKey: RENDER_KEY,
          finalObjectKey: finalKey,
          checksumSha256: finalChecksum,
          chunks: [0, 1].map((i) => ({ chunkIndex: i, objectKey: chunkKeyFor(RENDER_KEY, i, "wav") })),
        });
        expect(b64(payload).length).toBeGreaterThan(256);
        await fs.writeFile(
          historyPath,
          JSON.stringify({
            events: [
              {
                eventId: "1",
                eventType: "EVENT_TYPE_WORKFLOW_EXECUTION_COMPLETED",
                workflowExecutionCompletedEventAttributes: {
                  result: {
                    payloads: [{ metadata: { encoding: b64("json/plain") }, data: b64(payload) }],
                  },
                },
              },
            ],
          })
        );

        const result = spawnSync(
          path.join(root, "node_modules", ".bin", "tsx"),
          [
            path.join(root, "scripts", "render-invariants.ts"),
            RENDER_KEY,
            "--history",
            historyPath,
            "--store-dir",
            storeDir,
            "--transcript",
            transcriptPath,
            "--total-chunks",
            "2",
            "--skip-db",
          ],
          {
            cwd: root,
            encoding: "utf8",
            timeout: 55_000,
            env: { ...process.env, DEMO_LEDGER_PATH: ledgerPath },
          }
        );

        expect(result.error).toBeUndefined();
        // stdout must be the report JSON and nothing else (pipeable to jq).
        const report = JSON.parse(result.stdout) as {
          ok: boolean;
          violations: string[];
          history: { base64Blobs: number; transcriptLeaks: number; decodedPayloads: number };
        };
        expect(report.violations).toEqual([]);
        expect(report.ok).toBe(true);
        expect(report.history).toMatchObject({
          base64Blobs: 0,
          transcriptLeaks: 0,
          decodedPayloads: 1,
        });
        expect(result.status).toBe(0);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  );
});

describe("collectObjects", () => {
  it("hashes every file under the render namespace with store-relative keys", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "store-"));
    try {
      const chunkKey = chunkKeyFor(RENDER_KEY, 0, "wav");
      const finalKey = finalKeyFor(RENDER_KEY, "wav");
      for (const [key, content] of [
        [chunkKey, "chunk zero bytes"],
        [finalKey, "final bytes"],
      ] as const) {
        const filePath = path.join(dir, ...key.split("/"));
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.writeFile(filePath, content);
      }
      // A different render's namespace must not leak into this render's stats.
      const foreignPath = path.join(dir, "podcast-renders", OTHER_KEY, "final.wav");
      await fs.mkdir(path.dirname(foreignPath), { recursive: true });
      await fs.writeFile(foreignPath, "foreign");

      const stats = await collectObjects(dir, RENDER_KEY);
      expect(stats.map((s) => s.objectKey).sort()).toEqual([chunkKey, finalKey].sort());
      const chunkStat = stats.find((s) => s.objectKey === chunkKey);
      expect(chunkStat).toEqual({
        objectKey: chunkKey,
        checksumSha256: sha256("chunk zero bytes"),
        byteCount: Buffer.byteLength("chunk zero bytes"),
      });
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });

  it("returns an empty list when the namespace does not exist yet", async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), "store-empty-"));
    try {
      expect(await collectObjects(dir, RENDER_KEY)).toEqual([]);
    } finally {
      await fs.rm(dir, { recursive: true, force: true });
    }
  });
});
