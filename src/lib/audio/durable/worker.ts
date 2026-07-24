/**
 * Temporal worker bootstrap for the durable podcast render.
 *
 * Registers the renderPodcast Workflow (bundled from ./workflows) and the
 * Stage-2 Activities on the "podcast-render" task queue. Address and
 * namespace are env-driven (TEMPORAL_ADDRESS / TEMPORAL_NAMESPACE) with
 * localhost defaults for the demo topology. Graceful shutdown is wired in
 * the entrypoint (scripts/durable-worker.ts); the demo's kill tests still
 * use SIGKILL, which by design bypasses everything here.
 */

import { NativeConnection, Worker } from "@temporalio/worker";
import { ActivityDeps, createActivities } from "./activities";
// Shared env-driven wiring so the starter (API) and this worker can never
// disagree about address, namespace, or task queue.
import {
  DEFAULT_RENDER_TASK_QUEUE,
  renderTaskQueue,
  temporalAddress,
  temporalNamespace,
} from "./temporalClient";

export const TASK_QUEUE = DEFAULT_RENDER_TASK_QUEUE;

export interface DurableWorkerOptions {
  /** Temporal frontend address. Default: TEMPORAL_ADDRESS or localhost:7233. */
  address?: string;
  /** Temporal namespace. Default: TEMPORAL_NAMESPACE or "default". */
  namespace?: string;
  /** Default: TEMPORAL_TASK_QUEUE or "podcast-render". */
  taskQueue?: string;
  /** Injectable Activity dependencies (tests bind temp-dir stores here). */
  activityDeps?: ActivityDeps;
}

export interface DurableWorkerHandle {
  worker: Worker;
  connection: NativeConnection;
  taskQueue: string;
}

/**
 * Connect and build the worker. The caller owns the lifecycle: run with
 * `worker.run()`, stop with `worker.shutdown()`, then close the connection.
 */
export async function createDurableWorker(
  options: DurableWorkerOptions = {}
): Promise<DurableWorkerHandle> {
  const address = options.address ?? temporalAddress();
  const namespace = options.namespace ?? temporalNamespace();
  const taskQueue = options.taskQueue ?? renderTaskQueue();

  const connection = await NativeConnection.connect({ address });
  try {
    const worker = await Worker.create({
      connection,
      namespace,
      taskQueue,
      workflowsPath: require.resolve("./workflows"),
      activities: createActivities(options.activityDeps),
    });
    return { worker, connection, taskQueue };
  } catch (error) {
    await connection.close();
    throw error;
  }
}
