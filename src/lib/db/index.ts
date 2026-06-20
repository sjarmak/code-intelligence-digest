/**
 * Database initialization and exports
 *
 * PostgreSQL only (see `src/lib/db/driver.ts`).
 */

import { logger } from "../logger";
import {
  getDbClient,
  resetDbClient,
  detectDriver,
  getFreshPostgresConnection,
  type DatabaseClient,
} from "./driver";
import {
  getPostgresSchema,
  ITEMS_SEARCH_TRIGGER_FUNCTION_SQL,
  ITEMS_SEARCH_TRIGGER_DROP_SQL,
  ITEMS_SEARCH_TRIGGER_CREATE_SQL,
} from "./schema-postgres";
import { ensurePostgresUserIdColumns } from "./ensure-user-id";
import { initializeADSTables } from "./ads-papers";

export { getDbClient, resetDbClient, detectDriver, getFreshPostgresConnection };
export type { DatabaseClient };

// Re-export API budget helpers (single implementation; avoids SQLite-era duplication in this file)
export {
  getApiBudget,
  hasBudgetFor,
  incrementApiCalls,
  incrementGlobalApiCalls,
  getGlobalApiBudget,
} from "./api-budget";

let initialized = false;

/**
 * Initialize database schema (Postgres)
 */
export async function initializeDatabase() {
  detectDriver();

  if (initialized) {
    const client = await getDbClient();
    await ensurePostgresUserIdColumns(client);
    return;
  }

  logger.info(`Initializing database with postgres driver`);

  try {
    const client = await getDbClient();
    const schema = getPostgresSchema();
    await client.exec(schema);

    // M0: fail fast if pgvector is missing — every cosine path depends on it,
    // and a silent absence would degrade the whole vector lane to errors at
    // query time instead of one clear startup failure.
    await assertPgvectorInstalled(client);

    // ADS paper tables (ads_papers / ads_library_papers / ads_libraries) are
    // owned by initializeADSTables(), not the base schema. Ensure them here so a
    // fresh DB has them eagerly instead of only when an ADS API route first runs
    // — the base schema's paper_sections + sync paths assume they exist.
    await initializeADSTables();

    // Items search_vector trigger only when column is not generated (PG 12+ GENERATED STORED; PG 11 nullable)
    try {
      const check = await client.query(
        `SELECT a.attgenerated FROM pg_catalog.pg_attribute a
         JOIN pg_catalog.pg_class c ON a.attrelid = c.oid
         JOIN pg_catalog.pg_namespace n ON c.relnamespace = n.oid
         WHERE n.nspname = 'public' AND c.relname = 'items' AND a.attname = 'search_vector'
         AND a.attnum > 0 AND NOT a.attisdropped`,
      );
      const row = check.rows[0] as { attgenerated?: string } | undefined;
      const isGenerated = row?.attgenerated === "s";
      if (!isGenerated) {
        await client.query(ITEMS_SEARCH_TRIGGER_FUNCTION_SQL);
        await client.query(ITEMS_SEARCH_TRIGGER_DROP_SQL);
        await client.query(ITEMS_SEARCH_TRIGGER_CREATE_SQL);
      }
    } catch (e) {
      // PG 11 has no attgenerated; or column missing: create trigger anyway (safe for nullable column)
      try {
        await client.query(ITEMS_SEARCH_TRIGGER_FUNCTION_SQL);
        await client.query(ITEMS_SEARCH_TRIGGER_DROP_SQL);
        await client.query(ITEMS_SEARCH_TRIGGER_CREATE_SQL);
      } catch (e2) {
        logger.warn("Items search trigger setup failed (non-fatal)", {
          error: e2 instanceof Error ? e2.message : String(e2),
        });
      }
    }

    // Add full_text column if it doesn't exist (for migration)
    try {
      await client.run(`
        ALTER TABLE items ADD COLUMN IF NOT EXISTS full_text TEXT;
      `);
    } catch {
      // Column may already exist
    }

    // Add search_vector column if missing
    try {
      await client.run(`
        ALTER TABLE items ADD COLUMN IF NOT EXISTS search_vector tsvector;
      `);
    } catch {
      // Column may already exist
    }

    // Add title to generated_podcast_audio for content-based display (migration)
    try {
      await client.run(`
        ALTER TABLE "generated_podcast_audio" ADD COLUMN IF NOT EXISTS title TEXT;
      `);
    } catch {
      // Column may already exist
    }

    // Ensure agent_reports is per-account capable.
    try {
      await client.run(`
        ALTER TABLE agent_reports ADD COLUMN IF NOT EXISTS user_id TEXT DEFAULT 'legacy';
      `);
      await client.run(`
        UPDATE agent_reports SET user_id = 'legacy' WHERE user_id IS NULL;
      `);
      await client.run(`
        CREATE INDEX IF NOT EXISTS idx_agent_reports_user_goal_generated
        ON agent_reports(user_id, goal, generated_at DESC);
      `);
    } catch {
      // Ignore migration failures; routes fall back to legacy behavior if needed.
    }

    // M0: embedding provenance columns for existing databases (no-op on fresh
    // DBs — the baseline already includes them). Backfill of the actual values
    // is a separate bounded job (scripts/backfill-embedding-provenance.ts), not
    // run here: deriving norms for 116K vectors at boot would exceed the timeout.
    try {
      await client.run(`
        ALTER TABLE item_embeddings ADD COLUMN IF NOT EXISTS embedding_dimensions INTEGER;
      `);
      await client.run(`
        ALTER TABLE item_embeddings ADD COLUMN IF NOT EXISTS embedding_version TEXT;
      `);
      await client.run(`
        ALTER TABLE item_embeddings ADD COLUMN IF NOT EXISTS embedding_normalized BOOLEAN;
      `);
    } catch {
      // Columns may already exist.
    }

    await ensurePostgresUserIdColumns(client);
    logger.info("PostgreSQL schema initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize PostgreSQL schema", error);
    throw error;
  }

  initialized = true;
}

/**
 * Assert the pgvector extension is installed (M0 startup gate). Throws a clear
 * error naming the fix rather than letting every `<=>` query fail later.
 */
export async function assertPgvectorInstalled(
  client: DatabaseClient,
): Promise<string> {
  const res = await client.query(
    `SELECT extversion FROM pg_extension WHERE extname = 'vector'`,
  );
  const version = res.rows[0]?.extversion as string | undefined;
  if (!version) {
    throw new Error(
      "pgvector extension is not installed — run `CREATE EXTENSION vector;`. " +
        "Vector search and embeddings cannot operate without it.",
    );
  }
  logger.info(`pgvector extension present (version ${version})`);
  return version;
}

/**
 * Cache Inoreader user ID (stable, never changes)
 * First run: fetch from API (1 call)
 * Subsequent runs: retrieve from cache (0 calls)
 */
export async function getCachedUserId(): Promise<string | null> {
  const client = await getDbClient();
  const result = await client.query(
    "SELECT user_id FROM user_cache WHERE key = $1",
    ["inoreader_user_id"],
  );
  const row = result.rows[0] as { user_id: string } | undefined;
  return row?.user_id || null;
}

export async function setCachedUserId(userId: string): Promise<void> {
  const client = await getDbClient();
  await client.run(
    `INSERT INTO user_cache (key, user_id)
     VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET user_id = EXCLUDED.user_id, cached_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
    ["inoreader_user_id", userId],
  );
}
