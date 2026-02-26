#!/usr/bin/env npx tsx

/**
 * Backfill full text for all categories
 *
 * This script:
 * 1. Backfills research items from ads_papers.body (fast, already fetched)
 * 2. Extracts full text for other categories via web scraping (slower)
 *
 * Run with: npx tsx scripts/backfill-all-fulltext.ts
 */

import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { getSqlite } from '../src/lib/db/index';
import { saveFullText, loadItemsByCategory, getFullTextCacheStats } from '../src/lib/db/items';
import { fetchFullTextBatch } from '../src/lib/pipeline/fulltext';
import { logger } from '../src/lib/logger';
import type { Category } from '../src/lib/model';

function extractBibcodeFromUrl(url: string): string | null {
  const arxivMatch = url.match(/arxiv\.org(?:\/abs|\/pdf)\/(\d{4}\.\d{4,5})/);
  if (arxivMatch) {
    const arxivId = arxivMatch[1];
    const [year, num] = arxivId.split('.');
    const yearShort = year.substring(2);
    const numPadded = num.padStart(5, '0');
    return `20${yearShort}arXiv${year}${numPadded}`;
  }

  const adsMatch = url.match(/adsabs\.harvard\.edu\/abs\/(\d{4}arXiv\d{4,5}\w*)/);
  if (adsMatch) {
    return adsMatch[1];
  }

  return null;
}

async function backfillResearchFromADS(): Promise<{ successful: number; failed: number; skipped: number }> {
  const driver = detectDriver();
  logger.info('🔬 Backfilling research items from ads_papers...');

  let itemsToBackfill: Array<{ id: string; url: string; title: string }> = [];

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT id, url, title
       FROM items
       WHERE category = 'research'
         AND (full_text IS NULL OR LENGTH(full_text) < 100)
       ORDER BY published_at DESC
       LIMIT 1000`
    );
    itemsToBackfill = result.rows as Array<{ id: string; url: string; title: string }>;
  } else {
    const sqlite = getSqlite();
    itemsToBackfill = sqlite
      .prepare(
        `SELECT id, url, title
         FROM items
         WHERE category = 'research'
           AND (full_text IS NULL OR LENGTH(full_text) < 100)
         ORDER BY published_at DESC
         LIMIT 1000`
      )
      .all() as Array<{ id: string; url: string; title: string }>;
  }

  logger.info(`Found ${itemsToBackfill.length} research items without full_text`);

  if (itemsToBackfill.length === 0) {
    logger.info('✅ All research items already have full_text');
    return { successful: 0, failed: 0, skipped: 0 };
  }

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of itemsToBackfill) {
    try {
      const bibcode = extractBibcodeFromUrl(item.url);
      if (!bibcode) {
        skipped++;
        continue;
      }

      let body: string | null = null;

      if (driver === 'postgres') {
        const client = await getDbClient();
        const result = await client.query(
          'SELECT body FROM ads_papers WHERE bibcode = $1 AND body IS NOT NULL AND LENGTH(body) >= 100 LIMIT 1',
          [bibcode]
        );
        if (result.rows.length > 0) {
          body = (result.rows[0] as { body: string }).body;
        }
      } else {
        const sqlite = getSqlite();
        const row = sqlite
          .prepare('SELECT body FROM ads_papers WHERE bibcode = ? AND body IS NOT NULL AND LENGTH(body) >= 100 LIMIT 1')
          .get(bibcode) as { body: string } | undefined;
        if (row) {
          body = row.body;
        }
      }

      if (body && body.length >= 100) {
        await saveFullText(item.id, body, 'ads_api');
        successful++;
        if (successful % 50 === 0) {
          logger.info(`  Research progress: ${successful} successful, ${failed} failed, ${skipped} skipped`);
        }
      } else {
        skipped++;
      }
    } catch (error) {
      logger.warn(`Failed to backfill ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  logger.info(`✅ Research backfill complete: ${successful} successful, ${failed} failed, ${skipped} skipped`);
  return { successful, failed, skipped };
}

async function backfillOtherCategories(
  categories: Category[] = ['tech_articles', 'ai_news', 'product_news', 'newsletters'],
  maxPerCategory: number = 200,
  concurrency: number = 5
): Promise<Map<Category, { successful: number; failed: number }>> {
  const results = new Map<Category, { successful: number; failed: number }>();

  for (const category of categories) {
    logger.info(`\n🌐 Backfilling ${category} via web scraping...`);

    try {
      const items = await loadItemsByCategory(category, 30); // Last 30 days
      const itemsToFetch = items
        .filter((item) => !item.fullText || (item.fullText?.length ?? 0) < 100)
        .slice(0, maxPerCategory);

      if (itemsToFetch.length === 0) {
        logger.info(`  ✅ All ${category} items already have full_text`);
        results.set(category, { successful: 0, failed: 0 });
        continue;
      }

      logger.info(`  Fetching ${itemsToFetch.length} ${category} items...`);

      const batchResults = await fetchFullTextBatch(itemsToFetch, concurrency);
      let successful = 0;
      let failed = 0;

      for (const [itemId, result] of batchResults.entries()) {
        try {
          if (result.source !== 'error' && result.text.length >= 100) {
            await saveFullText(itemId, result.text, result.source);
            successful++;
          } else {
            failed++;
          }
        } catch (error) {
          logger.warn(`  Failed to save ${itemId}: ${error}`);
          failed++;
        }
      }

      logger.info(`  ✅ ${category} complete: ${successful} successful, ${failed} failed`);
      results.set(category, { successful, failed });
    } catch (error) {
      logger.error(`  ❌ ${category} failed: ${error}`);
      results.set(category, { successful: 0, failed: 0 });
    }
  }

  return results;
}

async function main() {
  try {
    logger.info('🚀 Starting full text backfill for all categories...\n');

    const startStats = await getFullTextCacheStats();
    logger.info('📊 Starting stats:');
    logger.info(`   Total items: ${startStats.total}`);
    logger.info(`   Cached: ${startStats.cached} (${Math.round((startStats.cached / startStats.total) * 100)}%)`);
    logger.info(`   By source: ${JSON.stringify(startStats.bySource)}\n`);

    // Step 1: Backfill research from ADS (fast)
    const researchResult = await backfillResearchFromADS();

    // Step 2: Backfill other categories via web scraping (slower)
    const otherResults = await backfillOtherCategories(
      ['tech_articles', 'ai_news', 'product_news'],
      200, // max per category
      5    // concurrency
    );

    // Final stats
    const endStats = await getFullTextCacheStats();
    logger.info('\n📊 Final stats:');
    logger.info(`   Total items: ${endStats.total}`);
    logger.info(`   Cached: ${endStats.cached} (${Math.round((endStats.cached / endStats.total) * 100)}%)`);
    logger.info(`   By source: ${JSON.stringify(endStats.bySource)}`);
    logger.info(`   Newly cached: ${endStats.cached - startStats.cached} items\n`);

    logger.info('✅ Backfill complete!');
  } catch (error) {
    logger.error('Backfill failed:', error);
    process.exit(1);
  }
}

main().catch(console.error);
