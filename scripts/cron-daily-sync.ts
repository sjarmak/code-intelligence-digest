#!/usr/bin/env tsx
/**
 * Daily sync cron job script
 *
 * This script is designed to run daily via Render cron job service.
 * It:
 * 1. Runs the daily sync to fetch new items from Inoreader
 * 2. Populates embeddings for newly synced items (last 7 days)
 *
 * Usage:
 *   npx tsx scripts/cron-daily-sync.ts
 *
 * Environment variables required:
 *   - DATABASE_URL (PostgreSQL connection string in production)
 *   - INOREADER_CLIENT_ID
 *   - INOREADER_CLIENT_SECRET
 *   - INOREADER_REFRESH_TOKEN
 *   - OPENAI_API_KEY (for embeddings)
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

interface Stats {
  sync: {
    success: boolean;
    itemsAdded: number;
    apiCallsUsed: number;
    paused: boolean;
    error?: string;
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

  // Load recent items from all categories
  const categories: Category[] = [
    'newsletters',
    'podcasts',
    'tech_articles',
    'ai_news',
    'product_news',
    'community',
    'research',
  ];

  const allRecentItems: FeedItem[] = [];
  for (const category of categories) {
    try {
      const items = await loadItemsByCategory(category, RECENT_DAYS_FOR_EMBEDDINGS);
      allRecentItems.push(...items);
      logger.info(`  Loaded ${items.length} items from ${category}`);
    } catch (error) {
      logger.error(`Failed to load items for category ${category}`, error);
    }
  }

  stats.totalChecked = allRecentItems.length;

  if (allRecentItems.length === 0) {
    logger.info('No recent items found, skipping embedding generation');
    stats.duration = Date.now() - startTime;
    return stats;
  }

  // Check which items already have embeddings
  const itemIds = allRecentItems.map(item => item.id);
  const existingEmbeddings = await getEmbeddingsBatch(itemIds);
  const itemsNeedingEmbeddings = allRecentItems.filter(item => !existingEmbeddings.has(item.id));

  stats.skipped = allRecentItems.length - itemsNeedingEmbeddings.length;
  logger.info(`  ${stats.skipped} items already have embeddings, ${itemsNeedingEmbeddings.length} need embeddings`);

  if (itemsNeedingEmbeddings.length === 0) {
    logger.info('✅ All recent items already have embeddings');
    stats.duration = Date.now() - startTime;
    return stats;
  }

  // Prepare items for batch embedding generation
  const itemsForEmbedding = itemsNeedingEmbeddings.map(item => {
    const fullText = item.fullText ? item.fullText.substring(0, 2000) : '';
    const text = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''} ${fullText}`.trim();
    return {
      id: item.id,
      text: text || item.title,
    };
  });

  logger.info(`Generating embeddings for ${itemsForEmbedding.length} items...`);

  try {
    // Generate embeddings in batch
    const embeddings = await generateEmbeddingsBatch(itemsForEmbedding);

    // Convert to format for saving
    const embeddingsToSave = Array.from(embeddings.entries())
      .map(([itemId, embedding]) => {
        // Ensure 1536 dimensions
        if (embedding.length === 1536) {
          return { itemId, embedding };
        } else if (embedding.length === 768) {
          // Pad 768-dim to 1536
          const padded = new Array(1536);
          for (let i = 0; i < 1536; i++) {
            padded[i] = embedding[i % 768] * (i < 768 ? 1 : 0.5);
          }
          return { itemId, embedding: padded };
        } else {
          logger.warn(`Invalid embedding dimension (${embedding.length}) for item ${itemId}`);
          return null;
        }
      })
      .filter((item): item is { itemId: string; embedding: number[] } => item !== null);

    stats.generated = embeddingsToSave.length;
    stats.failed = itemsNeedingEmbeddings.length - embeddingsToSave.length;

    // Save embeddings to database
    if (embeddingsToSave.length > 0) {
      logger.info(`Saving ${embeddingsToSave.length} embeddings to database...`);
      await saveEmbeddingsBatch(embeddingsToSave);
      logger.info(`✅ Saved ${embeddingsToSave.length} embeddings`);
    }

    if (stats.failed > 0) {
      logger.warn(`⚠️  Failed to generate ${stats.failed} embeddings`);
    }
  } catch (error) {
    logger.error('Failed to generate embeddings', error);
    stats.failed = itemsNeedingEmbeddings.length;
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
    embeddings: {
      totalChecked: 0,
      skipped: 0,
      generated: 0,
      failed: 0,
      duration: 0,
    },
  };

  try {
    logger.info('🔄 Starting daily sync cron job...');
    logger.info(`Started at: ${new Date().toISOString()}`);

    // Step 1: Initialize database
    logger.info('\n📦 Initializing database...');
    await initializeDatabase();
    logger.info('✅ Database initialized');

    // Step 2: Run daily sync
    logger.info('\n🔄 Running daily sync...');
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

    // Step 3: Populate embeddings for recent items (even if sync was paused)
    if (syncResult.itemsAdded > 0 || !syncResult.paused) {
      logger.info('\n🧮 Populating embeddings for recent items...');
      stats.embeddings = await populateEmbeddingsForRecentItems();
    } else {
      logger.info('\n⏭️  Skipping embedding population (sync was paused)');
    }

    // Print summary
    const totalDuration = Date.now() - overallStartTime;
    console.log('\n' + '='.repeat(60));
    console.log('📊 Daily Sync Cron Job Summary');
    console.log('='.repeat(60));
    console.log(`Sync Status:        ${stats.sync.success ? '✅ Success' : stats.sync.paused ? '⏸️  Paused' : '❌ Failed'}`);
    console.log(`Items Added:        ${stats.sync.itemsAdded}`);
    console.log(`API Calls Used:     ${stats.sync.apiCallsUsed}/100`);
    if (stats.sync.error) {
      console.log(`Sync Error:         ${stats.sync.error}`);
    }
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

    logger.info('✅ Daily sync cron job completed successfully');
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
