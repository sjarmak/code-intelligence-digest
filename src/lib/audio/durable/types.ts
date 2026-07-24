/**
 * Shared contracts for the durable (Temporal-backed) podcast audio render.
 *
 * Everything that crosses a process boundary — Workflow input, Activity
 * results, ledger events, fault gates, and the async API — is typed here.
 * Invariant: no raw transcript text and no audio bytes appear in any of
 * these shapes. Activities exchange references, hashes, and compact
 * metadata only, so nothing bulky or sensitive enters Workflow history.
 *
 * See src/lib/audio/durable/CONTRACTS.md for module responsibilities and
 * the fault-gate file protocol.
 */

import { AudioFormat, AudioProvider } from "../types";

/**
 * Providers usable by the durable path. "demo" is the deterministic
 * rehearsal adapter (`deterministic-v1`): byte-for-byte stable output,
 * no network, no provider cost.
 */
export type DurableProvider = AudioProvider | "demo";

/**
 * Every input that can change rendered bytes or chunk boundaries.
 * Versions are pinned so a rerender is always an intentional new identity:
 * - chunkerVersion covers sanitization + boundary selection
 * - stitcherVersion covers the format-aware assembly command + encoding
 * - renderPolicyVersion covers timeout/retry semantics that can affect
 *   the accepted artifact
 */
export interface RenderConfig {
  provider: DurableProvider;
  /** A concrete model name (e.g. "deterministic-v1"), never a moving alias. */
  providerModel: string;
  voice: string;
  format: AudioFormat;
  chunkerVersion: string;
  stitcherVersion: string;
  renderPolicyVersion: string;
}

/**
 * Canonical input to computeRenderKey. Field set is exactly the spec's
 * identity tuple; canonicalJson sorts keys, so declaration order here is
 * documentation only.
 */
export interface RenderKeyInput {
  /** sha256 hex of the sanitized transcript's UTF-8 bytes. */
  sanitizedTranscriptSha256: string;
  provider: DurableProvider;
  providerModel: string;
  voice: string;
  format: AudioFormat;
  chunkerVersion: string;
  stitcherVersion: string;
  renderPolicyVersion: string;
}

/**
 * One planned chunk. Offsets address the sanitized transcript; the raw
 * text itself never leaves application storage. All ranges are half-open
 * [start, end). chunkIndex is 0-based everywhere in code and object keys
 * (chunk "seven" in demo narration is index 6).
 */
export interface PlannedChunk {
  /** 0-based position in the render sequence. */
  index: number;
  /** Character offsets into the sanitized transcript, [start, end). */
  charStart: number;
  charEnd: number;
  /** UTF-8 byte offsets into the sanitized transcript, [start, end). */
  byteStart: number;
  byteEnd: number;
  /** sha256 hex of the chunk's exact text slice. */
  chunkTextHash: string;
}

/** Deterministic plan produced by the loadAndPlan Activity. */
export interface ChunkPlan {
  renderKey: string;
  chunkerVersion: string;
  /** sha256 hex of canonicalJson(chunks); pins the plan across replays. */
  planHash: string;
  totalChunks: number;
  chunks: PlannedChunk[];
}

/**
 * Result of one renderChunk Activity: metadata only, bytes live at
 * objectKey (= chunkKeyFor(renderKey, chunkIndex, format)).
 */
export interface ChunkMetadata {
  chunkIndex: number;
  objectKey: string;
  /** sha256 hex of the stored chunk object's bytes. */
  checksumSha256: string;
  byteCount: number;
  durationMs: number;
  /** Provider-assigned request id; reconciliation handle for at-least-once ambiguity. */
  providerRequestId: string;
}

/**
 * Result of the format-aware stitch Activity. objectKey is
 * finalKeyFor(renderKey, format). Assembly is never Buffer.concat.
 */
export interface StitchResult {
  objectKey: string;
  checksumSha256: string;
  byteCount: number;
  durationMs: number;
}

/** Result of the publishRender Activity; also the Workflow's return value. */
export interface PublishResult {
  renderKey: string;
  /** id of the published domain row (generated_podcast_audio lineage). */
  audioId: string;
  audioUrl: string;
  finalObjectKey: string;
  checksumSha256: string;
  byteCount: number;
  durationMs: number;
  /** ISO 8601 timestamp of the publish upsert. */
  publishedAt: string;
}

/** Alias matching the spec's `RenderResult` name for the Workflow return. */
export type RenderResult = PublishResult;

/**
 * Workflow input. transcriptRef is an immutable application-store object
 * key for the sanitized transcript; the Workflow never sees the text.
 */
export interface RenderInput {
  renderKey: string;
  /** Application-store object key of the persisted sanitized transcript. */
  transcriptRef: string;
  /** sha256 hex of the sanitized transcript; loadAndPlan verifies it. */
  transcriptSha256: string;
  config: RenderConfig;
}

// ---------------------------------------------------------------------------
// Async API contract: POST /api/podcast/audio-renders and
// GET /api/podcast/audio-renders/{renderId}
// ---------------------------------------------------------------------------

export type RenderJobStatus =
  | "queued"
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

