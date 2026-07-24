/**
 * Invariant checker core for the durable podcast render.
 *
 * Consumes the demo ledger (JSONL of LedgerEvent), the on-disk object store,
 * a projection of the published domain row, and an exported Workflow history
 * JSON file, then verifies the spec's readiness assertions:
 *
 * - per chunk: exactly one provider commit, and provider attempts equal to
 *   commits plus injected failures (attempts, commits, injected failures,
 *   object writes, and publication are counted separately — never collapsed
 *   into one success count);
 * - every object_write has a matching object on disk with the recorded
 *   checksum and byte count, and no unreferenced objects exist;
 * - exactly one final object exists for the render;
 * - the domain row is published and consistent with the ledger manifest;
 * - no raw transcript text and no bulky base64 blobs (audio bytes) appear in
 *   the exported Workflow history.
 *
 * Deliberately Temporal-free: the history arrives as an exported JSON file
 * (path supplied by the caller), so the checker runs against a recording
 * with no Temporal server or SDK involved. checkInvariants is pure; the IO
 * helpers (readLedgerFile, collectObjects) gather evidence for the CLI in
 * scripts/render-invariants.ts.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import {
  InjectedFailureEvent,
  LedgerEvent,
  ObjectWriteEvent,
  ProviderAttemptEvent,
  ProviderCommitEvent,
  PublishEvent,
} from "./types";

const LEDGER_EVENT_TYPES = new Set([
  "gate_reached",
  "provider_attempt",
  "provider_commit",
  "injected_failure",
  "object_write",
  "publish",
]);

const DEFAULT_MAX_BLOB_CHARS = 256;

// ---------------------------------------------------------------------------
// Evidence and report shapes
// ---------------------------------------------------------------------------

/** One object found on disk under the render's namespace. */
export interface ObjectStat {
  /** Store-relative key with "/" separators, e.g. podcast-renders/<rk>/chunks/000.wav */
  objectKey: string;
  checksumSha256: string;
  byteCount: number;
}

/** Projection of the published generated_podcast_audio row. */
export interface PublishedRow {
  id: string;
  audioUrl: string;
  bytes: number;
}

export type DbEvidence =
  | { kind: "row"; row: PublishedRow | null }
  | { kind: "skipped" };

export interface InvariantEvidence {
  renderKey: string;
  /** All parsed ledger events; the checker filters by renderKey itself. */
  events: LedgerEvent[];
  /** Parse/read failures from the ledger; each becomes a violation. */
  ledgerErrors: string[];
  /** Objects on disk under podcast-renders/<renderKey>/. */
  objects: ObjectStat[];
  db: DbEvidence;
  /** Exported Workflow history JSON, as text. */
  historyText: string;
  /** Sanitized transcript text for leak probing; null skips the substring scan. */
  transcriptText: string | null;
  /** When set, chunk indexes must be exactly 0..totalChunks-1. */
  totalChunks?: number;
  /** Base64-blob run length treated as a leak (default 256 chars). */
  maxBlobChars?: number;
}

export interface ChunkAccounting {
  chunkIndex: number;
  attempts: number;
  commits: number;
  injectedFailures: number;
}

export interface InvariantReport {
  renderKey: string;
  ok: boolean;
  violations: string[];
  chunks: ChunkAccounting[];
  /** Distinct object keys recorded by object_write events. */
  objectWriteKeys: string[];
  /** Keys of final objects found on disk. */
  finalObjectsOnDisk: string[];
  publishEvents: number;
  db: { checked: boolean; ok: boolean | null; detail: string };
  history: {
    scannedChars: number;
    base64Blobs: number;
    transcriptLeaks: number;
    /** Payload `data` fields base64-decoded before scanning (CLI exports). */
    decodedPayloads: number;
  };
}

// ---------------------------------------------------------------------------
// Evidence gathering (IO)
// ---------------------------------------------------------------------------

export interface LedgerReadResult {
  events: LedgerEvent[];
  errors: string[];
}

/**
 * Read a JSONL ledger, keeping only events for renderKey. Malformed lines
 * and structurally invalid events are reported as errors with their line
 * number, never silently dropped.
 */
