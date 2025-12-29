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
import { detectDriver, getDbClient, DatabaseDriver, getDatabaseUrl } from "./driver";
import { getPostgresSchema } from "./schema-postgres";

let sqlite: Database.Database | null = null;
let initialized = false;

/**
 * Get or create SQLite database connection (development only)
 *
 * NOTE: SQLite connections are cached. If you're seeing stale data,
 * you may need to close and reopen the connection.
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

    // Enable WAL mode for better concurrency and to avoid stale reads
    sqlite.pragma("journal_mode = WAL");

    logger.info(`Database initialized at ${dbPath}`);
  }

  return sqlite;
}

/**
 * Close and reset the SQLite connection (useful for testing or fixing stale data)
 */
export function resetSqliteConnection() {
  if (sqlite) {
    sqlite.close();
    sqlite = null;
    logger.info("SQLite connection closed and reset");
  }
}

/**
 * Initialize database schema (create tables if they don't exist)
 * Automatically detects and uses the appropriate driver (SQLite or PostgreSQL)
 */
export async function initializeDatabase() {
  if (initialized) {
    return;
  }

  const driver = detectDriver();
  logger.info(`Initializing database with ${driver} driver`);

  if (driver === 'postgres') {
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

    // Check if we're on local (no pgvector) by checking if DATABASE_URL is localhost
    const dbUrl = getDatabaseUrl();
    const isLocal = dbUrl?.includes('localhost') || dbUrl?.includes('127.0.0.1');
    
    // For local development, replace vector types with TEXT
    let schemaToExecute = schema;
    if (isLocal) {
      logger.info('Local database detected, replacing vector types with TEXT');
      schemaToExecute = schema.replace(/vector\(1536\)/gi, 'TEXT');
    }

    // Execute schema
    await client.exec(schemaToExecute);

    // Add full_text column if it doesn't exist (for migration)
    try {
      await client.run(`
        ALTER TABLE items ADD COLUMN IF NOT EXISTS full_text TEXT;
      `);
    } catch {
      // Column may already exist
    }

    // Add missing columns to ads_papers if they don't exist (for migration)
    try {
      await client.exec(`
        ALTER TABLE ads_papers ADD COLUMN IF NOT EXISTS html_content TEXT;
        ALTER TABLE ads_papers ADD COLUMN IF NOT EXISTS html_fetched_at INTEGER;
        ALTER TABLE ads_papers ADD COLUMN IF NOT EXISTS html_sections TEXT;
        ALTER TABLE ads_papers ADD COLUMN IF NOT EXISTS html_figures TEXT;
        ALTER TABLE ads_papers ADD COLUMN IF NOT EXISTS paper_notes TEXT;
        ALTER TABLE ads_papers ADD COLUMN IF NOT EXISTS is_favorite INTEGER DEFAULT 0;
        ALTER TABLE ads_papers ADD COLUMN IF NOT EXISTS favorited_at INTEGER;
      `);
    } catch {
      // Columns may already exist
    }

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
        quota_limit INTEGER DEFAULT 1000
      );
    `);

    // Create user_cache table for storing inoreader user ID (never changes)
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS user_cache (
        key TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        cached_at INTEGER DEFAULT (strftime('%s', 'now'))
      );
    `);

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

    // Create usage_quota table for rate limiting
    sqlite.exec(`
      CREATE TABLE IF NOT EXISTS usage_quota (
        key TEXT PRIMARY KEY,
        endpoint TEXT NOT NULL,
        client_ip TEXT NOT NULL,
        window_type TEXT NOT NULL,
        used INTEGER DEFAULT 0,
        reset_at INTEGER NOT NULL,
        created_at INTEGER DEFAULT (strftime('%s', 'now')),
        updated_at INTEGER DEFAULT (strftime('%s', 'now'))
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
      CREATE INDEX IF NOT EXISTS idx_usage_quota_endpoint ON usage_quota(endpoint, client_ip);
      CREATE INDEX IF NOT EXISTS idx_usage_quota_reset ON usage_quota(reset_at);
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

export async function getGlobalApiBudget(): Promise<{ callsUsed: number; remaining: number; quotaLimit: number }> {
  const client = await getDbClient();
  const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const result = await client.query(
    'SELECT calls_used, quota_limit FROM global_api_budget WHERE date = ?',
    [today]
  );

  if (result.rows.length === 0) {
    // Initialize for today with default quota of 1000
    const driver = detectDriver();
    const insertSql = driver === 'postgres'
      ? 'INSERT INTO global_api_budget (date, calls_used, quota_limit) VALUES ($1, 0, 1000) ON CONFLICT (date) DO NOTHING'
      : 'INSERT OR IGNORE INTO global_api_budget (date, calls_used, quota_limit) VALUES (?, 0, 1000)';
    await client.run(insertSql, [today]);
    return { callsUsed: 0, remaining: 1000, quotaLimit: 1000 };
  }

  const row = result.rows[0] as { calls_used: number; quota_limit: number };
  return {
    callsUsed: row.calls_used,
    remaining: row.quota_limit - row.calls_used,
    quotaLimit: row.quota_limit,
  };
}

export async function incrementGlobalApiCalls(count: number): Promise<{ callsUsed: number; remaining: number }> {
  const client = await getDbClient();
  const driver = detectDriver();
  const today = new Date().toISOString().split('T')[0];

  const updateSql = driver === 'postgres'
    ? `INSERT INTO global_api_budget (date, calls_used, last_updated_at)
       VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::INTEGER)
       ON CONFLICT(date) DO UPDATE SET
         calls_used = global_api_budget.calls_used + $3,
         last_updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`
    : `INSERT INTO global_api_budget (date, calls_used)
       VALUES (?, ?)
       ON CONFLICT(date) DO UPDATE SET
         calls_used = calls_used + ?,
         last_updated_at = strftime('%s', 'now')`;

  await client.run(updateSql, [today, count, count]);

  const budget = await getGlobalApiBudget();
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
  const client = await getDbClient();
  const result = await client.query(
    'SELECT user_id FROM user_cache WHERE key = ?',
    ['inoreader_user_id']
  );
  const row = result.rows[0] as { user_id: string } | undefined;
  return row?.user_id || null;
}

export async function setCachedUserId(userId: string): Promise<void> {
  const client = await getDbClient();
  const driver = detectDriver();
  const insertSql = driver === 'postgres'
    ? 'INSERT INTO user_cache (key, user_id, cached_at) VALUES ($1, $2, EXTRACT(EPOCH FROM NOW())::INTEGER) ON CONFLICT (key) DO UPDATE SET user_id = $2, cached_at = EXTRACT(EPOCH FROM NOW())::INTEGER'
    : 'INSERT OR REPLACE INTO user_cache (key, user_id) VALUES (?, ?)';
  await client.run(insertSql, ['inoreader_user_id', userId]);
}
