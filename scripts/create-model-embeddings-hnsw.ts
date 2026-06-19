#!/usr/bin/env tsx
/**
 * Create the HNSW vector index on item_model_embeddings, post-backfill (dv0.5.8).
 *
 * Run this AFTER the nomic backfill converges (scripts/model-embedding-coverage.ts
 * exits 0). Builds CONCURRENTLY on a dedicated connection so the live cron is
 * never blocked; verifies pg_index.indisvalid and rebuilds once if a prior build
 * left an invalid index. See src/lib/db/model-embeddings-hnsw.ts for the why.
 *
 * Optional: MODEL_EMBEDDINGS_HNSW_MAINTENANCE_WORK_MEM (default 256MB) raises the
 * server-side build memory on a larger Postgres.
 *
 * Usage: npx tsx scripts/create-model-embeddings-hnsw.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";

// Load env BEFORE importing the driver (it resolves DATABASE_URL lazily).
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getDbClient, getFreshPostgresConnection } from "../src/lib/db/driver";
import {
  ensureModelEmbeddingsHnswIndex,
  HNSW_INDEX_NAME,
} from "../src/lib/db/model-embeddings-hnsw";
import { logger } from "../src/lib/logger";

async function main(): Promise<void> {
  const maintenanceWorkMem = process.env.MODEL_EMBEDDINGS_HNSW_MAINTENANCE_WORK_MEM;

  // Dedicated connection: CONCURRENTLY cannot run in a transaction, and the
  // session GUCs (statement_timeout=0, maintenance_work_mem) must not leak to
  // pooled callers.
  const client = await getFreshPostgresConnection();
  try {
    logger.info(`Building HNSW index ${HNSW_INDEX_NAME} (CONCURRENTLY)…`);
    const result = await ensureModelEmbeddingsHnswIndex(
      client,
      maintenanceWorkMem ? { maintenanceWorkMem } : {},
    );
    logger.info(
      `HNSW index ${HNSW_INDEX_NAME} is valid` +
        (result.retried ? " (rebuilt after an invalid prior build)." : "."),
    );
  } finally {
    // Defensive: never let a cleanup error mask the real failure from the try.
    client.release();
    await getDbClient()
      .then((db) => db.close())
      .catch((err) => logger.warn("pool close failed during cleanup", err));
  }
}

main().catch((error) => {
  logger.error("create-model-embeddings-hnsw failed", error);
  process.exit(1);
});
