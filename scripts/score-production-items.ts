#!/usr/bin/env tsx
/**
 * Score items locally and sync scores to production database
 *
 * This script:
 * 1. Fetches unscored items from production database
 * 2. Scores them locally (where we have more memory/resources)
 * 3. Saves scores back to production database
 * 4. Repeats until all items are scored
 *
 * Usage:
 *   npx tsx scripts/score-production-items.ts [--category=research] [--batch-size=25]
 *   npx tsx scripts/score-production-items.ts --category=product_news --rescore  # delete then rescore all
 *
 * Environment variables required:
 *   - DATABASE_URL: Production PostgreSQL connection string
 *   - OPENAI_API_KEY: For LLM scoring
 */

import * as dotenv from "dotenv";
import * as path from "path";
import { Pool } from "pg";

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { FeedItem, Category } from "../src/lib/model";
import { logger } from "../src/lib/logger";
import { computeAndSaveScoresForCategory } from "../src/lib/pipeline/compute-scores";

const VALID_CATEGORIES: Category[] = [
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "ai_dev",
  "product_news",
  "community",
  "research",
  "marketing",
];

interface ScoreOptions {
  category?: Category;
  batchSize?: number;
  /** If true, delete existing scores for the category first (full rescore). Otherwise only score unscored items. */
  rescore?: boolean;
  /** If true and category is set, keep scoring until no unscored items remain in that category. */
  untilDone?: boolean;
}

async function scoreProductionItems(options: ScoreOptions): Promise<void> {
  const { category, batchSize = 25, rescore = false, untilDone = false } = options;

  logger.info(`\n🎯 Scoring items locally and syncing to production...`);
  if (category) {
    logger.info(`Category: ${category}\n`);
  } else {
    logger.info(`All categories\n`);
  }

  // Connect to production Postgres
  const productionUrl = process.env.DATABASE_URL;
  if (!productionUrl || !productionUrl.startsWith("postgres")) {
    throw new Error(
      "DATABASE_URL must be set to production Postgres connection string",
    );
  }

  const prodPool = new Pool({
    connectionString: productionUrl,
    ssl: {
      rejectUnauthorized: false, // Render uses self-signed certs
    },
  });

  try {
    const categoriesToProcess = category ? [category] : VALID_CATEGORIES;
    let totalScored = 0;

    // Only delete existing scores when --rescore is explicitly requested (full rescore)
    if (category && rescore) {
      logger.info(
        `\n🧹 Deleting existing scores for category ${category} so they can be recomputed with latest logic...`,
      );
      await prodPool.query(
        `
        DELETE FROM item_scores
        WHERE item_id IN (SELECT id FROM items WHERE category = $1)
      `,
        [category],
      );
    }

    for (const cat of categoriesToProcess) {
      let round = 0;
      let remaining = 1;

      while (remaining > 0) {
        round++;
        if (untilDone && round > 1) {
          logger.info(`\n📊 [Round ${round}] Processing category: ${cat}`);
        } else {
          logger.info(`\n📊 Processing category: ${cat}`);
        }

        // Find items without scores
        const unscoredResult = await prodPool.query(
          `
        SELECT i.*
        FROM items i
        LEFT JOIN item_scores s ON i.id = s.item_id
        WHERE i.category = $1
          AND s.item_id IS NULL
        ORDER BY i.created_at DESC
        LIMIT $2
      `,
          [cat, batchSize * 10],
        ); // Fetch more items to batch process

        const unscoredRows = unscoredResult.rows;
        logger.info(
          `Found ${unscoredRows.length} unscored items in category ${cat}`,
        );

        if (unscoredRows.length === 0) {
          logger.info(`✅ All items in category ${cat} are already scored`);
          remaining = 0;
          continue;
        }

        // Convert rows to FeedItem format
        const items: FeedItem[] = unscoredRows.map((row) => {
          return {
            id: row.id,
            streamId: row.stream_id,
            sourceTitle: row.source_title,
            title: row.title,
            url: row.url,
            author: row.author || undefined,
            publishedAt: new Date(row.published_at * 1000),
            createdAt: new Date(row.created_at * 1000),
            summary: row.summary || undefined,
            contentSnippet: row.content_snippet || undefined,
            categories: JSON.parse(row.categories || "[]"),
            category: cat,
            raw: {},
            fullText: row.full_text || undefined, // Include full text for scoring
          };
        });

        // Use the shared scoring pipeline so scores match runtime logic
        logger.info(
          `Scoring ${items.length} items locally via compute-scores pipeline...`,
        );
        const scored = await computeAndSaveScoresForCategory(items, cat);
        logger.info(
          `✅ Scored and saved ${scored} items to production database for category ${cat}`,
        );
        totalScored += scored;

        // Check if there are more items to score
        const remainingResult = await prodPool.query(
          `
        SELECT COUNT(*) as count
        FROM items i
        LEFT JOIN item_scores s ON i.id = s.item_id
        WHERE i.category = $1
          AND s.item_id IS NULL
      `,
          [cat],
        );

        remaining = parseInt(remainingResult.rows[0].count, 10);
        if (remaining > 0) {
          logger.info(`📋 ${remaining} items remaining in category ${cat}`);
          if (!untilDone) break;
        } else {
          logger.info(`✅ Category ${cat} is fully scored!`);
        }
      }
    }

    logger.info(`\n🎉 Complete! Scored ${totalScored} items total`);
  } catch (error) {
    logger.error("Failed to score production items", error);
    throw error;
  } finally {
    await prodPool.end();
  }
}

// Parse command line arguments
const args = process.argv.slice(2);
const options: ScoreOptions = {};

for (const arg of args) {
  if (arg.startsWith("--category=")) {
    const cat = arg.split("=")[1] as Category;
    if (VALID_CATEGORIES.includes(cat)) {
      options.category = cat;
    } else {
      logger.error(
        `Invalid category: ${cat}. Valid categories: ${VALID_CATEGORIES.join(", ")}`,
      );
      process.exit(1);
    }
  } else if (arg === "--rescore") {
    options.rescore = true;
  } else if (arg === "--until-done") {
    options.untilDone = true;
  } else if (arg.startsWith("--batch-size=")) {
    const size = parseInt(arg.split("=")[1], 10);
    if (!isNaN(size) && size > 0) {
      options.batchSize = size;
    }
  }
}

// Run the script
scoreProductionItems(options).catch((error) => {
  logger.error("Script failed", error);
  process.exit(1);
});
