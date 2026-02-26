#!/usr/bin/env tsx
/**
 * One-time migration: Re-categorize TLDR Marketing items from "newsletters" to "marketing"
 *
 * This script:
 * 1. Finds items with utm_source=tldrmarketing in their URL
 * 2. Updates their category from "newsletters" to "marketing"
 * 3. Deletes old item_scores so they can be re-scored with marketing-specific LLM prompt
 * 4. Re-scores them using computeAndSaveScoresForCategory()
 *
 * Usage:
 *   npx tsx scripts/migrate-marketing-category.ts [--dry-run] [--skip-scoring]
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
    // 1. Count items to migrate
    // We treat an item as TLDR Marketing if ANY of the following hold:
    // - URL contains utm_source=tldrmarketing
    // - source_title includes "TLDR Marketing"
    // - title starts with "TLDR Marketing"
    const marketingWhereClause = `
      category = 'newsletters'
      AND (
        url LIKE '%utm_source=tldrmarketing%'
        OR source_title ILIKE '%TLDR Marketing%'
        OR title ILIKE 'TLDR Marketing%'
      )
    `;

    const countResult = await pool.query(
      `SELECT COUNT(*) as count FROM items WHERE ${marketingWhereClause}`,
    );
    const count = parseInt(countResult.rows[0].count, 10);
    logger.info(
      `Found ${count} TLDR Marketing items to migrate from "newsletters" to "marketing"`,
    );

    if (count === 0) {
      logger.info("No items to migrate. Exiting.");
      return;
    }

    // Show sample items
    const sampleResult = await pool.query(
      `SELECT id, title, url, source_title FROM items
       WHERE ${marketingWhereClause}
       ORDER BY published_at DESC
       LIMIT 5`,
    );
    logger.info("Sample items:");
    for (const row of sampleResult.rows) {
      logger.info(`  - ${row.title}`);
    }

    if (isDryRun) {
      logger.info(
        "[DRY RUN] Would update these items to category='marketing'. Exiting.",
      );
      return;
    }

    // 2. Update category
    const updateResult = await pool.query(
      `UPDATE items SET category = 'marketing' WHERE ${marketingWhereClause}`,
    );
    logger.info(
      `Updated ${updateResult.rowCount} items to category='marketing'`,
    );

    // 3. Delete old scores for migrated items so re-scoring is not skipped
    const migratedIds = await pool.query(
      `SELECT id FROM items WHERE category = 'marketing'`,
    );
    const itemIds: string[] = migratedIds.rows.map((r: { id: string }) => r.id);
    logger.info(`Deleting old scores for ${itemIds.length} items...`);

    // Batch delete to avoid query length limits
    for (let i = 0; i < itemIds.length; i += 100) {
      const batch = itemIds.slice(i, i + 100);
      const placeholders = batch.map((_, idx) => `$${idx + 1}`).join(",");
      await pool.query(
        `DELETE FROM item_scores WHERE item_id IN (${placeholders})`,
        batch,
      );
    }
    logger.info(`Deleted old scores for ${itemIds.length} items`);

    if (skipScoring) {
      logger.info(
        "[SKIP-SCORING] Skipping LLM re-scoring. Run score-production-items.ts --category=marketing to score later.",
      );
      return;
    }

    // 4. Load migrated items for re-scoring
    const itemsResult = await pool.query(
      `SELECT * FROM items WHERE category = 'marketing' ORDER BY published_at DESC`,
    );
    logger.info(
      `Loaded ${itemsResult.rows.length} marketing items for scoring`,
    );

    // Convert to FeedItem format
    const feedItems: FeedItem[] = itemsResult.rows.map(
      (row: Record<string, unknown>) => ({
        id: row.id as string,
        streamId: row.stream_id as string,
        sourceTitle: row.source_title as string,
        title: row.title as string,
        url: row.url as string,
        author: (row.author as string) || undefined,
        publishedAt: new Date((row.published_at as number) * 1000),
        createdAt: new Date((row.created_at as number) * 1000),
        summary: (row.summary as string) || undefined,
        contentSnippet: (row.content_snippet as string) || undefined,
        categories: JSON.parse((row.categories as string) || "[]"),
        category: "marketing" as Category,
        raw: {},
        fullText: (row.full_text as string) || undefined,
      }),
    );

    // 5. Score with marketing-specific prompt
    const { computeAndSaveScoresForCategory } =
      await import("../src/lib/pipeline/compute-scores");
    const scored = await computeAndSaveScoresForCategory(
      feedItems,
      "marketing",
    );
    logger.info(`Scored ${scored} marketing items`);

    // 6. Verify
    const verifyResult = await pool.query(
      `SELECT COUNT(*) as count FROM items WHERE category = 'marketing'`,
    );
    const scoreVerify = await pool.query(
      `SELECT COUNT(DISTINCT item_id) as count FROM item_scores
       WHERE item_id IN (SELECT id FROM items WHERE category = 'marketing')`,
    );
    const remainingNewsletter = await pool.query(
      `SELECT COUNT(*) as count FROM items
       WHERE ${marketingWhereClause}`,
    );

    logger.info("\n=== Migration Complete ===");
    logger.info(`Marketing items: ${verifyResult.rows[0].count}`);
    logger.info(`Items with scores: ${scoreVerify.rows[0].count}`);
    logger.info(
      `Remaining in newsletters with tldrmarketing URL: ${remainingNewsletter.rows[0].count}`,
    );
  } finally {
    await pool.end();
  }
}

main().catch((error) => {
  logger.error("Migration failed:", error);
  process.exit(1);
});
