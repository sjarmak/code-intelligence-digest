/**
 * Database initialization and client
 */

import Database from "better-sqlite3";
import * as path from "path";
import * as fs from "fs";
import { logger } from "../logger";

let sqlite: Database.Database | null = null;

/**
 * Get or create database connection
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
 */
export async function initializeDatabase() {
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

    // Create indexes for common queries
    sqlite.exec(`
      CREATE INDEX IF NOT EXISTS idx_items_stream_id ON items(stream_id);
      CREATE INDEX IF NOT EXISTS idx_items_category ON items(category);
      CREATE INDEX IF NOT EXISTS idx_items_published_at ON items(published_at);
      CREATE INDEX IF NOT EXISTS idx_item_scores_item_id ON item_scores(item_id);
      CREATE INDEX IF NOT EXISTS idx_item_scores_category ON item_scores(category);
      CREATE INDEX IF NOT EXISTS idx_digest_selections_category ON digest_selections(category);
      CREATE INDEX IF NOT EXISTS idx_digest_selections_period ON digest_selections(period);
    `);

    logger.info("Database schema initialized successfully");
  } catch (error) {
    logger.error("Failed to initialize database schema", error);
    throw error;
  }
}
