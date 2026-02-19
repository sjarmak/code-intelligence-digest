/**
 * Database initialization and client
 *
 * Supports both SQLite (development) and PostgreSQL (production).
 * Driver detection is automatic based on DATABASE_URL env var.
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../logger";
import { detectDriver, getDbClient, DatabaseDriver } from "./driver";
import {
  getPostgresSchema,
  ITEMS_SEARCH_TRIGGER_FUNCTION_SQL,
  ITEMS_SEARCH_TRIGGER_DROP_SQL,
  ITEMS_SEARCH_TRIGGER_CREATE_SQL,
} from "./schema-postgres";
import { ensurePostgresUserIdColumns } from "./ensure-user-id";

let sqlite: Database.Database | null = null;
let initialized = false;

/**
 * Reset SQLite connection to avoid stale data in Next.js dev server
 * This is a no-op in production or when using PostgreSQL
 */
export function resetSqliteConnection(): void {
  const driver = detectDriver();
  if (driver === "sqlite" && sqlite) {
    // Close existing connection
    sqlite.close();
    sqlite = null;
    logger.debug("SQLite connection reset");
  }
}

/**
 * Get or create SQLite database connection (development only)
 */
export function getSqlite() {
  if (!sqlite) {
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), ".data");
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    const dbPath = path.join(dataDir, "digest.db");
    sqlite = new Database(dbPath);

    // Enable foreign keys
    sqlite.pragma("foreign_keys = ON");

    logger.info(`Database initialized at ${dbPath}`);
  }

  return sqlite;
}

/**
 * Initialize database schema (create tables if they don't exist)
 * Automatically detects and uses the appropriate driver (SQLite or PostgreSQL)
 */
export async function initializeDatabase() {
  const driver = detectDriver();

  if (initialized) {
    // Already initialized: still ensure user_id columns (handles DBs created before migration)
    if (driver === "postgres") {
      const client = await getDbClient();
      await ensurePostgresUserIdColumns(client);
    }
    return;
  }

  logger.info(`Initializing database with ${driver} driver`);

  if (driver === "postgres") {
    await initializePostgresSchema();
  } else {
    await initializeSqliteSchema();
  }

  initialized = true;
}

/**
 * Initialize PostgreSQL schema
 */
async function initializePostgresSchema() {
  try {
    const client = await getDbClient();
    const schema = getPostgresSchema();

    // Execute schema in segments (extensions, tables, indexes)
    await client.exec(schema);

    // Items search_vector trigger only when column is not generated (PG 12+ GENERATED STORED; PG 11 nullable)
    // Use pg_catalog to avoid "is_generated" in SQL (parsed as "is" + "GENERATED" on some PG versions)
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

    // Add search_vector column if missing (e.g. migrated from GENERATED column or old schema)
    try {
      await client.run(`
        ALTER TABLE items ADD COLUMN IF NOT EXISTS search_vector tsvector;
      `);
    } catch {
      // Column may already exist
    }

    await ensurePostgresUserIdColumns(client);
    logger.info("PostgreSQL schema initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize PostgreSQL schema", error);
    throw error;
  }
}

/**
 * Initialize SQLite schema (existing implementation)
 */
