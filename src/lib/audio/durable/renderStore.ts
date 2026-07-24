/**
 * Additive Postgres records for durable renders (spec Stage 1): the render
 * row keyed by renderKey with its individual identity fields, and the
 * per-chunk manifest. This is the audit/cleanup surface — PostgreSQL stays
 * the source of domain truth, Temporal owns execution checkpoints.
 *
 * Fulfills the `db-manifest` responsibility in CONTRACTS.md. Does not touch
 * generated_podcast_audio; publishRender writes that row separately.
 *
 * DB safety: connections go through src/lib/db/driver, which honors
 * USE_LOCAL_DB=true + LOCAL_DATABASE_URL. Demo/test tooling must set those;
 * production DSNs are never a default on the durable path.
 */

import { getDbClient, DatabaseClient } from "../../db/driver";
import { ChunkMetadata, RenderKeyInput } from "./types";
import { computeRenderKey } from "./keys";

/**
 * Lifecycle of the domain render row. "in_progress" from first upsert until
 * markPublished flips it to "published". Temporal — not this table — tracks
 * per-chunk execution state.
 */
export type AudioRenderStatus = "in_progress" | "published";

export interface AudioRenderRow {
  renderKey: string;
  transcriptSha256: string;
  provider: string;
  providerModel: string;
  voice: string;
  format: string;
  chunkerVersion: string;
  stitcherVersion: string;
  renderPolicyVersion: string;
  status: AudioRenderStatus;
  finalObjectKey?: string;
  finalChecksum?: string;
  createdAt: number;
  updatedAt: number;
}

export interface AudioRenderChunkRow {
  renderKey: string;
  chunkIndex: number;
  objectKey: string;
  checksum: string;
  byteCount: number;
  durationMs: number;
  providerRequestId: string;
}

export interface RenderWithManifest {
  render: AudioRenderRow;
  /** Manifest entries ordered by ascending chunkIndex. */
  chunks: AudioRenderChunkRow[];
}

interface AudioRenderDbRow {
  render_key: string;
  transcript_sha256: string;
  provider: string;
  provider_model: string;
  voice: string;
  format: string;
  chunker_version: string;
  stitcher_version: string;
  render_policy_version: string;
  status: string;
  final_object_key: string | null;
  final_checksum: string | null;
  created_at: number;
  updated_at: number;
}

interface AudioRenderChunkDbRow {
  render_key: string;
  chunk_index: number;
  object_key: string;
  checksum: string;
  byte_count: number;
  duration_ms: number;
  provider_request_id: string;
}

/**
 * Create the additive durable-render tables if absent. Idempotent; follows
 * the module-owned-tables convention (see initializeAnnotationTables /
 * initializeADSTables). generated_podcast_audio is not modified.
 */
export async function ensureAudioRenderTables(client?: DatabaseClient): Promise<void> {
  const db = client ?? (await getDbClient());
  await db.exec(`
    CREATE TABLE IF NOT EXISTS audio_renders (
      render_key TEXT PRIMARY KEY,
      transcript_sha256 TEXT NOT NULL,
      provider TEXT NOT NULL,
      provider_model TEXT NOT NULL,
      voice TEXT NOT NULL,
      format TEXT NOT NULL,
      chunker_version TEXT NOT NULL,
      stitcher_version TEXT NOT NULL,
      render_policy_version TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('in_progress', 'published')),
      final_object_key TEXT,
      final_checksum TEXT,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      updated_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER
    );

    CREATE TABLE IF NOT EXISTS audio_render_chunks (
      render_key TEXT NOT NULL REFERENCES audio_renders(render_key) ON DELETE CASCADE,
      chunk_index INTEGER NOT NULL,
      object_key TEXT NOT NULL,
      checksum TEXT NOT NULL,
      byte_count INTEGER NOT NULL,
      duration_ms INTEGER NOT NULL,
      provider_request_id TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT EXTRACT(EPOCH FROM NOW())::INTEGER,
      PRIMARY KEY (render_key, chunk_index)
    );

    CREATE INDEX IF NOT EXISTS idx_audio_renders_status ON audio_renders(status);
  `);
}

/**
 * Insert-or-converge the render row for one identity. Guarded by renderKey:
 * the key is recomputed from the identity fields and must match, and a
 * conflicting row must carry the same identity (renderKey is a hash of it,
 * so a mismatch means data corruption, not a race). Repeated calls for the
 * same identity converge on one row — only updated_at moves.
 */
export async function upsertRenderRow(
  renderKey: string,
  identity: RenderKeyInput
): Promise<AudioRenderRow> {
  const expectedKey = computeRenderKey(identity);
  if (renderKey !== expectedKey) {
    throw new Error(
      `upsertRenderRow: renderKey ${renderKey} does not match identity (computed ${expectedKey})`
    );
  }

  const client = await getDbClient();
  const result = await client.query(
    `
    INSERT INTO audio_renders (
      render_key, transcript_sha256, provider, provider_model, voice, format,
      chunker_version, stitcher_version, render_policy_version, status
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'in_progress')
    ON CONFLICT (render_key) DO UPDATE SET
      updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
    WHERE audio_renders.transcript_sha256 = EXCLUDED.transcript_sha256
      AND audio_renders.provider = EXCLUDED.provider
      AND audio_renders.provider_model = EXCLUDED.provider_model
      AND audio_renders.voice = EXCLUDED.voice
      AND audio_renders.format = EXCLUDED.format
      AND audio_renders.chunker_version = EXCLUDED.chunker_version
      AND audio_renders.stitcher_version = EXCLUDED.stitcher_version
      AND audio_renders.render_policy_version = EXCLUDED.render_policy_version
    RETURNING *
    `,
    [
      renderKey,
      identity.sanitizedTranscriptSha256,
      identity.provider,
      identity.providerModel,
      identity.voice,
      identity.format,
      identity.chunkerVersion,
      identity.stitcherVersion,
      identity.renderPolicyVersion,
    ]
  );

  const row = result.rows[0] as unknown as AudioRenderDbRow | undefined;
  if (!row) {
    // The DO UPDATE guard rejected the conflict: a row exists under this
    // renderKey with different identity fields. Impossible unless stored
    // data was corrupted or the hash algorithm changed underneath it.
    throw new Error(
      `upsertRenderRow: existing row for renderKey ${renderKey} has conflicting identity fields`
    );
  }
  return toRenderRow(row);
}