export async function readLedgerFile(
  ledgerPath: string,
  renderKey: string
): Promise<LedgerReadResult> {
  let raw: string;
  try {
    raw = await fs.readFile(ledgerPath, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return { events: [], errors: [`ledger file not found: ${ledgerPath}`] };
    }
    throw error;
  }

  const events: LedgerEvent[] = [];
  const errors: string[] = [];
  const lines = raw.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (line === "") continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch (error) {
      errors.push(
        `ledger line ${i + 1}: invalid JSON (${error instanceof Error ? error.message : String(error)})`
      );
      continue;
    }
    const shape = parsed as Partial<LedgerEvent> | null;
    if (
      shape === null ||
      typeof shape !== "object" ||
      typeof shape.type !== "string" ||
      typeof shape.renderKey !== "string" ||
      typeof shape.ts !== "string"
    ) {
      errors.push(`ledger line ${i + 1}: not a ledger event (missing type/renderKey/ts)`);
      continue;
    }
    if (!LEDGER_EVENT_TYPES.has(shape.type)) {
      errors.push(`ledger line ${i + 1}: unknown event type "${shape.type}"`);
      continue;
    }
    if (shape.renderKey === renderKey) {
      events.push(parsed as LedgerEvent);
    }
  }
  return { events, errors };
}

/**
 * Walk the render's object namespace on disk and hash every file. A missing
 * namespace directory yields an empty list (the checker then reports each
 * expected object as a violation).
 */
export async function collectObjects(
  storeDir: string,
  renderKey: string
): Promise<ObjectStat[]> {
  const namespace = path.join(storeDir, "podcast-renders", renderKey);
  const files = await walkFiles(namespace);
  const stats: ObjectStat[] = [];
  for (const filePath of files.sort()) {
    const bytes = await fs.readFile(filePath);
    stats.push({
      objectKey: path.relative(storeDir, filePath).split(path.sep).join("/"),
      checksumSha256: createHash("sha256").update(bytes).digest("hex"),
      byteCount: bytes.length,
    });
  }
  return stats;
}

async function walkFiles(dir: string): Promise<string[]> {
  let entries;
  try {
    entries = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return [];
    }
    throw error;
  }
  const files: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkFiles(full)));
    } else if (entry.isFile()) {
      files.push(full);
    }
  }
  return files;
}

// ---------------------------------------------------------------------------
// The checker (pure)
// ---------------------------------------------------------------------------

export function checkInvariants(evidence: InvariantEvidence): InvariantReport {
  const violations: string[] = [...evidence.ledgerErrors];
  const events = evidence.events.filter((e) => e.renderKey === evidence.renderKey);

  const attempts = events.filter(
    (e): e is ProviderAttemptEvent => e.type === "provider_attempt"
  );
  const commits = events.filter(
    (e): e is ProviderCommitEvent => e.type === "provider_commit"
  );
  const injected = events.filter(
    (e): e is InjectedFailureEvent =>
      e.type === "injected_failure" && e.phase === "render_chunk"
  );
  const objectWrites = events.filter(
    (e): e is ObjectWriteEvent => e.type === "object_write"
  );
  const publishes = events.filter((e): e is PublishEvent => e.type === "publish");

  const chunks = accountChunks(evidence, attempts, commits, injected, violations);
  const objectWriteKeys = checkObjectWrites(evidence, objectWrites, violations);
  const finalObjectsOnDisk = checkFinalObjects(evidence, objectWrites, commits, violations);
  const db = checkPublication(evidence, publishes, violations);
  const history = scanHistory(evidence, violations);

  return {
    renderKey: evidence.renderKey,
    ok: violations.length === 0,
    violations,
    chunks,
    objectWriteKeys,
    finalObjectsOnDisk,
    publishEvents: publishes.length,
    db,
    history,
  };
}

