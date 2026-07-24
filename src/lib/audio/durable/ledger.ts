/**
 * Durable demo-provider ledger: append-only JSONL at DEMO_LEDGER_PATH.
 *
 * One LedgerEvent per line, fsync after each append, so an event survives
 * a `kill -9` issued the moment it is observable. The demo harness tails
 * this file and waits for durable records (e.g. gate_reached) instead of
 * sleeping for estimated durations; the invariant checker reads it to
 * distinguish provider attempts, commits, injected failures, object
 * writes, and publication.
 *
 * Protocol of record: src/lib/audio/durable/CONTRACTS.md.
 */

import {
  closeSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  writeSync,
} from "node:fs";
import { dirname } from "node:path";
import { LedgerEvent } from "./types";

export const DEFAULT_LEDGER_PATH = ".demo/ledger.jsonl";

const LEDGER_EVENT_TYPES = [
  "gate_reached",
  "provider_attempt",
  "provider_commit",
  "injected_failure",
  "object_write",
  "publish",
] as const;

/** Resolve the ledger path: explicit arg > DEMO_LEDGER_PATH > default. */
export function resolveLedgerPath(path?: string): string {
  return path ?? process.env.DEMO_LEDGER_PATH ?? DEFAULT_LEDGER_PATH;
}

/**
 * Append one event as a JSONL line, synchronously, with fsync before
 * returning. Creates the parent directory (e.g. `.demo/`) if absent —
 * the ledger location is demo tooling state, not application data.
 */
export function appendLedgerEvent(event: LedgerEvent, path?: string): void {
  const target = resolveLedgerPath(path);
  mkdirSync(dirname(target), { recursive: true });
  const fd = openSync(target, "a");
  try {
    writeSync(fd, `${JSON.stringify(event)}\n`);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}

/**
 * Read every event in order. A missing file is an empty ledger (nothing
 * has been appended yet). A malformed or unrecognized line throws — the
 * ledger is evidence, and a reader that guesses would hide corruption.
 */
export function readLedger(path?: string): LedgerEvent[] {
  const target = resolveLedgerPath(path);
  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const lines = raw.split("\n");
  const events: LedgerEvent[] = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line === "" && i === lines.length - 1) {
      continue; // trailing newline from the last append
    }
    events.push(parseLedgerLine(line, target, i + 1));
  }
  return events;
}

function parseLedgerLine(line: string, path: string, lineNumber: number): LedgerEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (error) {
    throw new Error(
      `ledger ${path}:${lineNumber}: invalid JSON (${error instanceof Error ? error.message : String(error)})`
    );
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`ledger ${path}:${lineNumber}: line is not an object`);
  }
  const record = parsed as Record<string, unknown>;
  if (!LEDGER_EVENT_TYPES.includes(record.type as (typeof LEDGER_EVENT_TYPES)[number])) {
    throw new Error(
      `ledger ${path}:${lineNumber}: unknown event type ${JSON.stringify(record.type)}`
    );
  }
  if (typeof record.ts !== "string" || typeof record.renderKey !== "string") {
    throw new Error(`ledger ${path}:${lineNumber}: missing ts/renderKey strings`);
  }
  return record as unknown as LedgerEvent;
}

export interface WaitForLedgerEventOptions {
  path?: string;
  /** Poll interval in ms (default 25). */
  pollIntervalMs?: number;
  /** Fails with an error after this long (default 5000). */
  timeoutMs?: number;
}

/**
 * Poll the ledger until an event matching `predicate` appears, and return
 * it. This is how the harness and tests wait on durable evidence (a
 * gate_reached line) instead of sleeping for an estimated duration. The
 * timeout is a real error, never a silent give-up.
 */
export async function waitForLedgerEvent(
  predicate: (event: LedgerEvent) => boolean,
  options: WaitForLedgerEventOptions = {}
): Promise<LedgerEvent> {
  const pollIntervalMs = options.pollIntervalMs ?? 25;
  const timeoutMs = options.timeoutMs ?? 5000;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const match = readLedger(options.path).find(predicate);
    if (match) {
      return match;
    }
    if (Date.now() >= deadline) {
      throw new Error(
        `waitForLedgerEvent: no matching event in ${resolveLedgerPath(options.path)} after ${timeoutMs}ms`
      );
    }
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  }
}
