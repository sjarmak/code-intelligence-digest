/**
 * Worker-loss redelivery test: the demo's step-5 kill, executed for real.
 *
 * A worker runs in a CHILD PROCESS (workerLossEntry.ts) so the test can
 * SIGKILL it while renderChunk holds at the before_provider_commit gate —
 * exactly the live sequence's "kill -9 the Temporal worker" moment. The
 * server must detect the dead worker via the 15s heartbeatTimeout (not the
 * 5-minute startToCloseTimeout) and redeliver the chunk to a replacement
 * worker started in-process, well inside the demo's ~30s budget.
 *
 * Evidence asserted:
 *  - the workflow completes on the replacement worker;
 *  - the killed chunk carries provider attempts 1 and 2 with exactly one
 *    commit, and the other chunk never reruns;
 *  - history's ActivityTaskStarted for attempt 2 records the previous
 *    attempt's failure as a HEARTBEAT timeout;
 *  - redelivery latency (kill -> attempt-2 provider_attempt) stays far
 *    below startToCloseTimeout.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from "vitest";
import { ChildProcess, spawn, spawnSync } from "node:child_process";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { TestWorkflowEnvironment } from "@temporalio/testing";
import { Worker, bundleWorkflowCode } from "@temporalio/worker";
import type { WorkflowBundleWithSourceMap } from "@temporalio/worker";
import { createActivities } from "../../../src/lib/audio/durable/activities";
import { workflowIdFor } from "../../../src/lib/audio/durable/keys";
import { readLedger, waitForLedgerEvent } from "../../../src/lib/audio/durable/ledger";
import {
  ProviderAttemptEvent,
  PublishResult,
  RenderInput,
} from "../../../src/lib/audio/durable/types";
import {
  RenderFixture,
  buildTwoChunkTranscript,
  makeDbStub,
  setupRenderFixture,
} from "./durableTestUtils";

const WORKTREE_ROOT = fileURLToPath(new URL("../../..", import.meta.url));
const WORKFLOWS_PATH = path.join(WORKTREE_ROOT, "src/lib/audio/durable/workflows.ts");
const ENTRY_PATH = fileURLToPath(new URL("./workerLossEntry.ts", import.meta.url));
const TASK_QUEUE = "podcast-render-test-worker-loss";

// temporal.api.enums.v1.TimeoutType.TIMEOUT_TYPE_HEARTBEAT
const TIMEOUT_TYPE_HEARTBEAT = 4;

function temporalCliOnPath(): string | null {
  const result = spawnSync("which", ["temporal"], { encoding: "utf8" });
  const found = result.status === 0 ? result.stdout.trim() : "";
  return found.length > 0 ? found : null;
}

let testEnv: TestWorkflowEnvironment | null = null;
let bundle: WorkflowBundleWithSourceMap | null = null;
let bundleDir: string | null = null;
let bundleCodePath: string | null = null;

beforeAll(async () => {
  try {
    const cli = temporalCliOnPath();
    testEnv = await TestWorkflowEnvironment.createLocal(
      cli ? { server: { executable: { type: "existing-path", path: cli } } } : undefined
    );
    bundle = await bundleWorkflowCode({ workflowsPath: WORKFLOWS_PATH });
    bundleDir = await fs.mkdtemp(path.join(os.tmpdir(), "durable-worker-loss-bundle-"));
    bundleCodePath = path.join(bundleDir, "workflow-bundle.js");
    await fs.writeFile(bundleCodePath, bundle.code);
  } catch (error) {
    console.warn(
      "worker-loss test skipped: could not start a local Temporal test server:",
      error instanceof Error ? error.message : error
    );
    testEnv = null;
  }
}, 180_000);

afterAll(async () => {
  await testEnv?.teardown();
  if (bundleDir !== null) {
    await fs.rm(bundleDir, { recursive: true, force: true });
  }
});

/**
 * Spawn the child worker and resolve once it prints WORKER_READY.
 *
 * The worker MUST live in the process the test kills: `node --import tsx`
 * runs the entry in one process, unlike the `tsx` CLI wrapper, which
 * re-spawns a grandchild that would survive a SIGKILL of its parent. The
 * child is also its own process group so killChildWorkerHard can SIGKILL
 * the whole group.
 */