function accountChunks(
  evidence: InvariantEvidence,
  attempts: ProviderAttemptEvent[],
  commits: ProviderCommitEvent[],
  injected: InjectedFailureEvent[],
  violations: string[]
): ChunkAccounting[] {
  const observed = new Set<number>();
  for (const e of attempts) observed.add(e.chunkIndex);
  for (const e of commits) observed.add(e.chunkIndex);
  for (const e of injected) {
    if (e.chunkIndex !== undefined) observed.add(e.chunkIndex);
  }

  let expectedIndexes: number[];
  if (evidence.totalChunks !== undefined) {
    expectedIndexes = rangeFromZero(evidence.totalChunks);
    for (const index of observed) {
      if (index < 0 || index >= evidence.totalChunks) {
        violations.push(
          `chunk ${index}: events exist outside the expected 0..${evidence.totalChunks - 1} range`
        );
        expectedIndexes.push(index);
      }
    }
  } else if (observed.size === 0) {
    violations.push("no provider activity in the ledger for this renderKey");
    expectedIndexes = [];
  } else {
    expectedIndexes = rangeFromZero(Math.max(...observed) + 1);
  }

  const reports: ChunkAccounting[] = [];
  for (const index of expectedIndexes.sort((a, b) => a - b)) {
    const chunkAttempts = attempts.filter((e) => e.chunkIndex === index);
    const chunkCommits = commits.filter((e) => e.chunkIndex === index);
    const chunkInjected = injected.filter((e) => e.chunkIndex === index);

    if (chunkCommits.length !== 1) {
      violations.push(
        `chunk ${index}: expected exactly 1 provider_commit, found ${chunkCommits.length}`
      );
    }
    if (chunkAttempts.length !== chunkCommits.length + chunkInjected.length) {
      violations.push(
        `chunk ${index}: ${chunkAttempts.length} provider_attempt(s) inconsistent with ` +
          `${chunkCommits.length} commit(s) + ${chunkInjected.length} injected failure(s)`
      );
    }
    const attemptNumbers = chunkAttempts.map((e) => e.attempt);
    if (new Set(attemptNumbers).size !== attemptNumbers.length) {
      violations.push(
        `chunk ${index}: duplicate provider_attempt attempt numbers [${attemptNumbers.join(", ")}]`
      );
    }

    reports.push({
      chunkIndex: index,
      attempts: chunkAttempts.length,
      commits: chunkCommits.length,
      injectedFailures: chunkInjected.length,
    });
  }
  return reports;
}

/** Every object_write must have a matching on-disk object, and vice versa. */
function checkObjectWrites(
  evidence: InvariantEvidence,
  objectWrites: ObjectWriteEvent[],
  violations: string[]
): string[] {
  const onDisk = new Map(evidence.objects.map((o) => [o.objectKey, o]));

  const byKey = new Map<string, ObjectWriteEvent[]>();
  for (const write of objectWrites) {
    const existing = byKey.get(write.objectKey);
    if (existing) {
      existing.push(write);
    } else {
      byKey.set(write.objectKey, [write]);
    }
  }

  for (const [objectKey, writes] of byKey) {
    const checksums = new Set(writes.map((w) => w.checksumSha256));
    if (checksums.size > 1) {
      violations.push(
        `object ${objectKey}: object_write events disagree on checksum (${[...checksums].join(", ")})`
      );
      continue;
    }
    const write = writes[0];
    const stat = onDisk.get(objectKey);
    if (!stat) {
      violations.push(`object ${objectKey}: recorded by object_write but missing on disk`);
      continue;
    }
    if (stat.checksumSha256 !== write.checksumSha256) {
      violations.push(
        `object ${objectKey}: on-disk checksum ${stat.checksumSha256} != ledger ${write.checksumSha256}`
      );
    }
    if (stat.byteCount !== write.byteCount) {
      violations.push(
        `object ${objectKey}: on-disk size ${stat.byteCount} != ledger ${write.byteCount}`
      );
    }
  }

  for (const stat of evidence.objects) {
    if (!byKey.has(stat.objectKey)) {
      violations.push(`object ${stat.objectKey}: present on disk but no object_write recorded`);
    }
  }

  return [...byKey.keys()].sort();
}

/**
 * Exactly one final object for the render, both in the ledger and on disk,
 * and each committed chunk's checksum must match its chunk object_write.
 */
