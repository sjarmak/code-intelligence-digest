/**
 * Fault-gate protocol: faults are a contract armed by identity
 * (renderKey, phase, chunkIndex, attempt, named boundary), never a
 * timing trick.
 *
 * Components call checkFaultGate at each named boundary. The control
 * file at DEMO_FAULT_CONTROL arms gates; a missing file means nothing is
 * armed. On a match:
 *   - hold: append gate_reached to the ledger, then poll the control
 *     file and hold execution until the entry is removed (or the file
 *     deleted). The harness waits on the durable gate_reached record
 *     before killing/restarting anything.
 *   - inject_retryable_error (control-file alias: fail_503_once):
 *     append injected_failure, remove the consumed entry (one-shot, so
 *     the retry passes), then throw a retryable ApplicationFailure that
 *     Temporal's default retry policy treats as transient.
 *
 * Protocol of record: src/lib/audio/durable/CONTRACTS.md.
 */

import { readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { ApplicationFailure } from "@temporalio/common";
import { appendLedgerEvent } from "./ledger";
import {
  ArmedGate,
  FaultControlFile,
  GateBoundary,
  RenderPhase,
} from "./types";

export const DEFAULT_FAULT_CONTROL_PATH = ".demo/fault-control.json";

/** ApplicationFailure `type` used for every injected retryable error. */
export const INJECTED_RETRYABLE_ERROR_TYPE = "InjectedRetryableError";

const PHASES: readonly RenderPhase[] = ["plan", "render_chunk", "stitch", "publish"];
const BOUNDARIES: readonly GateBoundary[] = [
  "before_provider_call",
  "before_provider_commit",
  "after_chunk_commit",
  "after_final_put_before_result",
  "before_publish",
];

/** Where a component currently is; matched against armed gates. */
export interface GateCheckContext {
  renderKey: string;
  phase: RenderPhase;
  boundary: GateBoundary;
  chunkIndex?: number;
  /** Temporal Activity attempt, 1-based. */
  attempt: number;
}

export interface GateCheckOptions {
  /** Control file path: explicit > DEMO_FAULT_CONTROL > default. */
  controlPath?: string;
  /** Ledger path forwarded to appendLedgerEvent. */
  ledgerPath?: string;
  /** Hold-poll interval in ms (default 25). */
  pollIntervalMs?: number;
}

export function resolveControlPath(path?: string): string {
  return path ?? process.env.DEMO_FAULT_CONTROL ?? DEFAULT_FAULT_CONTROL_PATH;
}

/**
 * Read and validate the control file. Missing file = nothing armed.
 * The on-disk action kind "fail_503_once" is accepted as an alias and
 * normalized to inject_retryable_error with a 503 message, keeping the
 * in-memory shape exactly the typed contract.
 */
export function readControlFile(path?: string): FaultControlFile {
  const target = resolveControlPath(path);
  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { gates: [] };
    }
    throw error;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `fault control ${target}: invalid JSON (${error instanceof Error ? error.message : String(error)})`
    );
  }
  if (typeof parsed !== "object" || parsed === null || !Array.isArray((parsed as { gates?: unknown }).gates)) {
    throw new Error(`fault control ${target}: expected { "gates": [...] }`);
  }
  const gates = ((parsed as { gates: unknown[] }).gates).map((entry, i) =>
    normalizeGate(entry, target, i)
  );
  return { gates };
}

