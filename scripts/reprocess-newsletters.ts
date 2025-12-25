#!/usr/bin/env tsx
/**
 * Reprocess newsletter items to fix URL extraction issues
 *
 * This script:
 * 1. Loads all newsletter items from the database
 * 2. Re-decomposes them using the improved URL validation logic
 * 3. Saves the updated items back to the database
 *
 * Usage:
 *   npx tsx scripts/reprocess-newsletters.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { loadAllItems, saveItems } from '../src/lib/db/items';
import { decomposeNewsletterItems } from '../src/lib/pipeline/decompose';
import { isNewsletterSource } from '../src/lib/pipeline/decompose';
import { logger } from '../src/lib/logger';
import type { FeedItem, RankedItem } from '../src/lib/model';

const NEWSLETTER_SOURCES = ["TLDR", "Byte Byte Go", "Pointer", "Substack", "Elevate", "Architecture Notes", "Leadership in Tech", "Programming Digest", "System Design"];

/**
 * Convert FeedItem to RankedItem (for decomposition processing)
 * Uses dummy scores since we're just reprocessing URLs
 */
function feedItemToRankedItem(item: FeedItem): RankedItem {
  return {
    ...item,
    bm25Score: 0.5,
    llmScore: {
      relevance: 5,
      usefulness: 5,
      tags: [],
    },
    recencyScore: 0.5,
    finalScore: 0.5,
    reasoning: "Reprocessed newsletter item",
  };
}

/**
 * Check if item ID is from a decomposed article (has -article- in ID)
 */
function isDecomposedArticleId(itemId: string): boolean {
  return itemId.includes('-article-');
}

/**
 * Extract original item ID from decomposed article ID
 * Example: "item-123-article-1" -> "item-123"
 */
function getOriginalItemId(decomposedId: string): string {
  const match = decomposedId.match(/^(.+)-article-\d+$/);
  return match ? match[1] : decomposedId;
}

async function main() {
  try {
    logger.info('🔄 Starting newsletter reprocessing...');

    // Initialize database
    await initializeDatabase();
    logger.info('✅ Database initialized');

    // Load all items from database
    logger.info('📥 Loading all items from database...');
    const allItems = await loadAllItems();
    logger.info(`   Loaded ${allItems.length} total items`);

    // Find original newsletter items (not decomposed articles)
    // Strategy: Find items that are from newsletter sources AND don't have -article- in their ID
    const originalNewsletterItems = allItems.filter(item => {
      const isNewsletter = isNewsletterSource(item.sourceTitle);
      const isDecomposed = isDecomposedArticleId(item.id);
      return isNewsletter && !isDecomposed;
    });

    logger.info(`📰 Found ${originalNewsletterItems.length} original newsletter items to reprocess`);

    if (originalNewsletterItems.length === 0) {
      logger.info('ℹ️  No newsletter items found to reprocess');
      return;
    }

    // Show sample of what we're processing
    logger.info('\n📋 Sample items to reprocess:');
    originalNewsletterItems.slice(0, 5).forEach((item, idx) => {
      logger.info(`   ${idx + 1}. ${item.sourceTitle}: "${item.title.substring(0, 50)}..."`);
      logger.info(`      ID: ${item.id}`);
      logger.info(`      URL: ${item.url}`);
    });

    // Convert to RankedItem format for decomposition
    const rankedItems = originalNewsletterItems.map(feedItemToRankedItem);

    // Re-decompose newsletters
    logger.info('\n🔄 Re-decomposing newsletter items with improved URL validation...');
    const decomposedItems = decomposeNewsletterItems(rankedItems);
    logger.info(`   Original: ${rankedItems.length} items`);
    logger.info(`   Decomposed: ${decomposedItems.length} items`);

    // Show sample of decomposed items
    logger.info('\n✨ Sample decomposed items:');
    decomposedItems.slice(0, 10).forEach((item, idx) => {
      logger.info(`   ${idx + 1}. "${item.title.substring(0, 50)}..."`);
      logger.info(`      URL: ${item.url}`);
      logger.info(`      ID: ${item.id}`);
    });

    // Convert RankedItem back to FeedItem for saving
    const feedItemsToSave: FeedItem[] = decomposedItems.map(item => ({
      id: item.id,
      streamId: item.streamId,
      sourceTitle: item.sourceTitle,
      title: item.title,
      url: item.url,
      author: item.author,
      publishedAt: item.publishedAt,
      summary: item.summary,
      contentSnippet: item.contentSnippet,
      categories: item.categories,
      category: item.category,
      raw: item.raw,
      fullText: item.fullText,
    }));

    // Save updated items to database
    // Note: saveItems uses ON CONFLICT UPDATE, so it will update existing items
    logger.info('\n💾 Saving reprocessed items to database...');
    await saveItems(feedItemsToSave);
    logger.info(`   ✅ Saved ${feedItemsToSave.length} items`);

    // Count items with valid vs invalid URLs
    const validUrls = feedItemsToSave.filter(item =>
      item.url &&
      (item.url.startsWith('http://') || item.url.startsWith('https://')) &&
      !item.url.includes('localhost')
    ).length;

    const invalidUrls = feedItemsToSave.length - validUrls;

    logger.info('\n📊 Summary:');
    logger.info(`   Original newsletter items: ${originalNewsletterItems.length}`);
    logger.info(`   Decomposed items: ${decomposedItems.length}`);
    logger.info(`   Items with valid URLs: ${validUrls}`);
    logger.info(`   Items with invalid/missing URLs: ${invalidUrls}`);

    logger.info('\n✅ Newsletter reprocessing completed successfully!');

  } catch (error) {
    logger.error('❌ Newsletter reprocessing failed', error);
    process.exit(1);
  }
}

main();


