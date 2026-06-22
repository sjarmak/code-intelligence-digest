#!/usr/bin/env tsx
/**
 * Hourly sync cron job script
 *
 * This script is designed to run hourly via Render cron job service.
 * It:
 * 1. Runs the hourly sync to fetch new items from Inoreader (last 4 hours)
 * 2. Populates full text for items without it (research, tech articles, AI news)
 * 3. Populates embeddings for newly synced items (last 7 days)
 *
 * Usage:
 *   npm run cron:daily   (recommended: caps Node heap at 460MB to stay under Render 512MB container)
 *   npx tsx scripts/cron-daily-sync.ts
 *
 * Environment variables required:
 *   - DATABASE_URL (PostgreSQL connection string in production)
 *   - INOREADER_CLIENT_ID
 *   - INOREADER_CLIENT_SECRET
 *   - INOREADER_REFRESH_TOKEN
 *   - OPENAI_API_KEY (for embeddings)
 *   - ADS_API_TOKEN (for research paper sync from ADS)
 *
 * Expected API usage: 1-2 calls per sync (24-48 calls/day out of 1000 quota)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { runDailySync } from '../src/lib/sync/daily-sync';
import { loadItemsByCategory } from '../src/lib/db/items';
import { getEmbeddingsBatch } from '../src/lib/db/embeddings';
import { generateEmbeddingsBatch } from '../src/lib/embeddings/generate';
import { saveEmbeddingsBatch } from '../src/lib/db/embeddings';
import { logger } from '../src/lib/logger';
import type { Category, FeedItem } from '../src/lib/model';

const RECENT_DAYS_FOR_EMBEDDINGS = 7; // Only generate embeddings for items from last 7 days
const MAX_EMBEDDINGS_PER_RUN = 100; // Cap per run to stay under 512MB container on Render cron

const ACTIVE_HOURS_START = 7; // 7 AM ET
const ACTIVE_HOURS_END = 22; // 10 PM ET
const OFF_HOURS_RUNS = [1, 4]; // 1 AM and 4 AM ET

function getHourInTimeZone(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: 'numeric',
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === 'hour')?.value;
  const hour = hourPart ? Number.parseInt(hourPart, 10) : Number.NaN;
  return Number.isFinite(hour) ? hour : date.getHours();
}

function isWithinActiveHours(hour: number): boolean {
  return hour >= ACTIVE_HOURS_START && hour <= ACTIVE_HOURS_END;
}

/**
 * Run hourly during active hours (7 AM - 10 PM ET).
 * Off-hours: only run at 1 AM and 4 AM ET to minimize Inoreader API calls.
 */
function shouldRunCronNow(date: Date): { shouldRun: boolean; reason: string } {
  const hourET = getHourInTimeZone(date, 'America/New_York');

  if (isWithinActiveHours(hourET)) {
    return {
      shouldRun: true,
      reason: `active hours (ET=${hourET})`,
    };
  }

  // Off-hours: only run at specific times (1 AM and 4 AM ET)
  const shouldRun = OFF_HOURS_RUNS.includes(hourET);
  return {
    shouldRun,
    reason: shouldRun
      ? `off-hours scheduled run (ET=${hourET})`
      : `off-hours (skipping) (ET=${hourET})`,
  };
}

const RECENT_DAYS_FOR_FULLTEXT = 7;
const FULLTEXT_ITEMS_PER_RUN = 8; // Keep low to stay under 512MB container (JSDOM/Readability are heavy)

interface Stats {
  sync: {
    success: boolean;
    itemsAdded: number;
    apiCallsUsed: number;
    paused: boolean;
    error?: string;
  };
  fulltext: {
    fetched: number;
    successful: number;
    failed: number;
    duration: number;
  };
  embeddings: {
    totalChecked: number;
    skipped: number;
    generated: number;
    failed: number;
    duration: number;
  };
}

