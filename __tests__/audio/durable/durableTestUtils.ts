/**
 * Shared fixtures for the durable-render Activity and Workflow tests:
 * a temp-dir object store, a deterministic two-chunk transcript, a full
 * render identity, and a recording stub for the publishRender DB boundary.
 * Nothing here touches .data/, .demo/, or any database.
 */

import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { StorageAdapter } from "../../../src/lib/audio/types";
import { computeRenderKey } from "../../../src/lib/audio/durable/keys";
import { TranscriptStore } from "../../../src/lib/audio/durable/transcriptStore";
import { ActivityDb } from "../../../src/lib/audio/durable/activities";
import {
  AudioRenderChunkRow,
  AudioRenderRow,
} from "../../../src/lib/audio/durable/renderStore";
import {
  ChunkMetadata,
  RenderConfig,
  RenderKeyInput,
} from "../../../src/lib/audio/durable/types";

export const sha256Hex = (input: Buffer | string): string =>
  createHash("sha256").update(input).digest("hex");

/** File-backed object store rooted in a temp dir; layout matches LocalStorageAdapter. */
export class TmpObjectStore implements StorageAdapter {
  constructor(private readonly root: string) {}

  private filePath(key: string): string {
    return path.join(this.root, ...key.split("/"));
  }

  async putObject(
    key: string,
    bytes: Buffer,
    _contentType?: string
  ): Promise<{ url: string; bytes: number }> {
    const filePath = this.filePath(key);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, bytes);
    return { url: this.getUrl(key), bytes: bytes.length };
  }

  async getObject(key: string): Promise<Buffer> {
    return fs.readFile(this.filePath(key));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await fs.access(this.filePath(key));
      return true;
    } catch {
      return false;
    }
  }

  getUrl(key: string): string {
    return `/api/audio/${key}`;
  }
}

/**
 * A transcript in already-sanitized form (single line, single spaces) that
 * chunker-v1 deterministically plans as exactly two chunks (< 3800 chars
 * each, sentence-boundary break).
 */
export function buildTwoChunkTranscript(label = "fixture"): string {
  const sentences: string[] = [];
  for (let i = 0; i < 100; i++) {
    sentences.push(`Sentence ${i} of the durable two chunk ${label} transcript.`);
  }
  return sentences.join(" ");
}

export function demoConfig(): RenderConfig {
  return {
    provider: "demo",
    providerModel: "deterministic-v1",
    voice: "single-default",
    format: "wav",
    chunkerVersion: "chunker-v1",
    stitcherVersion: "stitcher-v1",
    renderPolicyVersion: "render-policy-v1",
  };
}

export interface RenderFixture {
  renderKey: string;
  identity: RenderKeyInput;
  config: RenderConfig;
  transcriptRef: string;
  transcriptSha256: string;
  store: TmpObjectStore;
  transcripts: TranscriptStore;
  ledgerPath: string;
  controlPath: string;
}

/**
 * Persist `transcript` into a temp-dir transcript store and derive the full
 * render identity. `dir` is the caller's temp directory (cleaned up by the
 * caller's afterEach).
 */
export async function setupRenderFixture(
  dir: string,
  transcript: string,
  config: RenderConfig = demoConfig()
): Promise<RenderFixture> {
  const storeRoot = path.join(dir, "store");
  const transcripts = new TranscriptStore(storeRoot);
  const stored = await transcripts.put(transcript);
  const identity: RenderKeyInput = {
    sanitizedTranscriptSha256: stored.transcriptSha256,
    provider: config.provider,
    providerModel: config.providerModel,
    voice: config.voice,
    format: config.format,
    chunkerVersion: config.chunkerVersion,
    stitcherVersion: config.stitcherVersion,
    renderPolicyVersion: config.renderPolicyVersion,
  };
  return {
    renderKey: computeRenderKey(identity),
    identity,
    config,
    transcriptRef: stored.transcriptRef,
    transcriptSha256: stored.transcriptSha256,
    store: new TmpObjectStore(storeRoot),
    transcripts,
    ledgerPath: path.join(dir, "ledger.jsonl"),
    controlPath: path.join(dir, "fault-control.json"),
  };
}

export interface DbStubCalls {
  upserts: Array<{ renderKey: string; identity: RenderKeyInput }>;
  manifest: Array<{ renderKey: string; chunk: ChunkMetadata }>;
  published: Array<{ renderKey: string; checksum: string; objectKey: string }>;
  saved: Array<{ id: string; audioUrl: string; bytes: number }>;
}

/** In-memory stand-in for the publishRender DB boundary (tests only). */
export function makeDbStub(): { db: ActivityDb; calls: DbStubCalls } {
  const calls: DbStubCalls = { upserts: [], manifest: [], published: [], saved: [] };
  const nowEpoch = () => Math.floor(Date.now() / 1000);

  const renderRow = (renderKey: string, identity: RenderKeyInput): AudioRenderRow => ({
    renderKey,
    transcriptSha256: identity.sanitizedTranscriptSha256,
    provider: identity.provider,
    providerModel: identity.providerModel,
    voice: identity.voice,
    format: identity.format,
    chunkerVersion: identity.chunkerVersion,
    stitcherVersion: identity.stitcherVersion,
    renderPolicyVersion: identity.renderPolicyVersion,
    status: "in_progress",
    createdAt: nowEpoch(),
    updatedAt: nowEpoch(),
  });

  let lastIdentity: RenderKeyInput | null = null;

  const db: ActivityDb = {
    async ensureAudioRenderTables() {},
    async upsertRenderRow(renderKey, identity) {
      calls.upserts.push({ renderKey, identity });
      lastIdentity = identity;
      return renderRow(renderKey, identity);
    },
    async recordChunkManifestEntry(renderKey, chunk): Promise<AudioRenderChunkRow> {
      calls.manifest.push({ renderKey, chunk });
      return {
        renderKey,
        chunkIndex: chunk.chunkIndex,
        objectKey: chunk.objectKey,
        checksum: chunk.checksumSha256,
        byteCount: chunk.byteCount,
        durationMs: chunk.durationMs,
        providerRequestId: chunk.providerRequestId,
      };
    },
    async markPublished(renderKey, expectedChecksum, objectKey) {
      calls.published.push({ renderKey, checksum: expectedChecksum, objectKey });
      if (lastIdentity === null) {
        throw new Error(`markPublished stub: no render row for renderKey ${renderKey}`);
      }
      return {
        ...renderRow(renderKey, lastIdentity),
        status: "published",
        finalObjectKey: objectKey,
        finalChecksum: expectedChecksum,
      };
    },
    async savePodcastAudio(record) {
      calls.saved.push({ id: record.id, audioUrl: record.audioUrl, bytes: record.bytes });
    },
  };
  return { db, calls };
}
