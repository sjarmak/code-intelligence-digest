#!/usr/bin/env npx tsx

/**
 * Fast full text population with parallel processing
 * Processes 50 items at a time with optimized concurrency
 * 
 * Run with: npx tsx scripts/populate-fulltext-fast.ts
 */

import { loadItemsByCategory, saveFullText, getFullTextCacheStats } from "../src/lib/db/items";
import { fetchFullText } from "../src/lib/pipeline/fulltext";
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
  duration: number;
}

async function populateCategory(
  category: Category,
  maxItems: number = 500,
  concurrency: number = 5
): Promise<Stats> {
  const startTime = Date.now();
  logger.info(`\nFetching ${category} (max ${maxItems} items)...`);

  try {
    // Load items from last 30 days
    const items = await loadItemsByCategory(category, 30);
    logger.info(`Loaded ${items.length} items`);

    if (items.length === 0) {
      return { category, loaded: 0, fetched: 0, successful: 0, failed: 0, duration: 0 };
    }

    // Filter items without full text
    const itemsToFetch = items.filter(
      (item) => !(item as any).fullText || ((item as any).fullText || "").length < 100
    ).slice(0, maxItems);

    logger.info(`Fetching ${itemsToFetch.length} items (skipped ${items.length - itemsToFetch.length})`);

    let successful = 0;
    let failed = 0;

    // Process in parallel with concurrency limit
    const queue = [...itemsToFetch];
    const active = new Set<Promise<void>>();

    while (queue.length > 0 || active.size > 0) {
      // Fill up to concurrency limit
      while (queue.length > 0 && active.size < concurrency) {
        const item = queue.shift()!;
        const promise = (async () => {
          try {
            const result = await fetchFullText(item);
            await saveFullText(item.id, result.text, result.source);
            if (result.source !== "error") {
              successful++;
            } else {
              failed++;
            }
          } catch (error) {
            logger.warn(`Failed to fetch ${item.title.slice(0, 50)}...`);
            failed++;
          }
        })().finally(() => {
          active.delete(promise);
        });
        active.add(promise);
      }

      // Wait for at least one to complete
      if (active.size > 0) {
        await Promise.race(active);
      }

      // Progress update every 50 items
      if ((successful + failed) % 50 === 0) {
        logger.info(`  ${successful + failed}/${itemsToFetch.length} fetched (${successful} success)`);
      }
    }

    const duration = Date.now() - startTime;
    const rate = ((successful + failed) / (duration / 1000)).toFixed(1);
    logger.info(`✓ ${category}: ${successful} successful in ${(duration / 1000).toFixed(1)}s (${rate} items/sec)`);

    return { category, loaded: items.length, fetched: itemsToFetch.length, successful, failed, duration };
  } catch (error) {
    logger.error(`Failed: ${category}`, { error });
    return { category, loaded: 0, fetched: 0, successful: 0, failed: 0, duration: 0 };
  }
}

async function main() {
  try {
    const startTime = Date.now();
    const initial = await getFullTextCacheStats();
    logger.info(`Starting: ${initial.cached}/${initial.total} cached (${Math.round((initial.cached / initial.total) * 100)}%)`);

    const results: Stats[] = [];

    for (const category of CATEGORIES_BY_PRIORITY) {
      const stat = await populateCategory(category, 300, 8); // Increased concurrency
      results.push(stat);
    }

    const final = await getFullTextCacheStats();
    const duration = Date.now() - startTime;

    logger.info(`\n${"=".repeat(60)}`);
    logger.info(`COMPLETE: ${final.cached}/${final.total} cached (${Math.round((final.cached / final.total) * 100)}%)`);
    logger.info(`Duration: ${(duration / 60000).toFixed(1)} minutes`);
    logger.info(`${"=".repeat(60)}\n`);
  } catch (error) {
    logger.error("Failed", { error });
    process.exit(1);
  }
}

main();
