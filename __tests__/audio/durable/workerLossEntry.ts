/**
 * Child-process worker entrypoint for the worker-loss redelivery test
 * (workerLoss.test.ts). The parent spawns this via tsx, waits for the
 * WORKER_READY line, and later SIGKILLs the process mid-renderChunk —
 * a real worker death, not a graceful shutdown — so the server's
 * heartbeat-timeout detection is what gets exercised.
 *
 * Configuration is env-only (fail fast on anything missing):
 *   DURABLE_TEST_ADDRESS      Temporal test server address
 *   DURABLE_TEST_NAMESPACE    namespace of the test environment
 *   DURABLE_TEST_TASK_QUEUE   task queue this worker polls
 *   DURABLE_TEST_STORE_ROOT   fixture store root (objects + transcripts)
 *   DURABLE_TEST_CONTROL_PATH fault-gate control file
 *   DURABLE_TEST_LEDGER_PATH  demo ledger JSONL
 *   DURABLE_TEST_BUNDLE_PATH  pre-built workflow bundle code path
 */

import { NativeConnection, Worker } from "@temporalio/worker";
import { createActivities } from "../../../src/lib/audio/durable/activities";
import { TranscriptStore } from "../../../src/lib/audio/durable/transcriptStore";
import { TmpObjectStore, makeDbStub } from "./durableTestUtils";

function requireEnv(name: string): string {
  const value = process.env[name];
  if (value === undefined || value.length === 0) {
    throw new Error(`workerLossEntry: missing required env ${name}`);
  }
  return value;
}

async function main(): Promise<void> {
  const address = requireEnv("DURABLE_TEST_ADDRESS");
  const namespace = requireEnv("DURABLE_TEST_NAMESPACE");
  const taskQueue = requireEnv("DURABLE_TEST_TASK_QUEUE");
  const storeRoot = requireEnv("DURABLE_TEST_STORE_ROOT");
  const controlPath = requireEnv("DURABLE_TEST_CONTROL_PATH");
  const ledgerPath = requireEnv("DURABLE_TEST_LEDGER_PATH");
  const bundleCodePath = requireEnv("DURABLE_TEST_BUNDLE_PATH");

  const connection = await NativeConnection.connect({ address });
  const worker = await Worker.create({
    connection,
    namespace,
    taskQueue,
    workflowBundle: { codePath: bundleCodePath },
    activities: createActivities({
      objectStore: new TmpObjectStore(storeRoot),
      transcriptStore: new TranscriptStore(storeRoot),
      gates: { controlPath, ledgerPath, pollIntervalMs: 25 },
      db: makeDbStub().db,
    }),
  });

  // The parent waits for this exact line before starting the workflow.
  // SIGKILL from the parent is the only intended way this process exits.
  process.stdout.write("WORKER_READY\n");
  await worker.run();
}

main().catch((err) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