/**
 * Record (or converge) one chunk manifest entry. Idempotent under
 * at-least-once Activity retries: a re-render of the same chunk overwrites
 * the entry with the metadata of the attempt that committed last, keyed by
 * (render_key, chunk_index).
 */
export async function recordChunkManifestEntry(
  renderKey: string,
  chunk: ChunkMetadata
): Promise<AudioRenderChunkRow> {
  const client = await getDbClient();
  const result = await client.query(
    `
    INSERT INTO audio_render_chunks (
      render_key, chunk_index, object_key, checksum, byte_count, duration_ms, provider_request_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (render_key, chunk_index) DO UPDATE SET
      object_key = EXCLUDED.object_key,
      checksum = EXCLUDED.checksum,
      byte_count = EXCLUDED.byte_count,
      duration_ms = EXCLUDED.duration_ms,
      provider_request_id = EXCLUDED.provider_request_id
    RETURNING *
    `,
    [
      renderKey,
      chunk.chunkIndex,
      chunk.objectKey,
      chunk.checksumSha256,
      chunk.byteCount,
      chunk.durationMs,
      chunk.providerRequestId,
    ]
  );
  const row = result.rows[0] as unknown as AudioRenderChunkDbRow;
  return toChunkRow(row);
}

/** Fetch the render row plus its manifest ordered by chunk index. */
export async function getRenderWithManifest(
  renderKey: string
): Promise<RenderWithManifest | null> {
  const client = await getDbClient();
  const renderResult = await client.query(
    `SELECT * FROM audio_renders WHERE render_key = $1`,
    [renderKey]
  );
  const renderRow = renderResult.rows[0] as unknown as AudioRenderDbRow | undefined;
  if (!renderRow) return null;

  const chunkResult = await client.query(
    `SELECT * FROM audio_render_chunks WHERE render_key = $1 ORDER BY chunk_index ASC`,
    [renderKey]
  );
  const chunkRows = chunkResult.rows as unknown as AudioRenderChunkDbRow[];

  return {
    render: toRenderRow(renderRow),
    chunks: chunkRows.map(toChunkRow),
  };
}

/**
 * Publish semantics per spec: the update is guarded by renderKey, expected
 * final checksum, and object key, so repeated publication converges on one
 * row. A second publish with the same checksum/key succeeds idempotently;
 * a publish that disagrees with an already-published checksum or object key
 * throws instead of silently overwriting domain truth.
 */
export async function markPublished(
  renderKey: string,
  expectedChecksum: string,
  objectKey: string
): Promise<AudioRenderRow> {
  const client = await getDbClient();
  const result = await client.query(
    `
    UPDATE audio_renders SET
      status = 'published',
      final_object_key = $2,
      final_checksum = $3,
      updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
    WHERE render_key = $1
      AND (final_checksum IS NULL OR final_checksum = $3)
      AND (final_object_key IS NULL OR final_object_key = $2)
    RETURNING *
    `,
    [renderKey, objectKey, expectedChecksum]
  );

  const row = result.rows[0] as unknown as AudioRenderDbRow | undefined;
  if (row) return toRenderRow(row);

  const existing = await client.query(
    `SELECT final_checksum, final_object_key FROM audio_renders WHERE render_key = $1`,
    [renderKey]
  );
  const current = existing.rows[0] as
    | { final_checksum: string | null; final_object_key: string | null }
    | undefined;
  if (!current) {
    throw new Error(`markPublished: no render row for renderKey ${renderKey}`);
  }
  throw new Error(
    `markPublished: renderKey ${renderKey} already published with ` +
      `checksum ${current.final_checksum} at ${current.final_object_key}; ` +
      `refusing to overwrite with checksum ${expectedChecksum} at ${objectKey}`
  );
}

function toRenderRow(row: AudioRenderDbRow): AudioRenderRow {
  if (row.status !== "in_progress" && row.status !== "published") {
    throw new Error(
      `audio_renders row ${row.render_key} has unknown status "${row.status}"`
    );
  }
  return {
    renderKey: row.render_key,
    transcriptSha256: row.transcript_sha256,
    provider: row.provider,
    providerModel: row.provider_model,
    voice: row.voice,
    format: row.format,
    chunkerVersion: row.chunker_version,
    stitcherVersion: row.stitcher_version,
    renderPolicyVersion: row.render_policy_version,
    status: row.status,
    finalObjectKey: row.final_object_key ?? undefined,
    finalChecksum: row.final_checksum ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toChunkRow(row: AudioRenderChunkDbRow): AudioRenderChunkRow {
  return {
    renderKey: row.render_key,
    chunkIndex: row.chunk_index,
    objectKey: row.object_key,
    checksum: row.checksum,
    byteCount: row.byte_count,
    durationMs: row.duration_ms,
    providerRequestId: row.provider_request_id,
  };
}
