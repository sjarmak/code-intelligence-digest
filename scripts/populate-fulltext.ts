#!/usr/bin/env npx tsx

/**
 * Populate full text cache for all categories
 * Fetches content in batches with progress reporting
 * 
 * Run with: npx tsx scripts/populate-fulltext.ts
 * 
 * Fetches in priority order:
 * 1. tech_articles (most valuable)
 * 2. research
 * 3. ai_news
 * 4. product_news
 * 5. podcasts
 * 6. newsletters
 * 7. community
 */

import { loadItemsByCategory, saveFullText, getFullTextCacheStats } from "../src/lib/db/items";
import { fetchFullTextBatch } from "../src/lib/pipeline/fulltext";
import { logger } from "../src/lib/logger";
import type { Category } from "../src/lib/model";

const CATEGORIES_BY_PRIORITY: Category[] = [
  "tech_articles",
  "research",
  "ai_news",
  "product_news",
  "podcasts",
  "newsletters",
  "community",
];

interface Stats {
  category: Category;
  loaded: number;
  fetched: number;
  successful: number;
  failed: number;
  skipped: number;
  duration: number;
}

async function populateCategory(
  category: Category,
  batchSize: number = 20,
  maxConcurrent: number = 3
): Promise<Stats> {
  const startTime = Date.now();
  logger.info(`\n${"=".repeat(60)}`);
  logger.info(`Populating: ${category.toUpperCase()}`);
  logger.info(`${"=".repeat(60)}`);

  try {
    // Load items from last 30 days
    const items = await loadItemsByCategory(category, 30);
    logger.info(`Loaded ${items.length} items from last 30 days`);

    if (items.length === 0) {
      logger.warn("No items found for this category");
      return {
        category,
        loaded: 0,
        fetched: 0,
        successful: 0,
        failed: 0,
        skipped: 0,
        duration: 0,
      };
    }

    // Filter items that don't have full text yet
    const itemsToFetch = items.filter(
      (item) => !(item as any).fullText || ((item as any).fullText || "").length < 100
    );

    logger.info(`Items needing full text: ${itemsToFetch.length} (${items.length - itemsToFetch.length} already cached)`);

    if (itemsToFetch.length === 0) {
      logger.info("All items already have full text cached");
      return {
        category,
        loaded: items.length,
        fetched: 0,
        successful: 0,
        failed: 0,
        skipped: items.length,
        duration: Date.now() - startTime,
      };
    }

    let totalSuccessful = 0;
    let totalFailed = 0;

    // Process in batches
    for (let i = 0; i < itemsToFetch.length; i += batchSize) {
      const batchNum = Math.floor(i / batchSize) + 1;
      const batchStart = i;
      const batchEnd = Math.min(i + batchSize, itemsToFetch.length);
      const batch = itemsToFetch.slice(batchStart, batchEnd);

      logger.info(
        `\n  Batch ${batchNum}: items ${batchStart + 1}-${batchEnd} of ${itemsToFetch.length}`
      );

      const batchStartTime = Date.now();
      const results = await fetchFullTextBatch(batch, maxConcurrent);
      const batchDuration = Date.now() - batchStartTime;

      // Save results
      for (const [itemId, result] of results.entries()) {
        try {
          await saveFullText(itemId, result.text, result.source);
          if (result.source !== "error") {
            totalSuccessful++;
          } else {
            totalFailed++;
          }
        } catch (error) {
          logger.error(`Failed to save full text for ${itemId}`, { error });
          totalFailed++;
        }
      }

      const batchSuccessRate = totalSuccessful + totalFailed > 0
        ? Math.round((totalSuccessful / (totalSuccessful + totalFailed)) * 100)
        : 0;

      logger.info(
        `  ✓ Batch completed in ${(batchDuration / 1000).toFixed(1)}s (${totalSuccessful} successful, ${totalFailed} failed, ${batchSuccessRate}% success rate)`
      );
    }

    const duration = Date.now() - startTime;
    logger.info(
      `✅ ${category}: ${totalSuccessful} successful, ${totalFailed} failed in ${(duration / 1000).toFixed(1)}s`
    );

    return {
      category,
      loaded: items.length,
      fetched: itemsToFetch.length,
      successful: totalSuccessful,
      failed: totalFailed,
      skipped: items.length - itemsToFetch.length,
      duration,
    };
  } catch (error) {
    logger.error(`Failed to populate ${category}`, { error });
    return {
      category,
      loaded: 0,
      fetched: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      duration: Date.now() - startTime,
    };
  }
}

async function main() {
  try {
    logger.info("🚀 Starting full text population...\n");

    // Get initial stats
    const initialStats = await getFullTextCacheStats();
    logger.info(`Initial cache state: ${initialStats.cached}/${initialStats.total} items cached (${
      initialStats.total > 0 ? Math.round((initialStats.cached / initialStats.total) * 100) : 0
    }%)\n`);

    const results: Stats[] = [];
    const overallStart = Date.now();

    // Populate each category
    for (const category of CATEGORIES_BY_PRIORITY) {
      const stats = await populateCategory(category);
      results.push(stats);
    }

    // Final stats
    const finalStats = await getFullTextCacheStats();
    const overallDuration = Date.now() - overallStart;

    logger.info(`\n${"=".repeat(60)}`);
    logger.info("📊 FINAL SUMMARY");
    logger.info(`${"=".repeat(60)}`);

    let totalLoaded = 0;
    let totalFetched = 0;
    let totalSuccessful = 0;
    let totalFailed = 0;

    for (const stat of results) {
      if (stat.loaded > 0) {
        const successRate = stat.fetched > 0
          ? Math.round((stat.successful / stat.fetched) * 100)
          : 0;
        logger.info(
          `${stat.category.padEnd(18)} | Loaded: ${stat.loaded.toString().padStart(5)} | ` +
          `Fetched: ${stat.fetched.toString().padStart(5)} | Success: ${successRate}%`
        );
        totalLoaded += stat.loaded;
        totalFetched += stat.fetched;
        totalSuccessful += stat.successful;
        totalFailed += stat.fetched - stat.successful;
      }
    }

    logger.info(`${"=".repeat(60)}`);
    logger.info(
      `Total: ${totalSuccessful} successful fetches in ${(overallDuration / 1000).toFixed(1)}s`
    );
    logger.info(
      `Cache improvement: ${initialStats.cached} → ${finalStats.cached} items (${
        Math.round((finalStats.cached / finalStats.total) * 100)
      }% cached)`
    );
    logger.info(`${"=".repeat(60)}\n`);

    logger.info("✅ Full text population complete!");
  } catch (error) {
    logger.error("Population failed", { error });
    process.exit(1);
  }
}

main();
