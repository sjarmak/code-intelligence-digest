/**
 * Tests for the durable demo ledger: append-only JSONL, fsync per line,
 * strict read side.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  appendLedgerEvent,
  readLedger,
  resolveLedgerPath,
  waitForLedgerEvent,
  DEFAULT_LEDGER_PATH,
} from "../../../src/lib/audio/durable/ledger";
import { LedgerEvent, ProviderAttemptEvent } from "../../../src/lib/audio/durable/types";

const RENDER_KEY = "0a591a85913c48557f5873010825325a900f0574f07d6ddaa4246070d6d16990";

function attemptEvent(chunkIndex: number, attempt: number): ProviderAttemptEvent {
  return {
    type: "provider_attempt",
    ts: "2026-07-23T00:00:00.000Z",
    renderKey: RENDER_KEY,
    chunkIndex,
    attempt,
    provider: "demo",
    providerModel: "deterministic-v1",
  };
}

describe("ledger", () => {
  let dir: string;
  let ledgerPath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "durable-ledger-"));
    ledgerPath = join(dir, "nested", "ledger.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("resolves explicit path over env over default", () => {
    expect(resolveLedgerPath("/x/l.jsonl")).toBe("/x/l.jsonl");
    process.env.DEMO_LEDGER_PATH = "/env/l.jsonl";
    try {
      expect(resolveLedgerPath()).toBe("/env/l.jsonl");
    } finally {
      delete process.env.DEMO_LEDGER_PATH;
    }
    expect(resolveLedgerPath()).toBe(DEFAULT_LEDGER_PATH);
  });

  it("round-trips events in append order, creating parent directories", () => {
    const events: LedgerEvent[] = [
      attemptEvent(0, 1),
      {
        type: "provider_commit",
        ts: "2026-07-23T00:00:01.000Z",
        renderKey: RENDER_KEY,
        chunkIndex: 0,
        attempt: 1,
        providerRequestId: "demo-abc",
        checksumSha256: "c".repeat(64),
        byteCount: 352844,
      },
      {
        type: "object_write",
        ts: "2026-07-23T00:00:02.000Z",
        renderKey: RENDER_KEY,
        objectKey: `podcast-renders/${RENDER_KEY}/chunks/000.wav`,
        checksumSha256: "c".repeat(64),
        byteCount: 352844,
      },
    ];
    for (const event of events) {
      appendLedgerEvent(event, ledgerPath);
    }
    expect(readLedger(ledgerPath)).toEqual(events);
  });

  it("writes exactly one JSONL line per append", () => {
    appendLedgerEvent(attemptEvent(0, 1), ledgerPath);
    appendLedgerEvent(attemptEvent(1, 1), ledgerPath);
    const raw = readFileSync(ledgerPath, "utf8");
    expect(raw.endsWith("\n")).toBe(true);
    expect(raw.trimEnd().split("\n")).toHaveLength(2);
  });

  it("reads a missing ledger as empty", () => {
    expect(existsSync(ledgerPath)).toBe(false);
    expect(readLedger(ledgerPath)).toEqual([]);
  });

  it("throws with line number on malformed JSON", () => {
    appendLedgerEvent(attemptEvent(0, 1), ledgerPath);
    writeFileSync(ledgerPath, `${readFileSync(ledgerPath, "utf8")}{not json\n`);
    expect(() => readLedger(ledgerPath)).toThrow(/:2: invalid JSON/);
  });

  it("throws on an unknown event type instead of guessing", () => {
    const badPath = join(dir, "bad.jsonl");
    writeFileSync(
      badPath,
      `${JSON.stringify({ type: "mystery", ts: "t", renderKey: RENDER_KEY })}\n`
    );
    expect(() => readLedger(badPath)).toThrow(/:1: unknown event type "mystery"/);
  });

  it("waitForLedgerEvent resolves on an event appended after waiting starts", async () => {
    const waiting = waitForLedgerEvent(
      (e) => e.type === "provider_attempt" && e.chunkIndex === 6,
      { path: ledgerPath, pollIntervalMs: 5, timeoutMs: 2000 }
    );
    appendLedgerEvent(attemptEvent(6, 2), ledgerPath);
    const found = await waiting;
    expect(found).toEqual(attemptEvent(6, 2));
  });

  it("waitForLedgerEvent fails loudly on timeout", async () => {
    await expect(
      waitForLedgerEvent((e) => e.type === "publish", {
        path: ledgerPath,
        pollIntervalMs: 5,
        timeoutMs: 30,
      })
    ).rejects.toThrow(/no matching event .* after 30ms/);
  });
});
