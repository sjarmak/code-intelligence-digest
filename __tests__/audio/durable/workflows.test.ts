/**
 * Workflow-level tests for renderPodcast against a real local Temporal dev
 * server (TestWorkflowEnvironment.createLocal): the sequential happy path
 * with the deterministic adapter, the progress query observed mid-render at
 * a durable hold gate, replay determinism of the recorded history, the
 * no-transcript-in-history invariant, and the injected 503 producing
 * exactly one extra attempt on the failed chunk.
 *
 * The environment prefers a `temporal` CLI already on PATH (existing-path
 * executable); otherwise the SDK downloads one. If no server can be
 * started, the suite skips with a clear message. No test touches a
 * database — the publishRender DB boundary is the test stub — and all
 * storage lives in per-test temp dirs.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import type { WorkflowBundle } from "@temporalio/worker";
import { createActivities } from "../../../src/lib/audio/durable/activities";
import { workflowIdFor } from "../../../src/lib/audio/durable/keys";
import { readLedger, waitForLedgerEvent } from "../../../src/lib/audio/durable/ledger";
import * as workflows from "../../../src/lib/audio/durable/workflows";
import type { RenderProgress } from "../../../src/lib/audio/durable/workflows";
import {
  RENDER_PODCAST_WORKFLOW_TYPE,
  RENDER_POLICY_VERSION as STARTER_RENDER_POLICY_VERSION,
} from "../../../src/lib/audio/durable/temporalClient";
import {
  ProviderAttemptEvent,
  PublishResult,
  RenderInput,
} from "../../../src/lib/audio/durable/types";
import {
  DbStubCalls,
  RenderFixture,
  buildTwoChunkTranscript,
  makeDbStub,
  setupRenderFixture,
} from "./durableTestUtils";

const WORKFLOWS_PATH = fileURLToPath(
  new URL("../../../src/lib/audio/durable/workflows.ts", import.meta.url)
);

function temporalCliOnPath(): string | null {
  const result = spawnSync("which", ["temporal"], { encoding: "utf8" });
  const found = result.status === 0 ? result.stdout.trim() : "";
  return found.length > 0 ? found : null;
}

let testEnv: TestWorkflowEnvironment | null = null;
let workflowBundle: WorkflowBundle | null = null;

beforeAll(async () => {
  try {
    const cli = temporalCliOnPath();
    testEnv = await TestWorkflowEnvironment.createLocal(
      cli ? { server: { executable: { type: "existing-path", path: cli } } } : undefined
    );
    workflowBundle = await bundleWorkflowCode({ workflowsPath: WORKFLOWS_PATH });
  } catch (error) {
    console.warn(
      "workflow tests skipped: could not start a local Temporal test server:",
      error instanceof Error ? error.message : error
    );
    testEnv = null;
  }
}, 180_000);

afterAll(async () => {
  await testEnv?.teardown();
});

describe("renderPodcast workflow", () => {
  let dir: string;
  let fixture: RenderFixture;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "durable-workflow-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function makeWorker(taskQueue: string, dbCalls?: { calls: DbStubCalls }) {
    if (!testEnv || !workflowBundle) throw new Error("test env not started");
    const stub = makeDbStub();
    if (dbCalls) dbCalls.calls = stub.calls;
    const worker = await Worker.create({
      connection: testEnv.nativeConnection,
      namespace: testEnv.namespace ?? "default",
      taskQueue,
      workflowBundle,
      activities: createActivities({
        objectStore: fixture.store,
        transcriptStore: fixture.transcripts,
        gates: {
          controlPath: fixture.controlPath,
          ledgerPath: fixture.ledgerPath,
          pollIntervalMs: 10,
        },
        db: stub.db,
      }),
    });
    return worker;
  }

  function renderInput(): RenderInput {
    return {
      renderKey: fixture.renderKey,
      transcriptRef: fixture.transcriptRef,
      transcriptSha256: fixture.transcriptSha256,
      config: fixture.config,
    };
  }

  it(
    "renders sequentially, answers the progress query, replays deterministically, and keeps transcript text out of history",
    async (ctx) => {
      if (!testEnv) return ctx.skip();
      const transcript = buildTwoChunkTranscript("happy path");
      fixture = await setupRenderFixture(dir, transcript);
      const dbCalls = { calls: undefined as unknown as DbStubCalls };
      const worker = await makeWorker("podcast-render-test-happy", dbCalls);

      // Hold at chunk 1 so the progress query can observe mid-render state
      // on durable evidence (gate_reached), never a timing guess.
      await fs.writeFile(
        fixture.controlPath,
        JSON.stringify({
          gates: [
            {
              renderKey: fixture.renderKey,
              phase: "render_chunk",
              boundary: "before_provider_call",
              chunkIndex: 1,
              action: { kind: "hold" },
            },
          ],
        })
      );

      const { result, midProgress, finalProgress, history } = await worker.runUntil(
        async () => {
          const handle = await testEnv!.client.workflow.start("renderPodcast", {
            taskQueue: "podcast-render-test-happy",
            workflowId: workflowIdFor(fixture.renderKey),
            args: [renderInput()],
          });

          await waitForLedgerEvent(
            (e) => e.type === "gate_reached" && e.chunkIndex === 1,
            { path: fixture.ledgerPath, pollIntervalMs: 10, timeoutMs: 30_000 }
          );
          const midProgress = await handle.query<RenderProgress>("progress");
          await fs.rm(fixture.controlPath); // release the hold

          const result = (await handle.result()) as PublishResult;
          const finalProgress = await handle.query<RenderProgress>("progress");
          const history = await handle.fetchHistory();
          return { result, midProgress, finalProgress, history };
        }
      );

      expect(midProgress).toEqual({
        completedChunks: 1,
        totalChunks: 2,
        attempt: 1,
        phaseName: "rendering",
      });
      expect(finalProgress).toEqual({
        completedChunks: 2,
        totalChunks: 2,
        attempt: 1,
        phaseName: "completed",
      });

      expect(result.renderKey).toBe(fixture.renderKey);
      expect(result.finalObjectKey).toBe(
        `podcast-renders/${fixture.renderKey}/final.wav`
      );
      expect(await fixture.store.exists(result.finalObjectKey)).toBe(true);
      expect(dbCalls.calls.published).toHaveLength(1);
      expect(dbCalls.calls.manifest.map((m) => m.chunk.chunkIndex)).toEqual([0, 1]);

      const events = readLedger(fixture.ledgerPath);
      expect(events.filter((e) => e.type === "provider_attempt")).toHaveLength(2);
      expect(events.filter((e) => e.type === "provider_commit")).toHaveLength(2);
      expect(events.filter((e) => e.type === "publish")).toHaveLength(1);

      // Readiness gate: no raw transcript text in exported Workflow history.
      const historyJson = JSON.stringify(history);
      expect(historyJson).not.toContain(transcript.slice(120, 180));
      expect(historyJson).toContain(fixture.renderKey);

      // Replay determinism: the recorded history must replay cleanly
      // against the same Workflow bundle.
      await Worker.runReplayHistory({ workflowBundle: workflowBundle! }, history);
    },
    120_000
  );

  it(
    "retries only the injected-503 chunk, with exactly one extra attempt",
    async (ctx) => {
      if (!testEnv) return ctx.skip();
      fixture = await setupRenderFixture(dir, buildTwoChunkTranscript("injected 503"));
      const worker = await makeWorker("podcast-render-test-503");

      await fs.writeFile(
        fixture.controlPath,
        JSON.stringify({
          gates: [
            {
              renderKey: fixture.renderKey,
              phase: "render_chunk",
              boundary: "before_provider_commit",
              chunkIndex: 1,
              attempt: 1,
              action: { kind: "fail_503_once" },
            },
          ],
        })
      );

      const result = await worker.runUntil(
        testEnv.client.workflow.execute("renderPodcast", {
          taskQueue: "podcast-render-test-503",
          workflowId: workflowIdFor(fixture.renderKey),
          args: [renderInput()],
        })
      );
      expect((result as PublishResult).renderKey).toBe(fixture.renderKey);

      const events = readLedger(fixture.ledgerPath);
      const attempts = (chunkIndex: number) =>
        events.filter(
          (e): e is ProviderAttemptEvent =>
            e.type === "provider_attempt" && e.chunkIndex === chunkIndex
        );
      const commits = (chunkIndex: number) =>
        events.filter((e) => e.type === "provider_commit" && e.chunkIndex === chunkIndex);

      // Chunk 0 rendered once; chunk 1 carries exactly one extra attempt,
      // one injected failure, and still exactly one commit.
      expect(attempts(0)).toHaveLength(1);
      expect(commits(0)).toHaveLength(1);
      expect(attempts(1)).toHaveLength(2);
      expect(attempts(1).map((e) => e.attempt)).toEqual([1, 2]);
      expect(commits(1)).toHaveLength(1);
      expect(
        events.filter((e) => e.type === "injected_failure" && e.chunkIndex === 1)
      ).toHaveLength(1);
    },
    120_000
  );
});

describe("cross-module contract pins", () => {
  it("keeps the workflow-side and starter-side render policy versions identical", () => {
    // The Workflow sandbox cannot import temporalClient.ts (grpc), so the
    // constant exists twice; this is the drift guard.
    expect(workflows.RENDER_POLICY_VERSION).toBe(STARTER_RENDER_POLICY_VERSION);
  });

  it("exports the workflow function under the type name the starter uses", () => {
    expect(RENDER_PODCAST_WORKFLOW_TYPE).toBe("renderPodcast");
    expect(workflows[RENDER_PODCAST_WORKFLOW_TYPE]).toBeTypeOf("function");
  });
});
