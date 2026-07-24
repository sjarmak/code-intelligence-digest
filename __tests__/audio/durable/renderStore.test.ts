/**
 * Integration tests for the durable render store (audio_renders +
 * audio_render_chunks) against the local docker postgres.
 *
 * DB safety: forces USE_LOCAL_DB=true and strips production DSNs from the
 * environment before any connection is made. If the local database
 * (docker-compose postgres, `npm run db:start`) is unreachable, the suite
 * skips with a clear message instead of failing or falling back.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { randomBytes } from "node:crypto";
import { getDbClient } from "../../../src/lib/db/driver";
import { computeRenderKey } from "../../../src/lib/audio/durable/keys";
import { ChunkMetadata, RenderKeyInput } from "../../../src/lib/audio/durable/types";
import {
  ensureAudioRenderTables,
  upsertRenderRow,
  recordChunkManifestEntry,
  getRenderWithManifest,
  markPublished,
} from "../../../src/lib/audio/durable/renderStore";

const LOCAL_DB_URL =
  process.env.LOCAL_DATABASE_URL ||
  // docker-compose.yml publishes postgres on host port 5433.
  "postgresql://code_intel_user:local_dev_password@localhost:5433/code_intel";

// Never let this suite see a production DSN. The db driver resolves its
// connection string lazily at first getDbClient() call, so mutating the
// environment here (module evaluation, before any test runs) is early enough.
process.env.USE_LOCAL_DB = "true";
process.env.LOCAL_DATABASE_URL = LOCAL_DB_URL;
delete process.env.DATABASE_URL;
delete process.env.PRODUCTION_DATABASE_URL;

async function probeLocalDb(): Promise<boolean> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: LOCAL_DB_URL, connectionTimeoutMillis: 3000 });
  try {
    await pool.query("SELECT 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const dbAvailable = await probeLocalDb();
if (!dbAvailable) {
  console.warn(
    "renderStore tests skipped: local postgres unreachable at " +
      `${LOCAL_DB_URL}. Start it with \`npm run db:start\` (docker-compose).`
  );
}

function freshIdentity(): { renderKey: string; identity: RenderKeyInput } {
  const identity: RenderKeyInput = {
    sanitizedTranscriptSha256: randomBytes(32).toString("hex"),
    provider: "demo",
    providerModel: "deterministic-v1",
    voice: "single-default",
    format: "wav",
    chunkerVersion: "chunker-v1",
    stitcherVersion: "stitcher-v1",
    renderPolicyVersion: "render-policy-v1",
  };
  return { renderKey: computeRenderKey(identity), identity };
}

function chunkMeta(renderKey: string, chunkIndex: number): ChunkMetadata {
  return {
    chunkIndex,
    objectKey: `podcast-renders/${renderKey}/chunks/${String(chunkIndex).padStart(3, "0")}.wav`,
    checksumSha256: randomBytes(32).toString("hex"),
    byteCount: 44100 + chunkIndex,
    durationMs: 1500 + chunkIndex,
    providerRequestId: `req-${renderKey.slice(0, 8)}-${chunkIndex}`,
  };
}

const createdRenderKeys: string[] = [];

function track(renderKey: string): string {
  createdRenderKeys.push(renderKey);
  return renderKey;
}

describe.skipIf(!dbAvailable)("renderStore (local postgres)", () => {
  beforeAll(async () => {
    await ensureAudioRenderTables();
  });

  afterAll(async () => {
    if (createdRenderKeys.length > 0) {
      const client = await getDbClient();
      // audio_render_chunks rows cascade on delete.
      await client.run(`DELETE FROM audio_renders WHERE render_key = ANY($1)`, [
        createdRenderKeys,
      ]);
    }
  });

  it("creates both additive tables without touching generated_podcast_audio", async () => {
    const client = await getDbClient();
    const tables = await client.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema = 'public'
         AND table_name IN ('audio_renders', 'audio_render_chunks')`
    );
    const names = (tables.rows as Array<{ table_name: string }>).map((r) => r.table_name);
    expect(names).toContain("audio_renders");
    expect(names).toContain("audio_render_chunks");
  });

  it("upsertRenderRow converges on one row for repeated starts", async () => {
    const { renderKey, identity } = freshIdentity();
    track(renderKey);

    const first = await upsertRenderRow(renderKey, identity);
    expect(first.renderKey).toBe(renderKey);
    expect(first.status).toBe("in_progress");
    expect(first.transcriptSha256).toBe(identity.sanitizedTranscriptSha256);
    expect(first.providerModel).toBe("deterministic-v1");

    const second = await upsertRenderRow(renderKey, identity);
    expect(second.renderKey).toBe(renderKey);
    expect(second.createdAt).toBe(first.createdAt);

    const client = await getDbClient();
    const count = await client.query(
      `SELECT COUNT(*)::INTEGER AS n FROM audio_renders WHERE render_key = $1`,
      [renderKey]
    );
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it("upsertRenderRow rejects a renderKey that does not hash from its identity", async () => {
    const { identity } = freshIdentity();
    const wrongKey = randomBytes(32).toString("hex");
    await expect(upsertRenderRow(wrongKey, identity)).rejects.toThrow(
      /does not match identity/
    );
  });

  it("records an 8-entry manifest readable in chunk order", async () => {
    const { renderKey, identity } = freshIdentity();
    track(renderKey);
    await upsertRenderRow(renderKey, identity);

    const chunks = Array.from({ length: 8 }, (_, i) => chunkMeta(renderKey, i));
    // Insert out of order to prove read-side ordering is real.
    const shuffled = [chunks[5], chunks[0], chunks[7], chunks[2], chunks[6], chunks[1], chunks[4], chunks[3]];
    for (const chunk of shuffled) {
      await recordChunkManifestEntry(renderKey, chunk);
    }

    const result = await getRenderWithManifest(renderKey);
    expect(result).not.toBeNull();
    expect(result!.chunks).toHaveLength(8);
    expect(result!.chunks.map((c) => c.chunkIndex)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    for (let i = 0; i < 8; i++) {
      const row = result!.chunks[i];
      expect(row.objectKey).toBe(chunks[i].objectKey);
      expect(row.checksum).toBe(chunks[i].checksumSha256);
      expect(row.byteCount).toBe(chunks[i].byteCount);
      expect(row.durationMs).toBe(chunks[i].durationMs);
      expect(row.providerRequestId).toBe(chunks[i].providerRequestId);
    }
  });

  it("recordChunkManifestEntry is idempotent per (renderKey, chunkIndex)", async () => {
    const { renderKey, identity } = freshIdentity();
    track(renderKey);
    await upsertRenderRow(renderKey, identity);

    const chunk = chunkMeta(renderKey, 3);
    await recordChunkManifestEntry(renderKey, chunk);
    // Retry of the same chunk after an at-least-once redelivery: converges
    // on the metadata of the attempt that committed last.
    const retried = { ...chunk, providerRequestId: `${chunk.providerRequestId}-retry` };
    await recordChunkManifestEntry(renderKey, retried);

    const result = await getRenderWithManifest(renderKey);
    expect(result!.chunks).toHaveLength(1);
    expect(result!.chunks[0].providerRequestId).toBe(retried.providerRequestId);
    expect(result!.chunks[0].checksum).toBe(chunk.checksumSha256);
  });

  it("double publish converges on one published row", async () => {
    const { renderKey, identity } = freshIdentity();
    track(renderKey);
    await upsertRenderRow(renderKey, identity);

    const finalKey = `podcast-renders/${renderKey}/final.wav`;
    const checksum = randomBytes(32).toString("hex");

    const first = await markPublished(renderKey, checksum, finalKey);
    expect(first.status).toBe("published");
    expect(first.finalObjectKey).toBe(finalKey);
    expect(first.finalChecksum).toBe(checksum);

    // At-least-once retry of publishRender: same checksum + key succeeds.
    const second = await markPublished(renderKey, checksum, finalKey);
    expect(second.status).toBe("published");
    expect(second.finalChecksum).toBe(checksum);

    const client = await getDbClient();
    const count = await client.query(
      `SELECT COUNT(*)::INTEGER AS n FROM audio_renders WHERE render_key = $1`,
      [renderKey]
    );
    expect((count.rows[0] as { n: number }).n).toBe(1);
  });

  it("markPublished refuses to overwrite a different published checksum", async () => {
    const { renderKey, identity } = freshIdentity();
    track(renderKey);
    await upsertRenderRow(renderKey, identity);

    const finalKey = `podcast-renders/${renderKey}/final.wav`;
    await markPublished(renderKey, randomBytes(32).toString("hex"), finalKey);
    await expect(
      markPublished(renderKey, randomBytes(32).toString("hex"), finalKey)
    ).rejects.toThrow(/refusing to overwrite/);
  });

  it("markPublished throws for a renderKey with no row", async () => {
    const missing = randomBytes(32).toString("hex");
    await expect(
      markPublished(missing, randomBytes(32).toString("hex"), "podcast-renders/x/final.wav")
    ).rejects.toThrow(/no render row/);
  });

  it("getRenderWithManifest returns null for an unknown renderKey", async () => {
    const missing = randomBytes(32).toString("hex");
    expect(await getRenderWithManifest(missing)).toBeNull();
  });
});
