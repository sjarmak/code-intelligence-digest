/**
 * Run 48-hour sync directly
 */

import { initializeDatabase } from '@/src/lib/db/index';
import { createInoreaderClient } from '@/src/lib/inoreader/client';
import { normalizeItems } from '@/src/lib/pipeline/normalize';
import { categorizeItems } from '@/src/lib/pipeline/categorize';
import { saveItems } from '@/src/lib/db/items';
import { logger } from '@/src/lib/logger';
import type { Category } from '@/src/lib/model';

const VALID_CATEGORIES: Category[] = [
  'newsletters',
  'podcasts',
  'tech_articles',
  'ai_news',
  'product_news',
  'community',
  'research',
];

async function run() {
  try {
    logger.info('[SYNC-48H] Starting 48-hour sync');

    // Initialize database
    await initializeDatabase();

    const client = createInoreaderClient();
    let callsUsed = 0;
    let totalItemsAdded = 0;
    const categoriesProcessed = new Set<Category>();

    // Get user ID
    logger.info('[SYNC-48H] Fetching user ID...');
    const userInfo = (await client.getUserInfo()) as Record<string, unknown> | undefined;
    const userId = (userInfo?.userId || userInfo?.id) as string | undefined;

    if (!userId) {
      throw new Error('Could not determine user ID from Inoreader');
    }

    callsUsed++;
    logger.info(`[SYNC-48H] User ID: ${userId}`);

    // Set sync window to last 48 hours
    const syncSinceTimestamp = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[SYNC-48H] Fetching items from last 48 hours (since ${new Date(syncSinceTimestamp * 1000).toISOString()})`
    );

    let batchNumber = 0;
    let hasMoreItems = true;
    let continuation: string | undefined;

    while (hasMoreItems && callsUsed < 95) {
      batchNumber++;

      logger.info(
        `[SYNC-48H] Fetching batch ${batchNumber}${continuation ? ' (continuation)' : ''} (${callsUsed} calls used)`
      );

      // Fetch batch
      const response = await client.getStreamContents(allItemsStreamId, {
        n: 1000,
        continuation,
        xt: `user/${userId}/state/com.google/read/unix:${syncSinceTimestamp}`,
      });

      callsUsed++;

      if (!response.items || response.items.length === 0) {
        logger.info('[SYNC-48H] No more items to fetch');
        hasMoreItems = false;
        break;
      }

      logger.info(
        `[SYNC-48H] Batch ${batchNumber}: fetched ${response.items.length} items (${callsUsed} calls used)`
      );

      // Normalize and categorize
      let items = await normalizeItems(response.items);
      logger.info(`[SYNC-48H] Normalized ${items.length} items`);
      
      items = await categorizeItems(items);
      logger.info(`[SYNC-48H] Categorized ${items.length} items`);

      // Save items
      if (items.length > 0) {
        logger.info(`[SYNC-48H] Saving ${items.length} items to database...`);
        try {
          await saveItems(items);
          logger.info(`[SYNC-48H] Successfully saved ${items.length} items`);
          totalItemsAdded += items.length;
        } catch (error) {
          logger.error(`[SYNC-48H] Failed to save items`, error);
          throw error;
        }
      } else {
        logger.info(`[SYNC-48H] No items to save in this batch`);
      }

      // Track categories
      items.forEach((item) => {
        categoriesProcessed.add(item.category);
      });

      // Continue if there are more items
      continuation = response.continuation;
      if (!continuation) {
        logger.info('[SYNC-48H] No continuation token, sync complete');
        hasMoreItems = false;
      }
    }

    logger.info(
      `[SYNC-48H] Completed: ${totalItemsAdded} items, ${callsUsed} API calls, categories: ${Array.from(categoriesProcessed).join(', ')}`
    );

    console.log('\n✓ Sync successful!');
    console.log(`  Items added: ${totalItemsAdded}`);
    console.log(`  API calls used: ${callsUsed}`);
    console.log(`  Categories: ${Array.from(categoriesProcessed).join(', ')}`);
  } catch (error) {
    logger.error('[SYNC-48H] Sync failed', error);
    console.error('\n✗ Sync failed:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

run();