async function initializeSqliteSchema() {
  try {
    const sqlite = getSqlite();

    // Create feeds table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS feeds (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL UNIQUE,
        canonical_name TEXT NOT NULL,
        default_category TEXT NOT NULL,
        vendor TEXT,
        tags TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create items table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS items (
        id TEXT PRIMARY KEY,
        stream_id TEXT NOT NULL,
        source_title TEXT NOT NULL,
        title TEXT NOT NULL,
        url TEXT NOT NULL,
        author TEXT,
        published_at INTEGER NOT NULL,
        summary TEXT,
        content_snippet TEXT,
        categories TEXT,
        category TEXT NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create item_scores table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS item_scores (
        item_id TEXT NOT NULL,
        category TEXT NOT NULL,
        bm25_score REAL NOT NULL,
        llm_relevance INTEGER NOT NULL,
        llm_usefulness INTEGER NOT NULL,
        llm_tags TEXT,
        recency_score REAL NOT NULL,
        engagement_score REAL,
        final_score REAL NOT NULL,
        reasoning TEXT,
        scored_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (item_id, scored_at)
      );
    `);

    // Create cache_metadata table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS cache_metadata (
        key TEXT PRIMARY KEY,
        last_refresh_at INTEGER,
        count INTEGER,
        expires_at INTEGER
      );
    `);

    // Create digest_selections table
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS digest_selections (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL,
        category TEXT NOT NULL,
        period TEXT NOT NULL,
        rank INTEGER NOT NULL,
        diversity_reason TEXT,
        selected_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Create item_embeddings table (BLOB format for efficiency)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS item_embeddings (
        item_id TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        embedding_model TEXT DEFAULT 'claude-3-5-sonnet',
        generated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
    `);

    // Create index for efficient lookups
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_embeddings_generated_at
      ON item_embeddings(generated_at);
    `);

    // Create sync_state table for resumable syncs
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS sync_state (
        id TEXT PRIMARY KEY,
        continuation_token TEXT,
        items_processed INTEGER DEFAULT 0,
        calls_used INTEGER DEFAULT 0,
        started_at INTEGER NOT NULL,
        last_updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        status TEXT NOT NULL,
        error TEXT
      );
    `);

    // Create global_api_budget table for tracking across all syncs
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS global_api_budget (
        date TEXT PRIMARY KEY,
        calls_used INTEGER DEFAULT 0,
        last_updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        quota_limit INTEGER DEFAULT 100
      );
    `);

    // Create user_cache table for storing inoreader user ID (never changes)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS user_cache (
        key TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'legacy',
        cached_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);
    try {
      sqlite.exec(`ALTER TABLE user_cache ADD COLUMN user_id TEXT DEFAULT 'legacy';`);
      sqlite.exec(`UPDATE user_cache SET user_id = 'legacy' WHERE user_id IS NULL;`);
    } catch {
      // Column may already exist
    }

    // Create starred_items table for relevance tuning
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS starred_items (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE,
        inoreader_item_id TEXT NOT NULL UNIQUE,
        relevance_rating INTEGER,
        notes TEXT,
        starred_at INTEGER NOT NULL,
        rated_at INTEGER,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
    `);

    // Create item_relevance table for user ratings on regular items (not just starred)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS item_relevance (
        id TEXT PRIMARY KEY,
        item_id TEXT NOT NULL UNIQUE,
        relevance_rating INTEGER,
        notes TEXT,
        rated_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        FOREIGN KEY (item_id) REFERENCES items(id) ON DELETE CASCADE
      );
    `);

    // Create admin_settings table for feature toggles
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS admin_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Add source_relevance column to feeds if it doesn't exist
    try {
      sqlite.exec(`
        ALTER TABLE feeds ADD COLUMN source_relevance INTEGER DEFAULT 1;
      `);
    } catch {
      // Column may already exist, ignore error
    }

    // Add extracted_url column to items for persisting discovered article URLs
    try {
      sqlite.exec(`
        ALTER TABLE items ADD COLUMN extracted_url TEXT;
      `);
    } catch {
      // Column may already exist, ignore error
    }

    // Create saved_items and digest_items (per-user libraries)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS saved_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'legacy',
        item_id TEXT NOT NULL,
        saved_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(user_id, item_id)
      );
      CREATE TABLE IF NOT EXISTS digest_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'legacy',
        item_id TEXT NOT NULL,
        added_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now')),
        UNIQUE(user_id, item_id)
      );
    `);
    try {
      sqlite.exec(`ALTER TABLE saved_items ADD COLUMN user_id TEXT DEFAULT 'legacy';`);
      sqlite.exec(`UPDATE saved_items SET user_id = 'legacy' WHERE user_id IS NULL;`);
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_saved_items_user_item ON saved_items(user_id, item_id);`);
    } catch {
      // Column or index may already exist
    }
    try {
      sqlite.exec(`ALTER TABLE digest_items ADD COLUMN user_id TEXT DEFAULT 'legacy';`);
      sqlite.exec(`UPDATE digest_items SET user_id = 'legacy' WHERE user_id IS NULL;`);
      sqlite.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_digest_items_user_item ON digest_items(user_id, item_id);`);
    } catch {
      // Column or index may already exist
    }

    // Create generated_podcast_audio table for audio rendering
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS generated_podcast_audio (
        id TEXT PRIMARY KEY,
        podcast_id TEXT,
        transcript_hash TEXT NOT NULL UNIQUE,
        provider TEXT NOT NULL,
        voice TEXT,
        format TEXT NOT NULL,
        duration TEXT,
        duration_seconds INTEGER,
        audio_url TEXT NOT NULL,
        segment_audio TEXT,
        bytes INTEGER NOT NULL,
        generated_at INTEGER DEFAULT (strftime('%s', 'now')),
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

    // Generated newsletters (per-user)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS generated_newsletters (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL DEFAULT 'legacy',
        title TEXT NOT NULL,
        markdown TEXT,
        html TEXT,
        created_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS user_podcast_audio (
        user_id TEXT NOT NULL DEFAULT 'legacy',
        audio_id TEXT NOT NULL REFERENCES generated_podcast_audio(id) ON DELETE CASCADE,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        PRIMARY KEY (user_id, audio_id)
      );
    `);

    // Create indexes for common queries
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_items_stream_id ON items(stream_id);
      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
      CREATE INDEX IF NOT EXISTS idx_items_published_at ON items(published_at);
      CREATE INDEX IF NOT EXISTS idx_item_scores_item_id ON item_scores(item_id);
      CREATE INDEX IF NOT EXISTS idx_item_scores_category ON item_scores(category);
      CREATE INDEX IF NOT EXISTS idx_digest_selections_category ON digest_selections(category);
      CREATE INDEX IF NOT EXISTS idx_digest_selections_period ON digest_selections(period);
      CREATE INDEX IF NOT EXISTS idx_starred_items_item_id ON starred_items(item_id);
      CREATE INDEX IF NOT EXISTS idx_starred_items_inoreader_id ON starred_items(inoreader_item_id);
      CREATE INDEX IF NOT EXISTS idx_starred_items_rating ON starred_items(relevance_rating);
      CREATE INDEX IF NOT EXISTS idx_item_relevance_item_id ON item_relevance(item_id);
      CREATE INDEX IF NOT EXISTS idx_item_relevance_rating ON item_relevance(relevance_rating);
      CREATE INDEX IF NOT EXISTS idx_podcast_audio_hash ON generated_podcast_audio(transcript_hash);
      CREATE INDEX IF NOT EXISTS idx_podcast_audio_created_at ON generated_podcast_audio(created_at);
      CREATE INDEX IF NOT EXISTS idx_generated_newsletters_user_id ON generated_newsletters(user_id);
      CREATE INDEX IF NOT EXISTS idx_generated_newsletters_created_at ON generated_newsletters(created_at);
      CREATE INDEX IF NOT EXISTS idx_user_podcast_audio_user_id ON user_podcast_audio(user_id);
      CREATE INDEX IF NOT EXISTS idx_user_podcast_audio_created_at ON user_podcast_audio(created_at);
    `);

    logger.info("SQLite schema initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize SQLite database schema", error);
    throw error;
  }
}

/**
 * Global API budget tracking (cross-endpoint)
 * Tracks all Inoreader API calls made in a single day
 */

export function getGlobalApiBudget(): {
  callsUsed: number;
  remaining: number;
  quotaLimit: number;
} {
  const sqlite = getSqlite();
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  const row = sqlite
    .prepare(
      "SELECT calls_used, quota_limit FROM global_api_budget WHERE date = ?",
    )
    .get(today) as { calls_used: number; quota_limit: number } | undefined;

  if (!row) {
    // Initialize for today
    sqlite
      .prepare(
        "INSERT OR IGNORE INTO global_api_budget (date, calls_used) VALUES (?, 0)",
      )
      .run(today);
    return { callsUsed: 0, remaining: 100, quotaLimit: 100 };
  }

  return {
    callsUsed: row.calls_used,
    remaining: row.quota_limit - row.calls_used,
    quotaLimit: row.quota_limit,
  };
}

export function incrementGlobalApiCalls(count: number): {
  callsUsed: number;
  remaining: number;
} {
  const sqlite = getSqlite();
  const today = new Date().toISOString().split("T")[0];

  sqlite
    .prepare(
      `
      INSERT INTO global_api_budget (date, calls_used)
      VALUES (?, ?)
      ON CONFLICT(date) DO UPDATE SET
        calls_used = calls_used + ?,
        last_updated_at = strftime('%s', 'now')
    `,
    )
    .run(today, count, count);

  const budget = getGlobalApiBudget();
  return {
    callsUsed: budget.callsUsed,
    remaining: budget.remaining,
  };
}

/**
 * Cache Inoreader user ID (stable, never changes)
 * First run: fetch from API (1 call)
 * Subsequent runs: retrieve from cache (0 calls)
 */
export async function getCachedUserId(): Promise<string | null> {
  const driver = detectDriver();

  if (driver === "postgres") {
    const client = await getDbClient();
    const result = await client.query(
      "SELECT user_id FROM user_cache WHERE key = $1",
      ["inoreader_user_id"],
    );
    const row = result.rows[0] as { user_id: string } | undefined;
    return row?.user_id || null;
  } else {
    const sqlite = getSqlite();
    const row = sqlite
      .prepare("SELECT user_id FROM user_cache WHERE key = ?")
      .get("inoreader_user_id") as { user_id: string } | undefined;
    return row?.user_id || null;
  }
}

export async function setCachedUserId(userId: string): Promise<void> {
  const driver = detectDriver();

  if (driver === "postgres") {
    const client = await getDbClient();
    await client.run(
      `INSERT INTO user_cache (key, user_id)
       VALUES ($1, $2)
       ON CONFLICT (key) DO UPDATE SET user_id = EXCLUDED.user_id, cached_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
      ["inoreader_user_id", userId],
    );
  } else {
    const sqlite = getSqlite();
    sqlite
      .prepare(
        `
        INSERT OR REPLACE INTO user_cache (key, user_id)
        VALUES (?, ?)
      `,
      )
      .run("inoreader_user_id", userId);
  }
}