function checkFinalObjects(
  evidence: InvariantEvidence,
  objectWrites: ObjectWriteEvent[],
  commits: ProviderCommitEvent[],
  violations: string[]
): string[] {
  const finalPattern = new RegExp(`^podcast-renders/${evidence.renderKey}/final\\.[a-z0-9]+$`);
  const chunkPattern = new RegExp(
    `^podcast-renders/${evidence.renderKey}/chunks/(\\d{3})\\.[a-z0-9]+$`
  );

  const finalWriteKeys = [
    ...new Set(objectWrites.filter((w) => finalPattern.test(w.objectKey)).map((w) => w.objectKey)),
  ];
  if (finalWriteKeys.length !== 1) {
    violations.push(
      `expected exactly 1 final object in the ledger, found ${finalWriteKeys.length}` +
        (finalWriteKeys.length > 0 ? ` (${finalWriteKeys.join(", ")})` : "")
    );
  }

  const finalOnDisk = evidence.objects
    .filter((o) => finalPattern.test(o.objectKey))
    .map((o) => o.objectKey)
    .sort();
  if (finalOnDisk.length !== 1) {
    violations.push(
      `expected exactly 1 final object on disk, found ${finalOnDisk.length}` +
        (finalOnDisk.length > 0 ? ` (${finalOnDisk.join(", ")})` : "")
    );
  }

  // Chunk commit metadata must agree with the chunk's object_write.
  const chunkWritesByIndex = new Map<number, ObjectWriteEvent>();
  for (const write of objectWrites) {
    const match = chunkPattern.exec(write.objectKey);
    if (match) {
      chunkWritesByIndex.set(Number(match[1]), write);
    }
  }
  for (const commit of commits) {
    const write = chunkWritesByIndex.get(commit.chunkIndex);
    if (!write) {
      violations.push(
        `chunk ${commit.chunkIndex}: provider_commit has no matching chunk object_write`
      );
      continue;
    }
    if (write.checksumSha256 !== commit.checksumSha256) {
      violations.push(
        `chunk ${commit.chunkIndex}: commit checksum ${commit.checksumSha256} != ` +
          `object_write checksum ${write.checksumSha256}`
      );
    }
  }

  return finalOnDisk;
}

function checkPublication(
  evidence: InvariantEvidence,
  publishes: PublishEvent[],
  violations: string[]
): InvariantReport["db"] {
  if (publishes.length === 0) {
    violations.push("no publish event in the ledger");
    return {
      checked: evidence.db.kind === "row",
      ok: null,
      detail: "no publish event to verify the domain row against",
    };
  }

  const distinct = new Set(
    publishes.map((p) => `${p.audioId}|${p.audioUrl}|${p.finalObjectKey}|${p.checksumSha256}`)
  );
  if (distinct.size > 1) {
    violations.push(
      `publish events disagree (${distinct.size} distinct audioId/url/key/checksum tuples)`
    );
  }
  const publish = publishes[0];

  const finalStat = evidence.objects.find((o) => o.objectKey === publish.finalObjectKey);
  if (!finalStat) {
    violations.push(`publish references final object ${publish.finalObjectKey} which is missing on disk`);
  } else if (finalStat.checksumSha256 !== publish.checksumSha256) {
    violations.push(
      `publish checksum ${publish.checksumSha256} != final object checksum ${finalStat.checksumSha256}`
    );
  }

  if (evidence.db.kind === "skipped") {
    return { checked: false, ok: null, detail: "database check skipped" };
  }

  const row = evidence.db.row;
  if (row === null) {
    violations.push(`no domain row found for published audioId ${publish.audioId}`);
    return { checked: true, ok: false, detail: `row ${publish.audioId} missing` };
  }
  const rowViolations: string[] = [];
  if (row.id !== publish.audioId) {
    rowViolations.push(`row id ${row.id} != published audioId ${publish.audioId}`);
  }
  if (row.audioUrl !== publish.audioUrl) {
    rowViolations.push(`row audio_url ${row.audioUrl} != published ${publish.audioUrl}`);
  }
  if (finalStat && row.bytes !== finalStat.byteCount) {
    rowViolations.push(`row bytes ${row.bytes} != final object size ${finalStat.byteCount}`);
  }
  violations.push(...rowViolations.map((v) => `domain row inconsistent: ${v}`));
  return {
    checked: true,
    ok: rowViolations.length === 0,
    detail: rowViolations.length === 0 ? "domain row consistent with manifest" : rowViolations.join("; "),
  };
}

/**
 * The exported history must contain no bulky base64 runs (audio bytes) and
 * no transcript text. Hashes (64 hex chars) and object keys are far below
 * the blob threshold and pass.
 *
 * `temporal workflow show --output json` base64-encodes every payload's
 * `data` field, so the raw export legitimately contains base64 runs even
 * when the payloads carry only compact metadata. The scan therefore parses
 * the history structurally: payload data is decoded and the *decoded* text
 * is scanned (for nested base64 blobs and transcript probes), while every
 * other string is scanned as-is. Payload data that decodes to non-UTF-8
 * binary is itself a violation — raw bytes must never enter history.
 */
