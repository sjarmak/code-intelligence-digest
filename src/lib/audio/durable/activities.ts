/**
 * Temporal Activities for the durable podcast render (spec Stage 2/3).
 *
 * All IO lives here: transcript reads, provider calls, object-store writes,
 * ffmpeg stitching, and PostgreSQL publication. Every Activity returns
 * compact metadata only — never transcript text and never audio bytes — so
 * nothing bulky or sensitive crosses into Workflow history.
 *
 * Every external write is idempotent under at-least-once execution:
 * - renderChunk writes to a deterministic chunkKey and, on retry, reuses an
 *   existing object only after matching its checksum against the ledger's
 *   recorded provider_commit (the durable evidence of the crash window).
 * - stitchChunks (stitcher-v1) validates-and-reuses an existing final.
 * - publishRender converges via conditional upserts guarded by renderKey.
 *
 * Errors flagged `nonRetryable` by the stores (transcript hash mismatch,
 * chunk slice mismatch) are rethrown as non-retryable ApplicationFailures,
 * so Temporal's retry policy never retries an input error.
 *
 * Construction is a factory (`createActivities`) so the worker binds the
 * real stores while tests inject temp-dir stores and a stubbed DB boundary.
 * DB safety: the default DB deps go through src/lib/db/driver, which honors
 * USE_LOCAL_DB=true + LOCAL_DATABASE_URL; the demo worker entrypoint
 * defaults to the local database (see scripts/durable-worker.ts).
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Context } from "@temporalio/activity";
import { ApplicationFailure } from "@temporalio/common";
import { AudioFormat, RenderAudioResult, StorageAdapter } from "../types";
import { getProvider } from "../render";
import { getLocalStorage } from "../../storage/local";
import { savePodcastAudio, PodcastAudioRecord } from "../../db/podcast-audio";
import { logger } from "../../logger";
import {
  ChunkMetadata,
  ChunkPlan,
  DurableProvider,
  PlannedChunk,
  ProviderCommitEvent,
  PublishResult,
  RenderConfig,
  RenderKeyInput,
  StitchResult,
} from "./types";
import { chunkKeyFor } from "./keys";
import { CHUNKER_VERSION, planChunks } from "./chunker";
import { TranscriptStore } from "./transcriptStore";
import {
  DETERMINISTIC_MODEL,
  DeterministicTtsProvider,
} from "./providers/deterministicTts";
import { KOKORO_MODEL, KokoroTtsProvider } from "./providers/kokoroTts";
import { StitchInputError, stitchChunks as runStitcher } from "./stitcher";
import { appendLedgerEvent, readLedger } from "./ledger";
import { checkFaultGate, GateCheckOptions } from "./faultGates";
import {
  AudioRenderChunkRow,
  AudioRenderRow,
  ensureAudioRenderTables,
  markPublished,
  recordChunkManifestEntry,
  upsertRenderRow,
} from "./renderStore";

const FFPROBE_BIN = "/usr/bin/ffprobe";

/**
 * renderChunk heartbeat cadence; three beats fit inside the Workflow's
 * 15-second heartbeatTimeout, so worker loss (SIGKILL) is detected in
 * seconds instead of waiting out the 5-minute startToCloseTimeout.
 */
const HEARTBEAT_INTERVAL_MS = 5_000;

// ---------------------------------------------------------------------------
// Activity input shapes (Workflow <-> Activity boundary; metadata only)
// ---------------------------------------------------------------------------

export interface LoadAndPlanInput {
  renderKey: string;
  transcriptRef: string;
  expectedTranscriptHash: string;
  config: RenderConfig;
}

export interface RenderChunkInput {
  renderKey: string;
  transcriptRef: string;
  /** sha256 hex of the sanitized transcript; loadSlice re-verifies it. */
  transcriptSha256: string;
  chunk: PlannedChunk;
  config: RenderConfig;
}

export interface StitchChunksActivityInput {
  renderKey: string;
  format: AudioFormat;
  stitcherVersion: string;
  chunks: ChunkMetadata[];
}

export interface PublishRenderInput {
  renderKey: string;
  /** Plan pin from loadAndPlan; carried per the spec pseudocode for audit. */
  planHash: string;
  transcriptSha256: string;
  config: RenderConfig;
  chunks: ChunkMetadata[];
  assembled: StitchResult;
}

