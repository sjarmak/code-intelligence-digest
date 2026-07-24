/**
 * Entrypoint for the durable podcast-render Temporal worker.
 *
 * Usage:
 *   npm run durable:worker
 *
 * Environment:
 *   TEMPORAL_ADDRESS    Temporal frontend (default localhost:7233)
 *   TEMPORAL_NAMESPACE  namespace (default "default")
 *   USE_LOCAL_DB        defaults to "true" here — the durable demo path
 *                       never connects to production PostgreSQL unless
 *                       explicitly overridden with USE_LOCAL_DB=false
 *   LOCAL_DATABASE_URL  local postgres DSN (defaults to the docker-compose
 *                       instance; start it with `npm run db:start`)
 *   DEMO_FAULT_CONTROL  fault-gate control file (default .demo/fault-control.json)
 *   DEMO_LEDGER_PATH    demo ledger JSONL (default .demo/ledger.jsonl)
 *
 * Shutdown: SIGTERM/SIGINT drain gracefully via worker.shutdown(). The
 * demo's worker-loss steps use `kill -9` (SIGKILL) precisely because it
 * cannot be handled — recovery must come from Temporal replay, not from
 * an exit hook.
 */

import { createDurableWorker } from "../src/lib/audio/durable/worker";
import { logger } from "../src/lib/logger";

// DB safety: this worker is demo tooling. Default to the local database
// and never fall back to a production DSN implicitly.
if (process.env.USE_LOCAL_DB === undefined) {
  process.env.USE_LOCAL_DB = "true";
}
// docker-compose.yml publishes postgres on host port 5433 (5432 is left to
// any system PostgreSQL), so the default must point there.
if (process.env.USE_LOCAL_DB === "true" && !process.env.LOCAL_DATABASE_URL) {
  process.env.LOCAL_DATABASE_URL =
    "postgresql://code_intel_user:local_dev_password@localhost:5433/code_intel";
}

async function main(): Promise<void> {
  const { worker, connection, taskQueue } = await createDurableWorker();

  const shutdown = (signal: string) => {
    logger.info("Durable worker draining on signal", { signal, pid: process.pid });
    worker.shutdown();
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  logger.info("Durable render worker running", {
    taskQueue,
    pid: process.pid,
    address: process.env.TEMPORAL_ADDRESS ?? "localhost:7233",
    namespace: process.env.TEMPORAL_NAMESPACE ?? "default",
  });

  try {
    await worker.run();
  } finally {
    await connection.close();
  }
  logger.info("Durable render worker stopped", { pid: process.pid });
}

main().catch((error) => {
  logger.error("Durable render worker failed", error);
  process.exit(1);
});
