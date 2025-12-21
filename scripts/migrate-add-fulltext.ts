#!/usr/bin/env npx tsx

/**
 * Migration: Add full_text columns to items table
 * 
 * Run with: npx tsx scripts/migrate-add-fulltext.ts
 */

import { getSqlite } from "../src/lib/db/index";
import { logger } from "../src/lib/logger";

async function migrate() {
  try {
    const sqlite = getSqlite();

    logger.info("Starting migration: add full_text columns to items table");

    // Check if columns already exist
    const tableInfo = sqlite
      .prepare(`PRAGMA table_info(items)`)
      .all() as Array<{ name: string }>;

    const columnNames = tableInfo.map(col => col.name);
    const hasFullText = columnNames.includes("full_text");
    const hasFullTextFetchedAt = columnNames.includes("full_text_fetched_at");
    const hasFullTextSource = columnNames.includes("full_text_source");

    if (hasFullText && hasFullTextFetchedAt && hasFullTextSource) {
      logger.info("Migration already applied: full_text columns exist");
      return;
    }

    // Add columns if they don't exist
    if (!hasFullText) {
      logger.info("Adding full_text column");
      sqlite.exec("ALTER TABLE items ADD COLUMN full_text TEXT;");
    }

    if (!hasFullTextFetchedAt) {
      logger.info("Adding full_text_fetched_at column");
      sqlite.exec("ALTER TABLE items ADD COLUMN full_text_fetched_at INTEGER;");
    }

    if (!hasFullTextSource) {
      logger.info("Adding full_text_source column");
      sqlite.exec("ALTER TABLE items ADD COLUMN full_text_source TEXT;");
    }

    // Verify migration
    const updatedInfo = sqlite
      .prepare(`PRAGMA table_info(items)`)
      .all() as Array<{ name: string }>;
    const updatedColumnNames = updatedInfo.map(col => col.name);

    const allColumnsPresent =
      updatedColumnNames.includes("full_text") &&
      updatedColumnNames.includes("full_text_fetched_at") &&
      updatedColumnNames.includes("full_text_source");

    if (allColumnsPresent) {
      logger.info("✅ Migration successful: all full_text columns added");
    } else {
      throw new Error("Migration verification failed: columns not found");
    }
  } catch (error) {
    logger.error("Migration failed", { error });
    process.exit(1);
  }
}

migrate();