async function populateEmbeddingsForRecentItems(): Promise<Stats['embeddings']> {
  const startTime = Date.now();
  const stats: Stats['embeddings'] = {
    totalChecked: 0,
    skipped: 0,
    generated: 0,
    failed: 0,
    duration: 0,
  };

  logger.info(`\n📊 Populating embeddings for items from last ${RECENT_DAYS_FOR_EMBEDDINGS} days...`);

  const categories: Category[] = [
    'newsletters',
    'podcasts',
    'tech_articles',
    'ai_news',
    'product_news',
    'community',
    'research',
  ];

  // Process one category at a time to avoid loading all items (with full_text) into memory (OOM on Render cron)
  let totalNeedingEmbeddings = 0;
  let remainingCap = MAX_EMBEDDINGS_PER_RUN;

  for (const category of categories) {
    if (remainingCap <= 0) {
      logger.info(`  Cap reached (${MAX_EMBEDDINGS_PER_RUN}), skipping remaining categories for this run`);
      break;
    }

    let items: FeedItem[];
    try {
      items = await loadItemsByCategory(category, RECENT_DAYS_FOR_EMBEDDINGS);
    } catch (error) {
      logger.error(`Failed to load items for category ${category}`, error);
      continue;
    }

    stats.totalChecked += items.length;
    if (items.length === 0) continue;

    const itemIds = items.map((item) => item.id);
    const existingEmbeddings = await getEmbeddingsBatch(itemIds);
    const itemsNeedingEmbeddings = items.filter((item) => !existingEmbeddings.has(item.id));
    stats.skipped += items.length - itemsNeedingEmbeddings.length;

    if (itemsNeedingEmbeddings.length === 0) {
      logger.info(`  ${category}: all ${items.length} already have embeddings`);
      continue;
    }

    totalNeedingEmbeddings += itemsNeedingEmbeddings.length;
    const toProcess = itemsNeedingEmbeddings.slice(0, remainingCap);
    remainingCap -= toProcess.length;

    const itemsForEmbedding = toProcess.map((item) => {
      const fullText = item.fullText ? item.fullText.substring(0, 2000) : '';
      const text = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''} ${fullText}`.trim();
      return { id: item.id, text: text || item.title };
    });

    logger.info(`  ${category}: generating embeddings for ${itemsForEmbedding.length} items (${itemsNeedingEmbeddings.length - itemsForEmbedding.length} deferred)`);

    try {
      const embeddings = await generateEmbeddingsBatch(itemsForEmbedding);
      const embeddingsToSave = Array.from(embeddings.entries())
        .map(([itemId, embedding]) => {
          // Only accept genuine 1536d OpenAI vectors — never pad a smaller
          // vector up to 1536 (that fabricates non-unit-norm garbage that
          // poisons cosine results). Local 768d nomic vectors go to
          // item_model_embeddings via a separate job, not here.
          if (embedding.length === 1536) {
            return { itemId, embedding };
          }
          logger.warn(`Invalid embedding dimension (${embedding.length}) for item ${itemId}, skipping`);
          return null;
        })
        .filter((item): item is { itemId: string; embedding: number[] } => item !== null);

      stats.generated += embeddingsToSave.length;
      stats.failed += itemsForEmbedding.length - embeddingsToSave.length;

      if (embeddingsToSave.length > 0) {
        await saveEmbeddingsBatch(embeddingsToSave);
        logger.info(`  ✅ Saved ${embeddingsToSave.length} embeddings for ${category}`);
      }
    } catch (error) {
      logger.error(`Failed to generate embeddings for category ${category}`, error);
      stats.failed += itemsForEmbedding.length;
    }
  }

  if (totalNeedingEmbeddings > 0) {
    logger.info(`  ${stats.skipped} already had embeddings, ${stats.generated} generated, ${stats.failed} failed`);
  } else if (stats.totalChecked > 0) {
    logger.info('✅ All recent items already have embeddings');
  }

  stats.duration = Date.now() - startTime;
  return stats;
}

async function populateFullTextForRecentItems(): Promise<Stats['fulltext']> {
  const startTime = Date.now();
  const stats: Stats['fulltext'] = {
    fetched: 0,
    successful: 0,
    failed: 0,
    duration: 0,
  };

  try {
    const { fetchFullTextBatch } = await import('../src/lib/pipeline/fulltext');
    const { saveFullText, saveExtractedUrl } = await import('../src/lib/db/items');

    const priorityCategories: Category[] = ['research', 'tech_articles', 'ai_news', 'newsletters'];
    const itemsToFetch: FeedItem[] = [];

    for (const category of priorityCategories) {
      const items = await loadItemsByCategory(category, RECENT_DAYS_FOR_FULLTEXT);
      const withoutFullText = items.filter(
        (item) => !item.fullText || (item.fullText?.length ?? 0) < 100
      );
      itemsToFetch.push(...withoutFullText);
      if (itemsToFetch.length >= FULLTEXT_ITEMS_PER_RUN) break;
    }

    const batch = itemsToFetch.slice(0, FULLTEXT_ITEMS_PER_RUN);
    if (batch.length === 0) {
      logger.info('✅ All recent items already have full text');
      stats.duration = Date.now() - startTime;
      return stats;
    }

    logger.info(`\n📄 Populating full text for ${batch.length} items...`);
    // maxConcurrent=1 to minimize memory (JSDOM/Readability per page is heavy; stay under 512MB)
    const results = await fetchFullTextBatch(batch, 1);
    stats.fetched = results.size;

    for (const [itemId, result] of results.entries()) {
      try {
        await saveFullText(itemId, result.text, result.source);
        if (result.archivedUrl) {
          await saveExtractedUrl(itemId, result.archivedUrl).catch(() => {});
        }
        if (result.source !== 'error' && result.text.length > 100) {
          stats.successful++;
        } else {
          stats.failed++;
        }
      } catch {
        stats.failed++;
      }
    }

    logger.info(`  Full text: ${stats.successful} successful, ${stats.failed} failed`);
  } catch (error) {
    logger.error('Failed to populate full text', error);
  }

  stats.duration = Date.now() - startTime;
  return stats;
}

async function main() {
  const overallStartTime = Date.now();
  const stats: Stats = {
    sync: {
      success: false,
      itemsAdded: 0,
      apiCallsUsed: 0,
      paused: false,
    },
    fulltext: {
      fetched: 0,
      successful: 0,
      failed: 0,
      duration: 0,
    },
    embeddings: {
      totalChecked: 0,
      skipped: 0,
      generated: 0,
      failed: 0,
      duration: 0,
    },
  };

  try {
    logger.info('🔄 Starting hourly sync cron job...');
    logger.info(`Started at: ${new Date().toISOString()}`);

    const now = new Date();
    const gate = shouldRunCronNow(now);
    if (!gate.shouldRun) {
      logger.info(`⏭️  Skipping cron run: ${gate.reason}`);
      return;
    }

    logger.info(`⏱️  Running cron: ${gate.reason}`);

    // Step 1: Initialize database
    logger.info('\n📦 Initializing database...');
    await initializeDatabase();
    logger.info('✅ Database initialized');

    // A previously-paused sync resumes from its persisted continuation token
    // inside runDailySync. We intentionally do NOT clear it here: clearing would
    // discard the continuation and restart pagination from page 1 (bd-kc1).
    // Retry timing is now governed by the sync circuit breaker
    // (src/lib/sync/sync-backoff), which backs off and auto-recovers.
    const { loadSyncState } = await import('../src/lib/sync/daily-sync');
    const existingState = await loadSyncState();
    if (existingState?.status === 'paused') {
      logger.warn(`⚠️  Previous sync was paused: ${existingState.error}`);
      logger.info(`🔄 Will resume from saved continuation token (no page-1 restart).`);
    }

    // Step 2: Run hourly sync (fetches last 4 hours)
    // The sync will automatically detect and resume paused state if it exists
    logger.info('\n🔄 Running hourly sync...');
    const syncResult = await runDailySync();

    stats.sync = {
      success: syncResult.success,
      itemsAdded: syncResult.itemsAdded,
      apiCallsUsed: syncResult.apiCallsUsed,
      paused: syncResult.paused,
      error: syncResult.error,
    };

    if (syncResult.success) {
      logger.info(`✅ Sync completed: ${syncResult.itemsAdded} items added, ${syncResult.apiCallsUsed} API calls used`);
    } else if (syncResult.paused) {
      logger.warn(`⏸️  Sync paused: ${syncResult.itemsAdded} items added, ${syncResult.apiCallsUsed} calls used. ${syncResult.error || 'Will resume tomorrow.'}`);
    } else {
      logger.error(`❌ Sync failed: ${syncResult.error}`);
    }

    // Step 3: Score any missing items (critical - all items MUST have scores)
    if (syncResult.itemsAdded > 0 || !syncResult.paused) {
      logger.info('\n📊 Checking for items missing scores...');
      try {
        const { computeAndSaveScoresForItems } = await import('../src/lib/pipeline/compute-scores');
        const { getDbClient } = await import('../src/lib/db/driver');
        const { loadItemsByCategory } = await import('../src/lib/db/items');

        const client = await getDbClient();
        const categories: Category[] = ['newsletters', 'podcasts', 'tech_articles', 'ai_news', 'product_news', 'community', 'research'];
        const cutoffTime = Math.floor((Date.now() - 7 * 24 * 60 * 60 * 1000) / 1000); // Last 7 days
        const SCORE_MISSING_LIMIT = 40; // Per category per run to avoid OOM (full_text is heavy)

        let totalScored = 0;
        for (const category of categories) {
          const whereClause = category === 'newsletters'
            ? `i.category = ? AND i.id LIKE '%-article-%' AND i.created_at >= ?`
            : `i.category = ? AND i.created_at >= ?`;

          const result = await client.query(
            `SELECT i.* FROM items i
             LEFT JOIN item_scores s ON i.id = s.item_id
             WHERE ${whereClause}
             AND s.item_id IS NULL
             ORDER BY i.created_at DESC LIMIT ${SCORE_MISSING_LIMIT}`,
            [category, cutoffTime]
          );

          if (result.rows.length > 0) {
            logger.info(`  Found ${result.rows.length} items without scores in ${category}, scoring...`);
            // Map to FeedItem format and score
            const items = result.rows.map((row: any) => ({
              id: row.id,
              streamId: row.stream_id,
              sourceTitle: row.source_title,
              title: row.title,
              url: row.extracted_url || row.url,
              author: row.author || undefined,
              publishedAt: new Date(row.published_at * 1000),
              createdAt: row.created_at ? new Date(row.created_at * 1000) : undefined,
              summary: row.summary || undefined,
              contentSnippet: row.content_snippet || undefined,
              categories: JSON.parse(row.categories),
              category: row.category,
              raw: {},
              fullText: row.full_text || undefined,
            }));

            const scoreResult = await computeAndSaveScoresForItems(items);
            totalScored += scoreResult.totalScored;
            logger.info(`  ✅ Scored ${scoreResult.totalScored} items in ${category}`);
          }
        }

        if (totalScored > 0) {
          logger.info(`✅ Scored ${totalScored} missing items total`);
        } else {
          logger.info('✅ All items already have scores');
        }
      } catch (error) {
        logger.error('Failed to score missing items', error);
        // Don't fail the cron job if this fails
      }
    }

    // Step 4: Populate full text for recent items
    if (syncResult.itemsAdded > 0 || !syncResult.paused) {
      logger.info('\n📄 Populating full text for recent items...');
      stats.fulltext = await populateFullTextForRecentItems();
    } else {
      logger.info('\n⏭️  Skipping full text population (sync was paused)');
    }

    // Step 5: Populate embeddings for recent items
    if (syncResult.itemsAdded > 0 || !syncResult.paused) {
      logger.info('\n🧮 Populating embeddings for recent items...');
      stats.embeddings = await populateEmbeddingsForRecentItems();
    } else {
      logger.info('\n⏭️  Skipping embedding population (sync was paused)');
    }

    // Print summary
    const totalDuration = Date.now() - overallStartTime;
    console.log('\n' + '='.repeat(60));
    console.log('📊 Hourly Sync Cron Job Summary');
    console.log('='.repeat(60));
    console.log(`Sync Status:        ${stats.sync.success ? '✅ Success' : stats.sync.paused ? '⏸️  Paused' : '❌ Failed'}`);
    console.log(`Items Added:        ${stats.sync.itemsAdded}`);
    console.log(`API Calls Used:     ${stats.sync.apiCallsUsed}/1000`);
    if (stats.sync.error) {
      console.log(`Sync Error:         ${stats.sync.error}`);
    }
    console.log(`\nFull Text Fetched:   ${stats.fulltext.fetched}`);
    console.log(`Full Text Success:   ${stats.fulltext.successful}`);
    console.log(`Full Text Failed:    ${stats.fulltext.failed}`);
    console.log(`Full Text Duration:  ${(stats.fulltext.duration / 1000).toFixed(1)}s`);
    console.log(`\nEmbeddings Checked:  ${stats.embeddings.totalChecked}`);
    console.log(`Embeddings Skipped:  ${stats.embeddings.skipped} (already exist)`);
    console.log(`Embeddings Generated: ${stats.embeddings.generated}`);
    console.log(`Embeddings Failed:   ${stats.embeddings.failed}`);
    console.log(`Embedding Duration:  ${(stats.embeddings.duration / 1000).toFixed(1)}s`);
    console.log(`\nTotal Duration:      ${(totalDuration / 1000).toFixed(1)}s`);
    console.log('='.repeat(60) + '\n');

    // Exit with error code if sync failed (not if paused)
    if (!stats.sync.success && !stats.sync.paused) {
      logger.error('❌ Cron job failed due to sync failure');
      process.exit(1);
    }

    logger.info('✅ Hourly sync cron job completed successfully');
  } catch (error) {
    logger.error('❌ Cron job failed with error', error);
    console.error('\n❌ Cron job failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in cron job', error);
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}
