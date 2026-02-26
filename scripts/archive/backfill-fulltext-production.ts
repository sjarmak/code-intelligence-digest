#!/usr/bin/env npx tsx

/**
 * Production Full Text Backfill
 *
 * Extracts full text for ALL existing items in production database that don't have it.
 * No Inoreader API calls needed - uses existing item URLs.
 *
 * Usage:
 *   # Use production database (DATABASE_URL from .env.local or env)
 *   npx tsx scripts/archive/backfill-fulltext-production.ts
 *
 *   # Or specify limit and batch size
 *   LIMIT=1000 BATCH_SIZE=20 npx tsx scripts/backfill-fulltext-production.ts
 *
 * Environment Variables:
 *   - DATABASE_URL: Production database connection (required)
 *   - LIMIT: Maximum items to process (default: no limit, processes all)
 *   - BATCH_SIZE: Items per batch (default: 10)
 *   - MAX_CONCURRENT: Concurrent extractions per domain (default: 3)
 *   - CATEGORY: Process only specific category (optional)
 */

import * as dotenv from "dotenv";
import * as path from "path";

// Load .env.local so DATABASE_URL is available
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config(); // Also load .env

import { initializeDatabase } from "../../src/lib/db/index";
import { saveFullText, getFullTextCacheStats } from "../../src/lib/db/items";
import { fetchFullTextBatch } from "../../src/lib/pipeline/fulltext";
import { logger } from "../../src/lib/logger";
import { getDbClient, detectDriver } from "../../src/lib/db/driver";
import type { FeedItem, Category } from "../src/lib/model";

interface BackfillStats {
  total: number;
  needsText: number;
  processed: number;
  successful: number;
  failed: number;
  skipped: number;
  duration: number;
}

/**
 * Load all items that need full text extraction
 */
async function loadItemsNeedingFullText(
  limit?: number,
  category?: Category
): Promise<FeedItem[]> {
  const driver = detectDriver();

  let query: string;
  let params: unknown[];

  if (driver === 'postgres') {
    const client = await getDbClient();

    if (category) {
      query = `
        SELECT id, stream_id, source_title, title, url, author,
               published_at, created_at, summary, content_snippet,
               categories, category, full_text, extracted_url
        FROM items
        WHERE category = $1
          AND (full_text IS NULL OR LENGTH(full_text) < 100)
        ORDER BY
          CASE category
            WHEN 'research' THEN 1
            WHEN 'tech_articles' THEN 2
            WHEN 'ai_news' THEN 3
            ELSE 4
          END,
          published_at DESC
        ${limit ? `LIMIT $2` : ''}
      `;
      params = limit ? [category, limit] : [category];
    } else {
      query = `
        SELECT id, stream_id, source_title, title, url, author,
               published_at, created_at, summary, content_snippet,
               categories, category, full_text, extracted_url
        FROM items
        WHERE full_text IS NULL OR LENGTH(full_text) < 100
        ORDER BY
          CASE category
            WHEN 'research' THEN 1
            WHEN 'tech_articles' THEN 2
            WHEN 'ai_news' THEN 3
            ELSE 4
          END,
          published_at DESC
        ${limit ? `LIMIT $1` : ''}
      `;
      params = limit ? [limit] : [];
    }

    const result = await client.query(query, params);
    const rows = result.rows as Array<{
      id: string;
      stream_id: string;
      source_title: string;
      title: string;
      url: string;
      author: string | null;
      published_at: number;
      created_at: number;
      summary: string | null;
      content_snippet: string | null;
      categories: string;
      category: string;
      full_text: string | null;
      extracted_url: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      streamId: row.stream_id,
      sourceTitle: row.source_title,
      title: row.title,
      url: row.extracted_url && !row.extracted_url.includes('inoreader.com')
        ? row.extracted_url
        : row.url,
      author: row.author || undefined,
      publishedAt: new Date(row.published_at * 1000),
      createdAt: new Date(row.created_at * 1000),
      summary: row.summary || undefined,
      contentSnippet: row.content_snippet || undefined,
      categories: JSON.parse(row.categories || '[]'),
      category: row.category as Category,
      raw: {},
      fullText: row.full_text || undefined,
    }));
  } else {
    // SQLite fallback (shouldn't be used for production backfill)
    const { getSqlite } = await import("../../src/lib/db/index");
    const sqlite = getSqlite();

    const whereClause = category
      ? `category = ? AND (full_text IS NULL OR LENGTH(full_text) < 100)`
      : `full_text IS NULL OR LENGTH(full_text) < 100`;
    const orderBy = `
        CASE category
          WHEN 'research' THEN 1
          WHEN 'tech_articles' THEN 2
          WHEN 'ai_news' THEN 3
          ELSE 4
        END,
        published_at DESC
    `;
    const sql = `SELECT id, stream_id, source_title, title, url, author,
       published_at, created_at, summary, content_snippet,
       categories, category, full_text, extracted_url
    FROM items
    WHERE ${whereClause}
    ORDER BY ${orderBy}
    ${limit ? `LIMIT ${limit}` : ""}`;

    const rows = (category
      ? sqlite.prepare(sql).all(category)
      : sqlite.prepare(sql).all()) as Array<{
      id: string;
      stream_id: string;
      source_title: string;
      title: string;
      url: string;
      author: string | null;
      published_at: number;
      created_at: number;
      summary: string | null;
      content_snippet: string | null;
      categories: string;
      category: string;
      full_text: string | null;
      extracted_url: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      streamId: row.stream_id,
      sourceTitle: row.source_title,
      title: row.title,
      url: row.extracted_url && !row.extracted_url.includes('inoreader.com')
        ? row.extracted_url
        : row.url,
      author: row.author || undefined,
      publishedAt: new Date(row.published_at * 1000),
      createdAt: new Date(row.created_at * 1000),
      summary: row.summary || undefined,
      contentSnippet: row.content_snippet || undefined,
      categories: JSON.parse(row.categories || '[]'),
      category: row.category as Category,
      raw: {},
      fullText: row.full_text || undefined,
    }));
  }
}