function scanHistory(
  evidence: InvariantEvidence,
  violations: string[]
): InvariantReport["history"] {
  const threshold = evidence.maxBlobChars ?? DEFAULT_MAX_BLOB_CHARS;
  const text = evidence.historyText;

  const segments = collectHistorySegments(text, violations);

  let base64Blobs = 0;
  const blobPattern = new RegExp(`[A-Za-z0-9+/=]{${threshold},}`, "g");
  for (const segment of segments.raw.concat(segments.decoded)) {
    let match: RegExpExecArray | null;
    blobPattern.lastIndex = 0;
    while ((match = blobPattern.exec(segment)) !== null) {
      base64Blobs++;
      violations.push(
        `history contains a ${match[0].length}-char base64-like blob ` +
          `(starts "${match[0].slice(0, 32)}...")`
      );
    }
  }

  let transcriptLeaks = 0;
  if (evidence.transcriptText !== null) {
    const corpus = [text, ...segments.decoded];
    for (const probe of transcriptProbes(evidence.transcriptText)) {
      const escaped = JSON.stringify(probe).slice(1, -1);
      if (corpus.some((c) => c.includes(probe) || c.includes(escaped))) {
        transcriptLeaks++;
        violations.push(
          `history contains transcript text (probe starting "${probe.slice(0, 24)}...")`
        );
      }
    }
  }

  return {
    scannedChars: text.length,
    base64Blobs,
    transcriptLeaks,
    decodedPayloads: segments.decodedPayloads,
  };
}

interface HistorySegments {
  /** String values scanned as-is (everything but payload data). */
  raw: string[];
  /** Base64 payload `data` fields, decoded to UTF-8 text. */
  decoded: string[];
  decodedPayloads: number;
}

/**
 * Split the history into scannable segments. When the history parses as
 * JSON, walk it and base64-decode each payload-shaped `data` field (a
 * string sibling of `metadata`, the protobuf-JSON Payload shape the CLI
 * exports); otherwise fall back to scanning the whole text raw.
 */
function collectHistorySegments(text: string, violations: string[]): HistorySegments {
  const segments: HistorySegments = { raw: [], decoded: [], decodedPayloads: 0 };
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    segments.raw.push(text);
    return segments;
  }
  if (parsed === null || typeof parsed !== "object") {
    segments.raw.push(text);
    return segments;
  }
  walkHistoryNode(parsed, "$", segments, violations);
  return segments;
}

function walkHistoryNode(
  node: unknown,
  keyPath: string,
  segments: HistorySegments,
  violations: string[]
): void {
  if (typeof node === "string") {
    segments.raw.push(node);
    return;
  }
  if (Array.isArray(node)) {
    node.forEach((item, i) => walkHistoryNode(item, `${keyPath}[${i}]`, segments, violations));
    return;
  }
  if (node === null || typeof node !== "object") {
    return;
  }
  const obj = node as Record<string, unknown>;
  for (const [key, value] of Object.entries(obj)) {
    if (key === "data" && "metadata" in obj && typeof value === "string" && isStrictBase64(value)) {
      const bytes = Buffer.from(value, "base64");
      try {
        segments.decoded.push(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
        segments.decodedPayloads++;
      } catch {
        violations.push(
          `history payload ${keyPath}.data decodes to ${bytes.length} bytes of non-UTF-8 binary ` +
            "(raw bytes must never enter Workflow history)"
        );
      }
      continue;
    }
    walkHistoryNode(value, `${keyPath}.${key}`, segments, violations);
  }
}

/** True for canonical base64 (the CLI's payload encoding): alphabet-only, padded length. */
function isStrictBase64(value: string): boolean {
  return value.length > 0 && value.length % 4 === 0 && /^[A-Za-z0-9+/]+={0,2}$/.test(value);
}

/** Up to 8 evenly spaced 48-char samples of the transcript. */
export function transcriptProbes(transcript: string, count = 8, length = 48): string[] {
  if (transcript.length === 0) {
    return [];
  }
  if (transcript.length <= length) {
    return [transcript];
  }
  const probes: string[] = [];
  const span = transcript.length - length;
  for (let i = 0; i < count; i++) {
    const start = Math.floor((span * i) / Math.max(count - 1, 1));
    const probe = transcript.slice(start, start + length);
    if (!probes.includes(probe)) {
      probes.push(probe);
    }
  }
  return probes;
}

function rangeFromZero(n: number): number[] {
  const out: number[] = [];
  for (let i = 0; i < n; i++) out.push(i);
  return out;
}