// ---------------------------------------------------------------------------
// Injectable dependencies
// ---------------------------------------------------------------------------

/** The DB boundary publishRender writes through; tests stub this object. */
export interface ActivityDb {
  ensureAudioRenderTables(): Promise<void>;
  upsertRenderRow(renderKey: string, identity: RenderKeyInput): Promise<AudioRenderRow>;
  recordChunkManifestEntry(
    renderKey: string,
    chunk: ChunkMetadata
  ): Promise<AudioRenderChunkRow>;
  markPublished(
    renderKey: string,
    expectedChecksum: string,
    objectKey: string
  ): Promise<AudioRenderRow>;
  savePodcastAudio(record: PodcastAudioRecord): Promise<void>;
}

export interface ActivityDeps {
  /** Chunk/final object store. Default: local .data/audio adapter. */
  objectStore?: StorageAdapter;
  /** Sanitized transcript store. Default: same .data/audio root. */
  transcriptStore?: TranscriptStore;
  /** Fault-gate control + ledger paths. Default: DEMO_* env / .demo files. */
  gates?: GateCheckOptions;
  db?: ActivityDb;
}

const defaultDb: ActivityDb = {
  ensureAudioRenderTables,
  upsertRenderRow,
  recordChunkManifestEntry,
  markPublished,
  savePodcastAudio,
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function contentTypeFor(format: AudioFormat): string {
  return format === "wav" ? "audio/wav" : "audio/mpeg";
}

/**
 * Rethrow store errors that carry the `nonRetryable` flag (transcript hash
 * mismatch, chunk slice mismatch) as non-retryable ApplicationFailures so
 * Temporal never retries an input error. Stitcher input-contract violations
 * get the same treatment: a version or ordering mismatch cannot heal.
 */
function toActivityFailure(error: unknown): unknown {
  if (
    error instanceof Error &&
    ((error as { nonRetryable?: boolean }).nonRetryable === true ||
      error instanceof StitchInputError)
  ) {
    return ApplicationFailure.create({
      message: error.message,
      type: error.name,
      nonRetryable: true,
    });
  }
  return error;
}

/**
 * Probe an audio buffer's duration with ffprobe (same pinned binary as the
 * stitcher). Used on the chunk-reuse path, where the original provider
 * result — and its durationMs — died with the previous worker.
 */
async function probeDurationMs(bytes: Buffer, format: AudioFormat): Promise<number> {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "durable-probe-"));
  const filePath = path.join(tmpDir, `probe.${format}`);
  try {
    fs.writeFileSync(filePath, bytes);
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(
        FFPROBE_BIN,
        ["-v", "error", "-print_format", "json", "-show_format", filePath],
        (error, out, stderr) => {
          if (error) {
            reject(new Error(`ffprobe failed on reused chunk object: ${stderr || error.message}`));
            return;
          }
          resolve(out);
        }
      );
    });
    const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
    const durationSeconds = Number(parsed.format?.duration);
    if (!Number.isFinite(durationSeconds)) {
      throw new Error(`ffprobe reported no finite duration for reused ${format} object`);
    }
    return Math.round(durationSeconds * 1000);
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