function normalizeGate(entry: unknown, path: string, index: number): ArmedGate {
  const where = `fault control ${path}: gates[${index}]`;
  if (typeof entry !== "object" || entry === null) {
    throw new Error(`${where}: not an object`);
  }
  const g = entry as Record<string, unknown>;
  if (typeof g.renderKey !== "string" || g.renderKey.length === 0) {
    throw new Error(`${where}: renderKey must be a non-empty string`);
  }
  if (!PHASES.includes(g.phase as RenderPhase)) {
    throw new Error(`${where}: unknown phase ${JSON.stringify(g.phase)}`);
  }
  if (!BOUNDARIES.includes(g.boundary as GateBoundary)) {
    throw new Error(`${where}: unknown boundary ${JSON.stringify(g.boundary)}`);
  }
  if (g.chunkIndex !== undefined && !Number.isInteger(g.chunkIndex)) {
    throw new Error(`${where}: chunkIndex must be an integer when present`);
  }
  if (g.attempt !== undefined && (!Number.isInteger(g.attempt) || (g.attempt as number) < 1)) {
    throw new Error(`${where}: attempt must be a 1-based integer when present`);
  }
  const action = g.action as Record<string, unknown> | undefined;
  if (typeof action !== "object" || action === null) {
    throw new Error(`${where}: missing action`);
  }
  const base = {
    renderKey: g.renderKey,
    phase: g.phase as RenderPhase,
    boundary: g.boundary as GateBoundary,
    ...(g.chunkIndex !== undefined ? { chunkIndex: g.chunkIndex as number } : {}),
    ...(g.attempt !== undefined ? { attempt: g.attempt as number } : {}),
  };
  switch (action.kind) {
    case "hold":
      return { ...base, action: { kind: "hold" } };
    case "inject_retryable_error": {
      if (typeof action.message !== "string" || action.message.length === 0) {
        throw new Error(`${where}: inject_retryable_error requires a message`);
      }
      return { ...base, action: { kind: "inject_retryable_error", message: action.message } };
    }
    case "fail_503_once":
      return {
        ...base,
        action: {
          kind: "inject_retryable_error",
          message: "injected 503 Service Unavailable (fail_503_once)",
        },
      };
    default:
      throw new Error(`${where}: unknown action kind ${JSON.stringify(action.kind)}`);
  }
}

/** Omitted chunkIndex/attempt on the armed gate match any value. */
export function gateMatches(gate: ArmedGate, ctx: GateCheckContext): boolean {
  return (
    gate.renderKey === ctx.renderKey &&
    gate.phase === ctx.phase &&
    gate.boundary === ctx.boundary &&
    (gate.chunkIndex === undefined || gate.chunkIndex === ctx.chunkIndex) &&
    (gate.attempt === undefined || gate.attempt === ctx.attempt)
  );
}

/** Rewrite the control file with one matched entry removed (atomic rename). */
function removeGateEntry(gates: ArmedGate[], removeIndex: number, controlPath: string): void {
  const remaining = gates.filter((_, i) => i !== removeIndex);
  if (remaining.length === 0) {
    unlinkSync(controlPath);
    return;
  }
  const tmp = `${controlPath}.tmp.${process.pid}`;
  writeFileSync(tmp, `${JSON.stringify({ gates: remaining }, null, 2)}\n`);
  renameSync(tmp, controlPath);
}

/**
 * Check the control file for an armed gate matching this boundary and
 * act on it. Returns normally when nothing (or nothing anymore) is
 * armed. Throws a retryable ApplicationFailure for injected failures.
 *
 * A hold appends gate_reached exactly once, then re-reads the control
 * file every pollIntervalMs. After a hold releases, gates are
 * re-evaluated, so a hold followed by an armed injection at the same
 * boundary fires in sequence.
 */
export async function checkFaultGate(
  ctx: GateCheckContext,
  options: GateCheckOptions = {}
): Promise<void> {
  const controlPath = resolveControlPath(options.controlPath);
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  let holdLogged = false;
  for (;;) {
    const control = readControlFile(controlPath);
    const matchIndex = control.gates.findIndex((gate) => gateMatches(gate, ctx));
    if (matchIndex === -1) {
      return;
    }
    const gate = control.gates[matchIndex];
    if (gate.action.kind === "inject_retryable_error") {
      appendLedgerEvent(
        {
          type: "injected_failure",
          ts: new Date().toISOString(),
          renderKey: ctx.renderKey,
          phase: ctx.phase,
          boundary: ctx.boundary,
          ...(ctx.chunkIndex !== undefined ? { chunkIndex: ctx.chunkIndex } : {}),
          attempt: ctx.attempt,
          message: gate.action.message,
        },
        options.ledgerPath
      );
      removeGateEntry(control.gates, matchIndex, controlPath);
      throw ApplicationFailure.create({
        message: gate.action.message,
        type: INJECTED_RETRYABLE_ERROR_TYPE,
        nonRetryable: false,
      });
    }
    if (!holdLogged) {
      appendLedgerEvent(
        {
          type: "gate_reached",
          ts: new Date().toISOString(),
          renderKey: ctx.renderKey,
          phase: ctx.phase,
          boundary: ctx.boundary,
          ...(ctx.chunkIndex !== undefined ? { chunkIndex: ctx.chunkIndex } : {}),
          attempt: ctx.attempt,
        },
        options.ledgerPath
      );
      holdLogged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