async function spawnChildWorker(fixture: RenderFixture): Promise<ChildProcess> {
  if (!testEnv || bundleCodePath === null) throw new Error("test env not started");
  const child = spawn(process.execPath, ["--import", "tsx", ENTRY_PATH], {
    cwd: WORKTREE_ROOT,
    detached: true,
    env: {
      ...process.env,
      DURABLE_TEST_ADDRESS: testEnv.address,
      DURABLE_TEST_NAMESPACE: testEnv.namespace ?? "default",
      DURABLE_TEST_TASK_QUEUE: TASK_QUEUE,
      // setupRenderFixture roots both stores at <fixture dir>/store.
      DURABLE_TEST_STORE_ROOT: path.join(path.dirname(fixture.ledgerPath), "store"),
      DURABLE_TEST_CONTROL_PATH: fixture.controlPath,
      DURABLE_TEST_LEDGER_PATH: fixture.ledgerPath,
      DURABLE_TEST_BUNDLE_PATH: bundleCodePath,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderr = "";
  child.stderr!.on("data", (chunk: Buffer) => {
    stderr += chunk.toString();
  });

  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`child worker not ready after 90s; stderr:\n${stderr}`));
    }, 90_000);
    let stdout = "";
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      if (stdout.includes("WORKER_READY")) {
        clearTimeout(timer);
        resolve();
      }
    });
    child.on("exit", (code, signal) => {
      clearTimeout(timer);
      reject(
        new Error(`child worker exited before ready (code=${code} signal=${signal}); stderr:\n${stderr}`)
      );
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
  return child;
}

/** SIGKILL the child worker's whole process group: a real, drainless death. */
function killChildWorkerHard(child: ChildProcess): void {
  if (child.pid === undefined) {
    throw new Error("child worker has no pid");
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
  }
}

describe("worker loss mid-renderChunk", () => {
  let dir: string;
  let fixture: RenderFixture;
  let child: ChildProcess | null = null;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "durable-worker-loss-"));
  });

  afterEach(async () => {
    if (child !== null && child.exitCode === null) {
      killChildWorkerHard(child);
    }
    child = null;
    await fs.rm(dir, { recursive: true, force: true });
  });

  it(
    "redelivers the killed chunk to a replacement worker via heartbeat timeout",
    async (ctx) => {
      if (!testEnv) return ctx.skip();
      fixture = await setupRenderFixture(dir, buildTwoChunkTranscript("worker loss"));

      // Arm the demo's step-5 hold: chunk 1, attempt 1, after the provider
      // rendered but before it commits. Attempt is pinned to 1 so the
      // replacement worker's attempt 2 can never re-match the gate.
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
              action: { kind: "hold" },
            },
          ],
        })
      );

      child = await spawnChildWorker(fixture);

      const handle = await testEnv.client.workflow.start("renderPodcast", {
        taskQueue: TASK_QUEUE,
        workflowId: workflowIdFor(fixture.renderKey),
        args: [
          {
            renderKey: fixture.renderKey,
            transcriptRef: fixture.transcriptRef,
            transcriptSha256: fixture.transcriptSha256,
            config: fixture.config,
          } satisfies RenderInput,
        ],
      });

      // Durable evidence that renderChunk(1) attempt 1 is inside the hold,
      // then a real kill: SIGKILL, no drain, no cancellation delivered.
      await waitForLedgerEvent(
        (e) => e.type === "gate_reached" && e.chunkIndex === 1 && e.attempt === 1,
        { path: fixture.ledgerPath, pollIntervalMs: 25, timeoutMs: 60_000 }
      );
      const killedAt = Date.now();
      killChildWorkerHard(child);
      await new Promise<void>((resolve) => child!.once("exit", () => resolve()));

      // Disarm the gate so the redelivered attempt runs through, then bring
      // up the replacement worker in-process.
      await fs.rm(fixture.controlPath);
      const worker = await Worker.create({
        connection: testEnv.nativeConnection,
        namespace: testEnv.namespace ?? "default",
        taskQueue: TASK_QUEUE,
        workflowBundle: bundle!,
        activities: createActivities({
          objectStore: fixture.store,
          transcriptStore: fixture.transcripts,
          gates: {
            controlPath: fixture.controlPath,
            ledgerPath: fixture.ledgerPath,
            pollIntervalMs: 25,
          },
          db: makeDbStub().db,
        }),
      });

      const { result, history } = await worker.runUntil(async () => {
        const result = (await handle.result()) as PublishResult;
        const history = await handle.fetchHistory();
        return { result, history };
      });
      expect(result.renderKey).toBe(fixture.renderKey);
      expect(await fixture.store.exists(result.finalObjectKey)).toBe(true);

      // Ledger: chunk 0 rendered once and never reran; chunk 1 carries
      // attempts 1 (killed) and 2 (redelivered) with exactly one commit,
      // and nothing was injected — this failure is pure worker death.
      const events = readLedger(fixture.ledgerPath);
      const attempts = (chunkIndex: number) =>
        events.filter(
          (e): e is ProviderAttemptEvent =>
            e.type === "provider_attempt" && e.chunkIndex === chunkIndex
        );
      expect(attempts(0)).toHaveLength(1);
      expect(events.filter((e) => e.type === "provider_commit" && e.chunkIndex === 0)).toHaveLength(1);
      expect(attempts(1).map((e) => e.attempt)).toEqual([1, 2]);
      expect(events.filter((e) => e.type === "provider_commit" && e.chunkIndex === 1)).toHaveLength(1);
      expect(events.filter((e) => e.type === "injected_failure")).toHaveLength(0);

      // History: attempt 2's ActivityTaskStarted records the prior attempt
      // failing with a HEARTBEAT timeout — detection came from missed
      // heartbeats, not startToCloseTimeout.
      const heartbeatTimedOutRetry = (history.events ?? []).some((event) => {
        const attrs = event.activityTaskStartedEventAttributes;
        if (!attrs || Number(attrs.attempt) !== 2) return false;
        const timeoutType = attrs.lastFailure?.timeoutFailureInfo?.timeoutType;
        return (
          Number(timeoutType) === TIMEOUT_TYPE_HEARTBEAT ||
          String(timeoutType) === "TIMEOUT_TYPE_HEARTBEAT"
        );
      });
      expect(heartbeatTimedOutRetry).toBe(true);

      // Redelivery latency: kill -> attempt-2 provider_attempt. The policy
      // budget is heartbeatTimeout (15s) + retry backoff (~1s); 60s is the
      // generous CI ceiling and still 5x under the demo's old failure mode
      // (waiting out the 5-minute startToCloseTimeout).
      const attempt2 = attempts(1).find((e) => e.attempt === 2);
      expect(attempt2).toBeDefined();
      const redeliveryMs = Date.parse(attempt2!.ts) - killedAt;
      expect(redeliveryMs).toBeGreaterThan(0);
      expect(redeliveryMs).toBeLessThan(60_000);
    },
    240_000
  );
});