interface ProviderRenderResult {
  bytes: Buffer;
  durationMs: number;
  checksumSha256: string;
  providerRequestId: string;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createActivities(deps: ActivityDeps = {}) {
  const store = deps.objectStore ?? getLocalStorage();
  const transcripts = deps.transcriptStore ?? new TranscriptStore();
  const gates = deps.gates ?? {};
  const db = deps.db ?? defaultDb;

  /**
   * Reuse an existing chunk object only when the ledger's provider_commit
   * for this chunk matches its checksum — the durable evidence that a
   * previous attempt rendered and stored it before the worker died. The
   * duplicate object_write append is the ledgered "skip" record; no
   * provider_attempt is emitted, so the invariant checker can prove no
   * successful provider render was repeated.
   */
  async function tryReuseChunkObject(
    renderKey: string,
    chunk: PlannedChunk,
    format: AudioFormat,
    objectKey: string
  ): Promise<ChunkMetadata | null> {
    if (!(await store.exists(objectKey))) {
      return null;
    }
    const bytes = await store.getObject(objectKey);
    const checksumSha256 = sha256Hex(bytes);
    const commit = readLedger(gates.ledgerPath)
      .filter(
        (e): e is ProviderCommitEvent =>
          e.type === "provider_commit" &&
          e.renderKey === renderKey &&
          e.chunkIndex === chunk.index
      )
      .reverse()
      .find((e) => e.checksumSha256 === checksumSha256);
    if (!commit) {
      logger.warn("Existing chunk object has no matching provider_commit; re-rendering", {
        renderKey,
        chunkIndex: chunk.index,
        objectKey,
      });
      return null;
    }
    const durationMs = await probeDurationMs(bytes, format);
    appendLedgerEvent(
      {
        type: "object_write",
        ts: new Date().toISOString(),
        renderKey,
        objectKey,
        checksumSha256,
        byteCount: bytes.length,
      },
      gates.ledgerPath
    );
    logger.info("Reusing committed chunk object", { renderKey, chunkIndex: chunk.index, objectKey });
    return {
      chunkIndex: chunk.index,
      objectKey,
      checksumSha256,
      byteCount: bytes.length,
      durationMs,
      providerRequestId: commit.providerRequestId,
    };
  }

  /**
   * Render one chunk's text through the configured provider, emitting
   * provider_attempt before the call and provider_commit after the
   * before_provider_commit gate — the same event order for the demo
   * adapter (which gates internally) and real providers (gated here).
   */
  async function renderWithProvider(
    input: RenderChunkInput,
    text: string,
    attempt: number
  ): Promise<ProviderRenderResult> {
    const { renderKey, chunk, config } = input;
    if (config.provider === "demo") {
      if (config.providerModel !== DETERMINISTIC_MODEL) {
        throw ApplicationFailure.create({
          message: `demo provider only serves model ${DETERMINISTIC_MODEL}, got ${config.providerModel}`,
          type: "UnsupportedProviderModel",
          nonRetryable: true,
        });
      }
      const adapter = new DeterministicTtsProvider(gates);
      const result = await adapter.renderChunk({
        renderKey,
        chunkIndex: chunk.index,
        chunkTextHash: chunk.chunkTextHash,
        attempt,
      });
      return {
        bytes: result.bytes,
        durationMs: result.durationMs,
        checksumSha256: result.checksumSha256,
        providerRequestId: result.providerRequestId,
      };
    }

    if (config.provider === "kokoro") {
      if (config.providerModel !== KOKORO_MODEL) {
        throw ApplicationFailure.create({
          message: `kokoro provider only serves model ${KOKORO_MODEL}, got ${config.providerModel}`,
          type: "UnsupportedProviderModel",
          nonRetryable: true,
        });
      }
      if (config.format !== "wav") {
        throw ApplicationFailure.create({
          message: `kokoro provider renders wav only; identity pinned format ${config.format}`,
          type: "UnsupportedProviderFormat",
          nonRetryable: true,
        });
      }
    }

    return renderWithRealProvider(input, config.provider, text, attempt);
  }

  /**
   * Real-provider path. The TtsProvider interface exposes no provider-side
   * request id, so the idempotency handle is derived locally from the same
   * seed the spec uses — stable across attempts, per chunk.
   */
  async function renderWithRealProvider(
    input: RenderChunkInput,
    provider: Exclude<DurableProvider, "demo">,
    text: string,
    attempt: number
  ): Promise<ProviderRenderResult> {
    const { renderKey, chunk, config } = input;
    const providerRequestId = `${provider}-${createHash("sha256")
      .update(`${renderKey}${chunk.index}${chunk.chunkTextHash}`)
      .digest("hex")
      .slice(0, 32)}`;
    appendLedgerEvent(
      {
        type: "provider_attempt",
        ts: new Date().toISOString(),
        renderKey,
        chunkIndex: chunk.index,
        attempt,
        provider,
        providerModel: config.providerModel,
      },
      gates.ledgerPath
    );
    const rendered: RenderAudioResult =
      provider === "kokoro"
        ? await new KokoroTtsProvider().render({
            text,
            voice: config.voice,
            format: config.format,
          })
        : await getProvider(provider).render({
            transcript: text,
            provider,
            format: config.format,
            voice: config.voice,
          });
    await checkFaultGate(
      {
        renderKey,
        phase: "render_chunk",
        boundary: "before_provider_commit",
        chunkIndex: chunk.index,
        attempt,
      },
      gates
    );
    const checksumSha256 = sha256Hex(rendered.bytes);
    const durationMs =
      rendered.durationSeconds !== undefined
        ? Math.round(rendered.durationSeconds * 1000)
        : await probeDurationMs(rendered.bytes, config.format);
    appendLedgerEvent(
      {
        type: "provider_commit",
        ts: new Date().toISOString(),
        renderKey,
        chunkIndex: chunk.index,
        attempt,
        providerRequestId,
        checksumSha256,
        byteCount: rendered.bytes.length,
      },
      gates.ledgerPath
    );
    return { bytes: rendered.bytes, durationMs, checksumSha256, providerRequestId };
  }

  return {
    /**
     * Verify the transcript reference against the identity's digest and
     * plan its chunks under chunker-v1. Returns the plan (offsets and
     * hashes only). Hash and version mismatches are non-retryable.
     */
    async loadAndPlan(input: LoadAndPlanInput): Promise<ChunkPlan> {
      if (input.config.chunkerVersion !== CHUNKER_VERSION) {
        throw ApplicationFailure.create({
          message: `this worker plans with ${CHUNKER_VERSION}; identity pinned ${input.config.chunkerVersion}`,
          type: "ChunkerVersionMismatch",
          nonRetryable: true,
        });
      }
      let text: string;
      try {
        text = await transcripts.load(input.transcriptRef, input.expectedTranscriptHash);
      } catch (error) {
        throw toActivityFailure(error);
      }
      return planChunks(input.renderKey, text);
    },

    /**
     * Render one chunk to its deterministic chunkKey and return metadata.
     * Idempotent: a committed existing object is reused without another
     * provider call. Honors fault gates at before_provider_call,
     * before_provider_commit (in the provider path), and after_chunk_commit.
     */
    async renderChunk(input: RenderChunkInput): Promise<ChunkMetadata> {
      const ctx = Context.current();
      const attempt = ctx.info.attempt;
      const { renderKey, chunk, config } = input;
      const objectKey = chunkKeyFor(renderKey, chunk.index, config.format);

      // Heartbeat immediately, then on an interval for the whole Activity
      // (fault-gate holds included), so the server detects worker loss
      // within heartbeatTimeout rather than at startToCloseTimeout.
      ctx.heartbeat();
      const heartbeat = setInterval(() => ctx.heartbeat(), HEARTBEAT_INTERVAL_MS);
      try {
        await checkFaultGate(
          {
            renderKey,
            phase: "render_chunk",
            boundary: "before_provider_call",
            chunkIndex: chunk.index,
            attempt,
          },
          gates
        );

        const reused = await tryReuseChunkObject(renderKey, chunk, config.format, objectKey);
        if (reused !== null) {
          return reused;
        }

        let text: string;
        try {
          text = await transcripts.loadSlice(input.transcriptRef, chunk, input.transcriptSha256);
        } catch (error) {
          throw toActivityFailure(error);
        }

        const rendered = await renderWithProvider(input, text, attempt);
        await store.putObject(objectKey, rendered.bytes, contentTypeFor(config.format));
        appendLedgerEvent(
          {
            type: "object_write",
            ts: new Date().toISOString(),
            renderKey,
            objectKey,
            checksumSha256: rendered.checksumSha256,
            byteCount: rendered.bytes.length,
          },
          gates.ledgerPath
        );

        await checkFaultGate(
          {
            renderKey,
            phase: "render_chunk",
            boundary: "after_chunk_commit",
            chunkIndex: chunk.index,
            attempt,
          },
          gates
        );

        return {
          chunkIndex: chunk.index,
          objectKey,
          checksumSha256: rendered.checksumSha256,
          byteCount: rendered.bytes.length,
          durationMs: rendered.durationMs,
          providerRequestId: rendered.providerRequestId,
        };
      } finally {
        clearInterval(heartbeat);
      }
    },

    /**
     * Format-aware assembly (stitcher-v1): stream chunk objects through
     * ffmpeg to the deterministic finalKey, validate, and return metadata.
     * The after_final_put_before_result gate fires between the final put
     * and the Activity result, the spec's worker-loss-after-put window.
     */
    async stitchChunks(input: StitchChunksActivityInput): Promise<StitchResult> {
      const attempt = Context.current().info.attempt;
      let result: StitchResult;
      try {
        result = await runStitcher(
          {
            renderKey: input.renderKey,
            format: input.format,
            stitcherVersion: input.stitcherVersion,
            chunks: input.chunks,
          },
          store
        );
      } catch (error) {
        throw toActivityFailure(error);
      }
      appendLedgerEvent(
        {
          type: "object_write",
          ts: new Date().toISOString(),
          renderKey: input.renderKey,
          objectKey: result.objectKey,
          checksumSha256: result.checksumSha256,
          byteCount: result.byteCount,
        },
        gates.ledgerPath
      );
      await checkFaultGate(
        {
          renderKey: input.renderKey,
          phase: "stitch",
          boundary: "after_final_put_before_result",
          attempt,
        },
        gates
      );
      return result;
    },

    /**
     * Publish domain truth: render row + chunk manifest (audio_renders /
     * audio_render_chunks), the generated_podcast_audio row, and the
     * conditional markPublished guarded by renderKey + checksum + key.
     * Idempotent: a repeat with identical values converges on one row.
     */
    async publishRender(input: PublishRenderInput): Promise<PublishResult> {
      const attempt = Context.current().info.attempt;
      const { renderKey, config, assembled } = input;
      await checkFaultGate(
        { renderKey, phase: "publish", boundary: "before_publish", attempt },
        gates
      );

      input.chunks.forEach((chunk, i) => {
        if (chunk.chunkIndex !== i) {
          throw ApplicationFailure.create({
            message: `manifest must be contiguous from 0: position ${i} has chunkIndex ${chunk.chunkIndex}`,
            type: "ManifestOrderError",
            nonRetryable: true,
          });
        }
      });

      const identity: RenderKeyInput = {
        sanitizedTranscriptSha256: input.transcriptSha256,
        provider: config.provider,
        providerModel: config.providerModel,
        voice: config.voice,
        format: config.format,
        chunkerVersion: config.chunkerVersion,
        stitcherVersion: config.stitcherVersion,
        renderPolicyVersion: config.renderPolicyVersion,
      };

      await db.ensureAudioRenderTables();
      await db.upsertRenderRow(renderKey, identity);
      for (const chunk of input.chunks) {
        await db.recordChunkManifestEntry(renderKey, chunk);
      }

      // Domain row: keyed by renderKey (id and transcript_hash), so durable
      // renders never collide with — or overwrite — legacy transcript-hash
      // cache rows in generated_podcast_audio.
      const audioUrl = store.getUrl(assembled.objectKey);
      await db.savePodcastAudio({
        id: renderKey,
        transcriptHash: renderKey,
        provider: config.provider,
        voice: config.voice,
        format: config.format,
        durationSeconds: Math.round(assembled.durationMs / 1000),
        audioUrl,
        bytes: assembled.byteCount,
      });
      const row = await db.markPublished(renderKey, assembled.checksumSha256, assembled.objectKey);

      appendLedgerEvent(
        {
          type: "publish",
          ts: new Date().toISOString(),
          renderKey,
          audioId: renderKey,
          audioUrl,
          finalObjectKey: assembled.objectKey,
          checksumSha256: assembled.checksumSha256,
        },
        gates.ledgerPath
      );

      return {
        renderKey,
        audioId: renderKey,
        audioUrl,
        finalObjectKey: assembled.objectKey,
        checksumSha256: assembled.checksumSha256,
        byteCount: assembled.byteCount,
        durationMs: assembled.durationMs,
        publishedAt: new Date(row.updatedAt * 1000).toISOString(),
      };
    },
  };
}

/** The Activity interface the Workflow proxies (ReturnType of the factory). */
export type DurableRenderActivities = ReturnType<typeof createActivities>;
