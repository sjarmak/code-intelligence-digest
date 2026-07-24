/**
 * Activity-level tests for the durable render path, run under
 * MockActivityEnvironment (real Activity Context, no Temporal server):
 * the end-to-end 2-chunk pipeline with the deterministic adapter,
 * chunk-object reuse without repeated provider calls, one-shot 503
 * injection with correct ledger accounting, and the non-retryable input
 * errors. publishRender is also exercised against local docker postgres
 * when it is reachable; everywhere else the DB boundary is a test stub.
 *
 * DB safety: forces USE_LOCAL_DB=true and strips production DSNs at module
 * evaluation, before any connection can be made.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockActivityEnvironment } from "@temporalio/testing";
import { ApplicationFailure } from "@temporalio/common";
import { createActivities } from "../../../src/lib/audio/durable/activities";
import { chunkKeyFor, finalKeyFor } from "../../../src/lib/audio/durable/keys";
import { readLedger } from "../../../src/lib/audio/durable/ledger";
import { INJECTED_RETRYABLE_ERROR_TYPE } from "../../../src/lib/audio/durable/faultGates";
import { ChunkMetadata, ChunkPlan } from "../../../src/lib/audio/durable/types";
import {
  RenderFixture,
  buildTwoChunkTranscript,
  makeDbStub,
  setupRenderFixture,
  sha256Hex,
} from "./durableTestUtils";

const LOCAL_DB_URL =
  process.env.LOCAL_DATABASE_URL ||
  // docker-compose.yml publishes postgres on host port 5433.
  "postgresql://code_intel_user:local_dev_password@localhost:5433/code_intel";

// Never let this suite see a production DSN (same guard as renderStore.test).
process.env.USE_LOCAL_DB = "true";
process.env.LOCAL_DATABASE_URL = LOCAL_DB_URL;
delete process.env.DATABASE_URL;
delete process.env.PRODUCTION_DATABASE_URL;

async function probePublishDb(): Promise<boolean> {
  const { Pool } = await import("pg");
  const pool = new Pool({ connectionString: LOCAL_DB_URL, connectionTimeoutMillis: 3000 });
  try {
    const result = await pool.query("SELECT to_regclass('generated_podcast_audio') AS t");
    return (result.rows[0] as { t: string | null }).t !== null;
  } catch {
    return false;
  } finally {
    await pool.end();
  }
}

const publishDbAvailable = await probePublishDb();
if (!publishDbAvailable) {
  console.warn(
    "publishRender real-DB test skipped: local postgres (or generated_podcast_audio) " +
      `unavailable at ${LOCAL_DB_URL}. Start it with \`npm run db:start\`.`
  );
}

describe("durable render activities", () => {
  let dir: string;
  let fixture: RenderFixture;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "durable-activities-"));
    fixture = await setupRenderFixture(dir, buildTwoChunkTranscript());
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function acts(db = makeDbStub().db) {
    return createActivities({
      objectStore: fixture.store,
      transcriptStore: fixture.transcripts,
      gates: {
        controlPath: fixture.controlPath,
        ledgerPath: fixture.ledgerPath,
        pollIntervalMs: 5,
      },
      db,
    });
  }

  /** Run one Activity under a real Activity Context with the given attempt. */
  async function runAct<I, R>(
    fn: (input: I) => Promise<R>,
    input: I,
    attempt = 1
  ): Promise<R> {
    const env = new MockActivityEnvironment({ attempt });
    return (await env.run(fn, input)) as R;
  }

  async function planFixture(activities = acts()): Promise<ChunkPlan> {
    return runAct(activities.loadAndPlan, {
      renderKey: fixture.renderKey,
      transcriptRef: fixture.transcriptRef,
      expectedTranscriptHash: fixture.transcriptSha256,
      config: fixture.config,
    });
  }

  async function renderChunkAt(
    activities: ReturnType<typeof acts>,
    plan: ChunkPlan,
    index: number,
    attempt = 1
  ): Promise<ChunkMetadata> {
    return runAct(
      activities.renderChunk,
      {
        renderKey: fixture.renderKey,
        transcriptRef: fixture.transcriptRef,
        transcriptSha256: fixture.transcriptSha256,
        chunk: plan.chunks[index],
        config: fixture.config,
      },
      attempt
    );
  }

  it("plans, renders, stitches, and publishes a two-chunk transcript end to end", async () => {
    const { db, calls } = makeDbStub();
    const activities = acts(db);

    const plan = await planFixture(activities);
    expect(plan.renderKey).toBe(fixture.renderKey);
    expect(plan.totalChunks).toBe(2);
    expect(plan.chunks.map((c) => c.charEnd - c.charStart).every((n) => n <= 3800)).toBe(true);

    const chunks: ChunkMetadata[] = [];
    for (const planned of plan.chunks) {
      chunks.push(await renderChunkAt(activities, plan, planned.index));
    }
    for (const chunk of chunks) {
      const key = chunkKeyFor(fixture.renderKey, chunk.chunkIndex, "wav");
      expect(chunk.objectKey).toBe(key);
      const bytes = await fixture.store.getObject(key);
      expect(sha256Hex(bytes)).toBe(chunk.checksumSha256);
      expect(chunk.byteCount).toBe(bytes.length);
      expect(chunk.durationMs).toBeGreaterThan(0);
    }

    const assembled = await runAct(activities.stitchChunks, {
      renderKey: fixture.renderKey,
      format: fixture.config.format,
      stitcherVersion: fixture.config.stitcherVersion,
      chunks,
    });
    expect(assembled.objectKey).toBe(finalKeyFor(fixture.renderKey, "wav"));
    expect(await fixture.store.exists(assembled.objectKey)).toBe(true);

    const published = await runAct(activities.publishRender, {
      renderKey: fixture.renderKey,
      planHash: plan.planHash,
      transcriptSha256: fixture.transcriptSha256,
      config: fixture.config,
      chunks,
      assembled,
    });
    expect(published).toMatchObject({
      renderKey: fixture.renderKey,
      audioId: fixture.renderKey,
      finalObjectKey: assembled.objectKey,
      checksumSha256: assembled.checksumSha256,
      byteCount: assembled.byteCount,
      durationMs: assembled.durationMs,
    });
    expect(published.audioUrl).toBe(`/api/audio/${assembled.objectKey}`);

    expect(calls.upserts).toEqual([
      { renderKey: fixture.renderKey, identity: fixture.identity },
    ]);
    expect(calls.manifest.map((m) => m.chunk.chunkIndex)).toEqual([0, 1]);
    expect(calls.published).toEqual([
      {
        renderKey: fixture.renderKey,
        checksum: assembled.checksumSha256,
        objectKey: assembled.objectKey,
      },
    ]);
    expect(calls.saved).toEqual([
      { id: fixture.renderKey, audioUrl: published.audioUrl, bytes: assembled.byteCount },
    ]);

    const events = readLedger(fixture.ledgerPath);
    expect(events.filter((e) => e.type === "provider_attempt")).toHaveLength(2);
    expect(events.filter((e) => e.type === "provider_commit")).toHaveLength(2);
    expect(events.filter((e) => e.type === "object_write")).toHaveLength(3); // 2 chunks + final
    expect(events.filter((e) => e.type === "publish")).toHaveLength(1);
  });

  it("renderChunk heartbeats so worker loss is detected within heartbeatTimeout", async () => {
    const activities = acts();
    const plan = await planFixture(activities);

    const env = new MockActivityEnvironment({ attempt: 1 });
    let heartbeats = 0;
    env.on("heartbeat", () => {
      heartbeats += 1;
    });
    await env.run(activities.renderChunk, {
      renderKey: fixture.renderKey,
      transcriptRef: fixture.transcriptRef,
      transcriptSha256: fixture.transcriptSha256,
      chunk: plan.chunks[0],
      config: fixture.config,
    });
    // The immediate heartbeat at Activity start; the 5s interval keeps it
    // alive through fault-gate holds on the live path.
    expect(heartbeats).toBeGreaterThanOrEqual(1);
  });

  it("reuses a committed chunk object without repeating the provider render", async () => {
    const activities = acts();
    const plan = await planFixture(activities);

    const first = await renderChunkAt(activities, plan, 0);
    const second = await renderChunkAt(activities, plan, 0, 2); // redelivery after worker loss

    expect(second).toEqual(first);

    const events = readLedger(fixture.ledgerPath);
    expect(events.filter((e) => e.type === "provider_attempt")).toHaveLength(1);
    expect(events.filter((e) => e.type === "provider_commit")).toHaveLength(1);
    // The duplicate, checksum-consistent object_write is the ledgered skip.
    const writes = events.filter((e) => e.type === "object_write");
    expect(writes).toHaveLength(2);
    expect(new Set(writes.map((w) => w.checksumSha256)).size).toBe(1);
  });

  it("re-renders when an existing chunk object has no matching provider_commit", async () => {
    const activities = acts();
    const plan = await planFixture(activities);
    const objectKey = chunkKeyFor(fixture.renderKey, 0, "wav");
    await fixture.store.putObject(objectKey, Buffer.from("not audio, no commit"));

    const rendered = await renderChunkAt(activities, plan, 0);

    const bytes = await fixture.store.getObject(objectKey);
    expect(sha256Hex(bytes)).toBe(rendered.checksumSha256);
    expect(readLedger(fixture.ledgerPath).filter((e) => e.type === "provider_commit")).toHaveLength(1);
  });

  it("fails once on an injected 503 and succeeds on the retry with exactly one extra attempt", async () => {
    const activities = acts();
    const plan = await planFixture(activities);
    await fs.writeFile(
      fixture.controlPath,
      JSON.stringify({
        gates: [
          {
            renderKey: fixture.renderKey,
            phase: "render_chunk",
            boundary: "before_provider_commit",
            chunkIndex: 1,
            action: { kind: "fail_503_once" },
          },
        ],
      })
    );

    let thrown: unknown;
    try {
      await renderChunkAt(activities, plan, 1, 1);
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    expect((thrown as ApplicationFailure).type).toBe(INJECTED_RETRYABLE_ERROR_TYPE);
    expect((thrown as ApplicationFailure).nonRetryable).toBe(false);

    const retried = await renderChunkAt(activities, plan, 1, 2);
    expect(retried.chunkIndex).toBe(1);

    const events = readLedger(fixture.ledgerPath);
    const forChunk = (type: string, chunkIndex: number) =>
      events.filter(
        (e) => e.type === type && "chunkIndex" in e && e.chunkIndex === chunkIndex
      );
    expect(forChunk("provider_attempt", 1)).toHaveLength(2);
    expect(forChunk("provider_commit", 1)).toHaveLength(1);
    expect(forChunk("injected_failure", 1)).toHaveLength(1);
  });

  it("rejects a transcript hash mismatch as non-retryable before any provider call", async () => {
    const activities = acts();
    let thrown: unknown;
    try {
      await runAct(activities.loadAndPlan, {
        renderKey: fixture.renderKey,
        transcriptRef: fixture.transcriptRef,
        expectedTranscriptHash: "0".repeat(64),
        config: fixture.config,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    expect((thrown as ApplicationFailure).type).toBe("TranscriptHashMismatchError");
    expect((thrown as ApplicationFailure).nonRetryable).toBe(true);
    expect(readLedger(fixture.ledgerPath)).toEqual([]);
  });

  it("rejects a chunker version mismatch as non-retryable", async () => {
    const activities = acts();
    let thrown: unknown;
    try {
      await runAct(activities.loadAndPlan, {
        renderKey: fixture.renderKey,
        transcriptRef: fixture.transcriptRef,
        expectedTranscriptHash: fixture.transcriptSha256,
        config: { ...fixture.config, chunkerVersion: "chunker-v0" },
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    expect((thrown as ApplicationFailure).type).toBe("ChunkerVersionMismatch");
    expect((thrown as ApplicationFailure).nonRetryable).toBe(true);
  });

  it("rejects a chunk whose slice hash disagrees with the plan as non-retryable", async () => {
    const activities = acts();
    const plan = await planFixture(activities);
    const tampered = { ...plan.chunks[0], chunkTextHash: "f".repeat(64) };

    let thrown: unknown;
    try {
      await runAct(activities.renderChunk, {
        renderKey: fixture.renderKey,
        transcriptRef: fixture.transcriptRef,
        transcriptSha256: fixture.transcriptSha256,
        chunk: tampered,
        config: fixture.config,
      });
    } catch (error) {
      thrown = error;
    }
    expect(thrown).toBeInstanceOf(ApplicationFailure);
    expect((thrown as ApplicationFailure).type).toBe("ChunkSliceMismatchError");
    expect((thrown as ApplicationFailure).nonRetryable).toBe(true);
  });

  describe.skipIf(!publishDbAvailable)("publishRender against local postgres", () => {
    it("publishes idempotently through the real render store", async () => {
      // Real DB boundary: factory defaults for db, temp dirs for storage.
      const real = createActivities({
        objectStore: fixture.store,
        transcriptStore: fixture.transcripts,
        gates: { controlPath: fixture.controlPath, ledgerPath: fixture.ledgerPath },
      });
      const plan = await runAct(real.loadAndPlan, {
        renderKey: fixture.renderKey,
        transcriptRef: fixture.transcriptRef,
        expectedTranscriptHash: fixture.transcriptSha256,
        config: fixture.config,
      });
      const chunks: ChunkMetadata[] = [];
      for (const planned of plan.chunks) {
        chunks.push(
          (await runAct(real.renderChunk, {
            renderKey: fixture.renderKey,
            transcriptRef: fixture.transcriptRef,
            transcriptSha256: fixture.transcriptSha256,
            chunk: planned,
            config: fixture.config,
          })) as ChunkMetadata
        );
      }
      const assembled = await runAct(real.stitchChunks, {
        renderKey: fixture.renderKey,
        format: fixture.config.format,
        stitcherVersion: fixture.config.stitcherVersion,
        chunks,
      });

      const input = {
        renderKey: fixture.renderKey,
        planHash: plan.planHash,
        transcriptSha256: fixture.transcriptSha256,
        config: fixture.config,
        chunks,
        assembled,
      };
      const first = await runAct(real.publishRender, input);
      const again = await runAct(real.publishRender, input); // at-least-once redelivery
      expect(again.renderKey).toBe(first.renderKey);
      expect(again.checksumSha256).toBe(first.checksumSha256);
      expect(again.finalObjectKey).toBe(first.finalObjectKey);

      const { getRenderWithManifest } = await import(
        "../../../src/lib/audio/durable/renderStore"
      );
      const stored = await getRenderWithManifest(fixture.renderKey);
      expect(stored).not.toBeNull();
      expect(stored?.render.status).toBe("published");
      expect(stored?.render.finalChecksum).toBe(assembled.checksumSha256);
      expect(stored?.chunks.map((c) => c.chunkIndex)).toEqual([0, 1]);

      const { getPodcastAudioById } = await import("../../../src/lib/db/podcast-audio");
      const domainRow = await getPodcastAudioById(fixture.renderKey);
      expect(domainRow?.audioUrl).toBe(first.audioUrl);
      expect(domainRow?.bytes).toBe(assembled.byteCount);

      // Cleanup: the fixture renderKey is deterministic, so remove the rows
      // this test created rather than accreting them across runs.
      const { getDbClient } = await import("../../../src/lib/db/driver");
      const client = await getDbClient();
      await client.run(`DELETE FROM audio_renders WHERE render_key = $1`, [fixture.renderKey]);
      await client.run(`DELETE FROM generated_podcast_audio WHERE id = $1`, [fixture.renderKey]);
    });
  });
});