/** POST body. The server sanitizes, hashes, and derives the renderKey. */
export interface StartAudioRenderRequest {
  transcript: string;
  provider: DurableProvider;
  providerModel: string;
  voice: string;
  format: AudioFormat;
}

/**
 * 202 Accepted body (new Workflow started, Location header set).
 * A duplicate start for an existing renderKey returns 200 with the
 * current AudioRenderStatusResponse instead of creating another Workflow.
 */
export interface StartAudioRenderAccepted {
  /** renderId === renderKey. */
  renderId: string;
  status: RenderJobStatus;
  statusUrl: string;
}

interface AudioRenderStatusBase {
  renderId: string;
  status: RenderJobStatus;
}

export interface AudioRenderQueued extends AudioRenderStatusBase {
  status: "queued";
}

export interface AudioRenderRunning extends AudioRenderStatusBase {
  status: "running";
  completedChunks: number;
  totalChunks: number;
  /** Current Activity attempt (Temporal numbering, 1-based). */
  attempt: number;
}

export interface AudioRenderCompleted extends AudioRenderStatusBase {
  status: "completed";
  result: PublishResult;
}

export interface AudioRenderFailed extends AudioRenderStatusBase {
  status: "failed";
  error: string;
}

export interface AudioRenderCancelled extends AudioRenderStatusBase {
  status: "cancelled";
}

/** GET response body, discriminated on `status`. */
export type AudioRenderStatusResponse =
  | AudioRenderQueued
  | AudioRenderRunning
  | AudioRenderCompleted
  | AudioRenderFailed
  | AudioRenderCancelled;

/** Body for 400 (invalid input), 404, 422 (unsupported scope), 503 (Temporal start path unavailable). */
export interface AudioRenderErrorResponse {
  error: string;
}

// ---------------------------------------------------------------------------
// Fault gates and the durable demo ledger
// ---------------------------------------------------------------------------

/** Phase of the render pipeline a gate or event belongs to. */
export type RenderPhase = "plan" | "render_chunk" | "stitch" | "publish";

/**
 * Named boundaries where components check for armed gates and emit
 * gate_reached events. Names come from the spec's fault matrix.
 */
export type GateBoundary =
  | "before_provider_call"
  | "before_provider_commit"
  | "after_chunk_commit"
  | "after_final_put_before_result"
  | "before_publish";

/**
 * Identity of one fault gate. A gate is armed by render identity, phase,
 * chunk index, attempt, and named boundary — never by timing. Omitted
 * chunkIndex/attempt match any value. attempt uses Temporal's 1-based
 * numbering.
 */
export interface FaultGateSpec {
  renderKey: string;
  phase: RenderPhase;
  boundary: GateBoundary;
  chunkIndex?: number;
  attempt?: number;
}

/** What a matched gate does. */
export type GateAction =
  | { kind: "hold" }
  | { kind: "inject_retryable_error"; message: string };

/** One entry in the fault-control file. */
export interface ArmedGate extends FaultGateSpec {
  action: GateAction;
}

/** Shape of the JSON control file at DEMO_FAULT_CONTROL. */
export interface FaultControlFile {
  gates: ArmedGate[];
}

interface LedgerEventBase {
  /** ISO 8601 timestamp. */
  ts: string;
  renderKey: string;
}

/** A component arrived at a named boundary with a matching armed gate. */
export interface GateReachedEvent extends LedgerEventBase {
  type: "gate_reached";
  phase: RenderPhase;
  boundary: GateBoundary;
  chunkIndex?: number;
  attempt: number;
}

/** The adapter is about to call (or simulate) the provider. */
export interface ProviderAttemptEvent extends LedgerEventBase {
  type: "provider_attempt";
  chunkIndex: number;
  attempt: number;
  provider: DurableProvider;
  providerModel: string;
}

/** The provider produced output the adapter accepted and committed. */
export interface ProviderCommitEvent extends LedgerEventBase {
  type: "provider_commit";
  chunkIndex: number;
  attempt: number;
  providerRequestId: string;
  checksumSha256: string;
  byteCount: number;
}

/** A gate injected a failure instead of letting the boundary pass. */
export interface InjectedFailureEvent extends LedgerEventBase {
  type: "injected_failure";
  phase: RenderPhase;
  boundary: GateBoundary;
  chunkIndex?: number;
  attempt: number;
  message: string;
}

/** An object (chunk or final) was written to object storage. */
export interface ObjectWriteEvent extends LedgerEventBase {
  type: "object_write";
  objectKey: string;
  checksumSha256: string;
  byteCount: number;
}

/** The domain row was published (conditional upsert on renderKey). */
export interface PublishEvent extends LedgerEventBase {
  type: "publish";
  audioId: string;
  audioUrl: string;
  finalObjectKey: string;
  checksumSha256: string;
}

/**
 * One JSONL line in the demo ledger (DEMO_LEDGER_PATH). The invariant
 * checker distinguishes provider attempts, provider commits, object
 * writes, and publication — they are never collapsed into one count.
 */
export type LedgerEvent =
  | GateReachedEvent
  | ProviderAttemptEvent
  | ProviderCommitEvent
  | InjectedFailureEvent
  | ObjectWriteEvent
  | PublishEvent;
