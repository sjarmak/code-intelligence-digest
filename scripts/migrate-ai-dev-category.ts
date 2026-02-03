#!/usr/bin/env tsx
/**
 * One-time migration: Populate AI Dev category by re-categorizing newsletter items
 *
 * This script:
 * 1. Finds newsletter items (from TLDR, Byte Byte Go, etc.) that match AI Dev patterns
 * 2. Updates their category from "newsletters" to "ai_dev"
 * 3. Deletes old item_scores so they can be re-scored with ai_dev-specific LLM prompt
 * 4. Re-scores them using computeAndSaveScoresForCategory()
 *
 * Usage:
 *   npx tsx scripts/migrate-ai-dev-category.ts [--dry-run] [--skip-scoring]
 *
 * Environment variables required:
 *   - DATABASE_URL: PostgreSQL connection string
 *   - OPENAI_API_KEY: For LLM scoring (unless --skip-scoring)
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { Pool } from "pg";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { FeedItem, Category } from "../src/lib/model";
import { logger } from "../src/lib/logger";
import {
  isNewsletterSource,
  itemMatchesAiDevPatterns,
} from "../src/lib/pipeline/decompose";

const isDryRun = process.argv.includes("--dry-run");
const skipScoring = process.argv.includes("--skip-scoring");

async function main(): Promise<void> {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl || !databaseUrl.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL must be set to a PostgreSQL connection string",
    );
  }

  const pool = new Pool({
    connectionString: databaseUrl,
    ssl: { rejectUnauthorized: false },
  });

  try {
    // 1. Load newsletter items (from newsletter sources: TLDR, Byte Byte Go, etc.)
    const newslettersResult = await pool.query(
      `SELECT id, stream_id, source_title, title, url, author, published_at, created_at,
              summary, content_snippet, categories, category
       FROM items
       WHERE category = 'newsletters'
       ORDER BY published_at DESC`,
    );

    const newsletterRows = newslettersResult.rows;
    logger.info(`Loaded ${newsletterRows.length} newsletter items`);

    // 2. Filter to items from newsletter sources that match AI Dev patterns
    const toMigrate: Array<Record<string, unknown>> = [];
    for (const row of newsletterRows) {
      const sourceTitle = row.source_title as string;
      if (!isNewsletterSource(sourceTitle)) continue;
      if (
        itemMatchesAiDevPatterns({
          title: row.title as string,
          summary: row.summary as string,
          contentSnippet: row.content_snippet as string,
          url: row.url as string,
          sourceTitle,
        })
      ) {
        toMigrate.push(row);
      }
    }

    logger.info(
      `Found ${toMigrate.length} newsletter items to migrate to ai_dev`,
    );

    if (toMigrate.length === 0) {
      logger.info("No items to migrate. Exiting.");
      return;
    }

    // Show sample items
    logger.info("Sample items:");
    for (const row of toMigrate.slice(0, 5)) {
      logger.info(`  - ${row.title}`);
    }

    if (isDryRun) {
      logger.info(
        "[DRY RUN] Would update these items to category='ai_dev'. Exiting.",
      );
      return;
    }

    // 3. Update category
    const ids = toMigrate.map((r) => r.id as string);
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(",");
    const updateResult = await pool.query(
      `UPDATE items SET category = 'ai_dev' WHERE id IN (${placeholders})`,
      ids,
    );
    logger.info(
      `Updated ${updateResult.rowCount} items to category='ai_dev'`,
    );

    // 4. Delete old scores for migrated items so re-scoring is not skipped
    logger.info(`Deleting old scores for ${ids.length} items...`);
    for (let i = 0; i < ids.length; i += 100) {
      const batch = ids.slice(i, i + 100);
      const batchPlaceholders = batch.map((_, idx) => `$${idx + 1}`).join(",");
      await pool.query(
        `DELETE FROM item_scores WHERE item_id IN (${batchPlaceholders})`,
        batch,
      );
    }
    logger.info(`Deleted old scores`);

    if (skipScoring) {
      logger.info(
        "[SKIP-SCORING] Skipping LLM re-scoring. Run score-production-items.ts to score ai_dev later.",
      );
      return;
    }

    // 5. Load migrated items for re-scoring
    const itemsResult = await pool.query(
      `SELECT * FROM items WHERE category = 'ai_dev' ORDER BY published_at DESC`,
    );
    logger.info(
      `Loaded ${itemsResult.rows.length} ai_dev items for scoring`,
    );

    const feedItems: FeedItem[] = itemsResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        streamId: row.stream_id as string,
        sourceTitle: row.source_title as string,
        title: row.title as string,
        url: row.url as string,
        author: (row.author as string) || undefined,
        publishedAt: new Date((row.published_at as number) * 1000),
        createdAt: row.created_at
          ? new Date((row.created_at as number) * 1000)
          : undefined,
        summary: (row.summary as string) || undefined,
        contentSnippet: (row.content_snippet as string) || undefined,
        categories: JSON.parse((row.categories as string) || "[]"),
        category: "ai_dev" as Category,
        raw: {},
        fullText: (row.full_text as string) || undefined,
      }),
    );

    // 6. Score with ai_dev-specific prompt
    const { computeAndSaveScoresForCategory } =
      await import("../src/lib/pipeline/compute-scores");
    const scored = await computeAndSaveScoresForCategory(
      feedItems,
      "ai_dev",
    );
    logger.info(`Scored ${scored} ai_dev items`);

    // 7. Verify
    const verifyResult = await pool.query(
      `SELECT COUNT(*) as count FROM items WHERE category = 'ai_dev'`,
    );
    logger.info("\n=== Migration Complete ===");
    logger.info(`AI Dev items: ${verifyResult.rows[0].count}`);
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  logger.error("Migration failed:", error);
  process.exit(1);
});
