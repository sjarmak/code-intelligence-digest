/**
 * Tests for the fault-gate protocol: identity matching, hold/release via
 * the control file, one-shot retryable injection, fail_503_once alias.
 * No test sleeps for an estimated duration — holds are released on the
 * durable gate_reached record.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { existsSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ApplicationFailure } from "@temporalio/common";
import {
  checkFaultGate,
  gateMatches,
  readControlFile,
  INJECTED_RETRYABLE_ERROR_TYPE,
  GateCheckContext,
} from "../../../src/lib/audio/durable/faultGates";
import { readLedger, waitForLedgerEvent } from "../../../src/lib/audio/durable/ledger";
import { ArmedGate } from "../../../src/lib/audio/durable/types";

const RENDER_KEY = "0a591a85913c48557f5873010825325a900f0574f07d6ddaa4246070d6d16990";
const OTHER_KEY = "f".repeat(64);

describe("fault gates", () => {
  let dir: string;
  let controlPath: string;
  let ledgerPath: string;

  const arm = (gates: unknown[]) =>
    writeFileSync(controlPath, JSON.stringify({ gates }, null, 2));

  const ctx = (overrides: Partial<GateCheckContext> = {}): GateCheckContext => ({
    renderKey: RENDER_KEY,
    phase: "render_chunk",
    boundary: "before_provider_commit",
    chunkIndex: 6,
    attempt: 1,
    ...overrides,
  });

  const check = (context: GateCheckContext = ctx()) =>
    checkFaultGate(context, { controlPath, ledgerPath, pollIntervalMs: 5 });

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "durable-gates-"));
    controlPath = join(dir, "fault-control.json");
    ledgerPath = join(dir, "ledger.jsonl");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("passes silently when no control file exists", async () => {
    await check();
    expect(readLedger(ledgerPath)).toEqual([]);
  });

  it("passes when armed gates match a different identity", async () => {
    arm([
      { renderKey: OTHER_KEY, phase: "render_chunk", boundary: "before_provider_commit", action: { kind: "hold" } },
      { renderKey: RENDER_KEY, phase: "render_chunk", boundary: "before_provider_commit", chunkIndex: 3, action: { kind: "hold" } },
      { renderKey: RENDER_KEY, phase: "render_chunk", boundary: "before_provider_commit", chunkIndex: 6, attempt: 2, action: { kind: "hold" } },
    ]);
    await check(); // chunkIndex 6, attempt 1: none match
    expect(readLedger(ledgerPath)).toEqual([]);
  });

  it("matches wildcards when chunkIndex/attempt are omitted", () => {
    const gate: ArmedGate = {
      renderKey: RENDER_KEY,
      phase: "render_chunk",
      boundary: "before_provider_commit",
      action: { kind: "hold" },
    };
    expect(gateMatches(gate, ctx({ chunkIndex: 0 }))).toBe(true);
    expect(gateMatches(gate, ctx({ chunkIndex: 7, attempt: 4 }))).toBe(true);
    expect(gateMatches(gate, ctx({ boundary: "before_provider_call" }))).toBe(false);
  });

  it("injects a retryable failure exactly once, consuming the armed entry", async () => {
    arm([
      {
        renderKey: RENDER_KEY,
        phase: "render_chunk",
        boundary: "before_provider_commit",
        chunkIndex: 6,
        action: { kind: "inject_retryable_error", message: "provider returned 503" },
      },
    ]);

    let thrown: unknown;
    try {
      await check(ctx({ attempt: 2 }));
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    const failure = thrown as ApplicationFailure;
    expect(failure.type).toBe(INJECTED_RETRYABLE_ERROR_TYPE);
    expect(failure.nonRetryable).toBe(false);
    expect(failure.message).toBe("provider returned 503");

    // Consumed: the retry passes and no second failure is recorded.
    await check(ctx({ attempt: 3 }));

    const events = readLedger(ledgerPath);
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({
      type: "injected_failure",
      renderKey: RENDER_KEY,
      phase: "render_chunk",
      boundary: "before_provider_commit",
      chunkIndex: 6,
      attempt: 2,
      message: "provider returned 503",
    });
  });

  it("removes only the consumed entry and deletes an emptied control file", async () => {
    arm([
      { renderKey: RENDER_KEY, phase: "render_chunk", boundary: "before_provider_commit", chunkIndex: 6, action: { kind: "fail_503_once" } },
      { renderKey: RENDER_KEY, phase: "stitch", boundary: "after_final_put_before_result", action: { kind: "hold" } },
    ]);
    await expect(check()).rejects.toThrow(/503/);
    const remaining = readControlFile(controlPath);
    expect(remaining.gates).toHaveLength(1);
    expect(remaining.gates[0].phase).toBe("stitch");

    arm([
      { renderKey: RENDER_KEY, phase: "render_chunk", boundary: "before_provider_commit", action: { kind: "fail_503_once" } },
    ]);
    await expect(check()).rejects.toThrow(/503/);
    expect(existsSync(controlPath)).toBe(false);
  });

  it("normalizes fail_503_once to a one-shot retryable 503", async () => {
    arm([
      { renderKey: RENDER_KEY, phase: "render_chunk", boundary: "before_provider_commit", chunkIndex: 6, attempt: 1, action: { kind: "fail_503_once" } },
    ]);
    let thrown: unknown;
    try {
      await check();
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    expect((thrown as ApplicationFailure).nonRetryable).toBe(false);
    expect((thrown as ApplicationFailure).message).toMatch(/503 Service Unavailable/);

    // Second pass: consumed, nothing armed, no extra ledger events.
    await check();
    expect(readLedger(ledgerPath).filter((e) => e.type === "injected_failure")).toHaveLength(1);
  });

  it("holds at the gate until the entry is released, recording gate_reached once", async () => {
    arm([
      { renderKey: RENDER_KEY, phase: "render_chunk", boundary: "before_provider_commit", chunkIndex: 6, attempt: 1, action: { kind: "hold" } },
    ]);

    let released = false;
    const holding = check().then(() => {
      released = true;
    });

    // Durable evidence the hold engaged — the harness's own wait condition.
    const reached = await waitForLedgerEvent(
      (e) => e.type === "gate_reached" && e.boundary === "before_provider_commit",
      { path: ledgerPath, pollIntervalMs: 5, timeoutMs: 2000 }
    );
    expect(reached).toMatchObject({
      renderKey: RENDER_KEY,
      phase: "render_chunk",
      chunkIndex: 6,
      attempt: 1,
    });
    await new Promise((resolve) => setImmediate(resolve));
    expect(released).toBe(false);

    unlinkSync(controlPath); // release
    await holding;
    expect(released).toBe(true);
    expect(readLedger(ledgerPath).filter((e) => e.type === "gate_reached")).toHaveLength(1);
  });

  it("rejects a malformed control file instead of ignoring it", () => {
    writeFileSync(controlPath, JSON.stringify({ gates: [{ renderKey: RENDER_KEY, phase: "render_chunk", boundary: "nowhere", action: { kind: "hold" } }] }));
    expect(() => readControlFile(controlPath)).toThrow(/unknown boundary "nowhere"/);

    writeFileSync(controlPath, "{broken");
    expect(() => readControlFile(controlPath)).toThrow(/invalid JSON/);

    writeFileSync(controlPath, JSON.stringify({ gates: [{ renderKey: RENDER_KEY, phase: "render_chunk", boundary: "before_provider_commit", action: { kind: "explode" } }] }));
    expect(() => readControlFile(controlPath)).toThrow(/unknown action kind "explode"/);
  });
});