/**
 * Backfill full text for all items
 */
async function backfillFullText(): Promise<BackfillStats> {
  const startTime = Date.now();

  // Get configuration
  const limit = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : undefined;
  const batchSize = parseInt(process.env.BATCH_SIZE || '10', 10);
  const maxConcurrent = parseInt(process.env.FULLTEXT_MAX_CONCURRENT || '3', 10);
  const category = process.env.CATEGORY as Category | undefined;

  logger.info('='.repeat(60));
  logger.info('PRODUCTION FULL TEXT BACKFILL');
  logger.info('='.repeat(60));
  logger.info(`Configuration:`);
  logger.info(`  Database: ${detectDriver()}`);
  logger.info(`  Category filter: ${category || 'all'}`);
  logger.info(`  Limit: ${limit || 'none (all items)'}`);
  logger.info(`  Batch size: ${batchSize}`);
  logger.info(`  Max concurrent: ${maxConcurrent}`);
  logger.info('='.repeat(60));

  // Get initial stats
  const initialStats = await getFullTextCacheStats();
  logger.info(`\nInitial state: ${initialStats.cached}/${initialStats.total} items have full text`);
  logger.info(`  By source: ${JSON.stringify(initialStats.bySource)}\n`);

  // Load items needing full text
  logger.info('Loading items that need full text extraction...');
  const items = await loadItemsNeedingFullText(limit, category);
  logger.info(`Found ${items.length} items needing full text\n`);

  if (items.length === 0) {
    logger.info('No items need full text extraction. Exiting.');
    return {
      total: initialStats.total,
      needsText: 0,
      processed: 0,
      successful: 0,
      failed: 0,
      skipped: 0,
      duration: Date.now() - startTime,
    };
  }

  // Process in batches
  let totalSuccessful = 0;
  let totalFailed = 0;
  const totalBatches = Math.ceil(items.length / batchSize);

  logger.info(`Processing ${items.length} items in ${totalBatches} batches...\n`);

  for (let i = 0; i < items.length; i += batchSize) {
    const batchNum = Math.floor(i / batchSize) + 1;
    const batch = items.slice(i, i + batchSize);

    logger.info(`Batch ${batchNum}/${totalBatches}: Processing ${batch.length} items...`);
    const batchStart = Date.now();

    try {
      // Fetch full text for batch
      const results = await fetchFullTextBatch(batch, maxConcurrent);

      // Save results
      for (const [itemId, result] of Array.from(results.entries())) {
        try {
          if (result.source !== 'error' && result.text.length > 100) {
            await saveFullText(itemId, result.text, result.source);
            totalSuccessful++;
          } else {
            totalFailed++;
            logger.debug(`Skipped item ${itemId}: ${result.source === 'error' ? 'extraction failed' : 'text too short'}`);
          }
        } catch (error) {
          logger.error(`Failed to save full text for item ${itemId}`, { error });
          totalFailed++;
        }
      }

      const batchDuration = Date.now() - batchStart;
      const batchSuccess = Array.from(results.values()).filter(r => r.source !== 'error').length;
      const batchFailed = batch.length - batchSuccess;

      logger.info(
        `  ✓ Batch ${batchNum} completed in ${(batchDuration / 1000).toFixed(1)}s ` +
        `(${batchSuccess} success, ${batchFailed} failed)`
      );

      // Progress summary
      const progress = ((i + batch.length) / items.length * 100).toFixed(1);
      logger.info(
        `  Progress: ${i + batch.length}/${items.length} (${progress}%) | ` +
        `Total: ${totalSuccessful} success, ${totalFailed} failed\n`
      );

      // Rate limit between batches (except last batch)
      if (i + batchSize < items.length) {
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    } catch (error) {
      logger.error(`Batch ${batchNum} failed`, { error });
      totalFailed += batch.length;
    }
  }

  // Final stats
  const finalStats = await getFullTextCacheStats();
  const duration = Date.now() - startTime;

  logger.info('='.repeat(60));
  logger.info('BACKFILL COMPLETE');
  logger.info('='.repeat(60));
  logger.info(`Duration: ${(duration / 1000).toFixed(1)}s (${(duration / 60000).toFixed(1)} minutes)`);
  logger.info(`Items processed: ${items.length}`);
  logger.info(`  Successful: ${totalSuccessful}`);
  logger.info(`  Failed: ${totalFailed}`);
  logger.info(`Final state: ${finalStats.cached}/${finalStats.total} items have full text`);
  logger.info(`  Improvement: +${finalStats.cached - initialStats.cached} items`);
  logger.info(`  By source: ${JSON.stringify(finalStats.bySource)}`);
  logger.info('='.repeat(60));

  return {
    total: finalStats.total,
    needsText: items.length,
    processed: items.length,
    successful: totalSuccessful,
    failed: totalFailed,
    skipped: 0,
    duration,
  };
}

async function main() {
  try {
    // Initialize database connection
    await initializeDatabase();

    // Verify we're using production database
    const driver = detectDriver();
    if (driver === 'sqlite') {
      logger.warn('WARNING: Using SQLite database. For production backfill, set DATABASE_URL.');
      logger.warn('Continuing with SQLite...');
    }

    // Run backfill
    await backfillFullText();

    logger.info('\n✅ Backfill complete!');
    process.exit(0);
  } catch (error) {
    logger.error('Backfill failed', { error });
    process.exit(1);
  }
}

main();
