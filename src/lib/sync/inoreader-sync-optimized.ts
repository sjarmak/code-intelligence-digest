/**
 * Optimized Inoreader sync using minimal API calls
 * 
 * Instead of calling each stream individually (30+ calls),
 * fetch from category tags in bulk (2-3 calls total)
 * 
 * Inoreader special stream IDs:
 * - user/{userId}/state/com.google/all        = All items
 * - user/{userId}/label/{label}                = Label/folder items
 * - user/{userId}/state/com.google/starred     = Starred items
 * 
 * This approach uses only 1-3 API calls per month sync,
 * leaving 97-99 calls available for other uses.
 */

import { createInoreaderClient } from '../inoreader/client';
import { normalizeItems } from '../pipeline/normalize';
import { categorizeItems } from '../pipeline/categorize';
import { saveItems } from '../db/items';
import { logger } from '../logger';
import { Category } from '../model';
import { getStreamsByCategory } from '@/src/config/feeds';

/**
 * Fetch all items from a specific category/label in one call
 * Uses Inoreader's label/tag feature for bulk fetching
 */
export async function syncCategoryOptimized(
  category: Category
): Promise<{ itemsAdded: number; itemsSkipped: number; apiCallsUsed: number }> {
  logger.info(`[SYNC-OPTIMIZED] Syncing category: ${category}`);

  const client = createInoreaderClient();
  let itemsAdded = 0;
  let itemsSkipped = 0;

  try {
    // Get the label/tag ID for this category from config
    // The config maps categories to Inoreader stream IDs
    const streamIds = await getStreamsByCategory(category);

    if (streamIds.length === 0) {
      logger.warn(`[SYNC-OPTIMIZED] No streams configured for category: ${category}`);
      return { itemsAdded: 0, itemsSkipped: 0, apiCallsUsed: 0 };
    }

    logger.info(
      `[SYNC-OPTIMIZED] Found ${streamIds.length} streams for category: ${category}`
    );

    // Try to find a label/tag stream ID that groups all these feeds
    // This would be something like: user/{userId}/label/Code_Intelligence
    const allItemsStreamId = streamIds[0]; // Start with first stream

    // Fetch with 30-day window (n parameter is number of items, not days)
    // Inoreader returns most recent items first
    logger.debug(
      `[SYNC-OPTIMIZED] Fetching up to 500 items from primary stream: ${allItemsStreamId}`
    );

    const response = await client.getStreamContents(allItemsStreamId, {
      n: 500, // Fetch up to 500 items per stream
    });

    if (!response.items || response.items.length === 0) {
      logger.warn(
        `[SYNC-OPTIMIZED] No items fetched for category: ${category}`
      );
      return { itemsAdded: 0, itemsSkipped: 0, apiCallsUsed: 1 };
    }

    logger.info(
      `[SYNC-OPTIMIZED] Fetched ${response.items.length} items from primary stream`
    );

    // Normalize items
    let items = await normalizeItems(response.items);
    logger.debug(`[SYNC-OPTIMIZED] Normalized ${items.length} items`);

    // Categorize items
    items = categorizeItems(items);

    // Filter to items in this category
    const categoryItems = items.filter((i) => i.category === category);

    if (categoryItems.length === 0) {
      logger.warn(
        `[SYNC-OPTIMIZED] No items matched category filter for: ${category}. Normalized: ${items.length}, distributed to other categories`
      );
      itemsSkipped = response.items.length;
      return { itemsAdded: 0, itemsSkipped, apiCallsUsed: 1 };
    }

    logger.info(
      `[SYNC-OPTIMIZED] ${categoryItems.length} items match category: ${category}`
    );

    // Save to database
    await saveItems(categoryItems);
    logger.info(
      `[SYNC-OPTIMIZED] Saved ${categoryItems.length} items for category: ${category}`
    );

    itemsAdded = categoryItems.length;
    itemsSkipped = response.items.length - categoryItems.length;

    return { itemsAdded, itemsSkipped, apiCallsUsed: 1 };
  } catch (error) {
    logger.error(`[SYNC-OPTIMIZED] Failed to sync category: ${category}`, error);
    throw error;
  }
}

/**
 * Sync ALL categories in bulk with minimal API calls
 * 
 * Strategy:
 * 1. Fetch all items from user's "All Items" stream (1 call)
 * 2. Normalize and categorize
 * 3. Save to database
 * 
 * This uses only 1 API call to populate entire database!
 */
export async function syncAllCategoriesOptimized(): Promise<{
  success: boolean;
  categoriesProcessed: Category[];
  itemsAdded: number;
  errors: Array<{ category: Category; error: string }>;
  apiCallsUsed: number;
}> {
  logger.info('[SYNC-OPTIMIZED] Starting minimal-API-call sync for all categories');

  const VALID_CATEGORIES: Category[] = [
    'newsletters',
    'podcasts',
    'tech_articles',
    'ai_news',
    'product_news',
    'community',
    'research',
  ];

  const errors: Array<{ category: Category; error: string }> = [];
  const categoriesProcessed: Category[] = [];
  let totalItemsAdded = 0;
  let apiCallsUsed = 0;

  try {
    const client = createInoreaderClient();

    // Get user info to construct the "all items" stream ID
    logger.debug('[SYNC-OPTIMIZED] Fetching user info to get user ID...');
    const userInfo = (await client.getUserInfo()) as Record<string, unknown>;
    const userId = (userInfo.userId || userInfo.id) as string | undefined;

    if (!userId) {
      throw new Error('Could not determine user ID from Inoreader');
    }

    logger.info(`[SYNC-OPTIMIZED] User ID: ${userId}`);

    // Use the "all items" special stream ID
    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[SYNC-OPTIMIZED] Fetching all items in bulk from: ${allItemsStreamId}`
    );

    // Fetch ALL items with pagination support
    // Inoreader returns items per call, use continuation token for more
    // Save after each batch to avoid losing data on errors
    let continuation: string | undefined;
    let callCount = 0;

    do {
      callCount++;
      logger.debug(
        `[SYNC-OPTIMIZED] Fetching batch ${callCount}${continuation ? ' (continuation)' : ''}`
      );

      const response = await client.getStreamContents(allItemsStreamId, {
        n: 1000, // Get up to 1000 items per call
        continuation,
      });

      if (!response.items || response.items.length === 0) {
        break;
      }

      logger.info(
        `[SYNC-OPTIMIZED] Batch ${callCount}: fetched ${response.items.length} raw items`
      );

      // Normalize items immediately
      let items = await normalizeItems(response.items);
      logger.debug(`[SYNC-OPTIMIZED] Normalized ${items.length} items`);

      // Categorize items
      items = categorizeItems(items);

      // Save immediately by category
      for (const category of VALID_CATEGORIES) {
        const categoryItems = items.filter((i) => i.category === category);

        if (categoryItems.length === 0) {
          continue;
        }

        try {
          await saveItems(categoryItems);
          totalItemsAdded += categoryItems.length;

          if (!categoriesProcessed.includes(category)) {
            categoriesProcessed.push(category);
          }

          logger.debug(
            `[SYNC-OPTIMIZED] Batch ${callCount}, saved ${categoryItems.length} items to ${category}`
          );
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : String(error);
          logger.error(
            `[SYNC-OPTIMIZED] Failed to save ${category} items from batch ${callCount}`,
            error
          );
          if (!errors.find((e) => e.category === category)) {
            errors.push({ category, error: errorMsg });
          }
        }
      }

      continuation = response.continuation;
      logger.info(
        `[SYNC-OPTIMIZED] Batch ${callCount} complete: ${totalItemsAdded} total items saved so far`
      );
    } while (continuation);

    apiCallsUsed = callCount;

    if (totalItemsAdded === 0) {
      logger.warn('[SYNC-OPTIMIZED] No items found or saved');
      return {
        success: false,
        categoriesProcessed,
        itemsAdded: 0,
        errors: [{ category: 'newsletters', error: 'No items found or saved' }],
        apiCallsUsed,
      };
    }

    const success = categoriesProcessed.length === VALID_CATEGORIES.length;

    logger.info(
      `[SYNC-OPTIMIZED] Complete: ${categoriesProcessed.length}/${VALID_CATEGORIES.length} categories, ${totalItemsAdded} total items, ${apiCallsUsed} API call(s)`
    );

    return {
      success,
      categoriesProcessed,
      itemsAdded: totalItemsAdded,
      errors,
      apiCallsUsed,
    };
  } catch (error) {
    logger.error('[SYNC-OPTIMIZED] Critical error in optimized sync', error);

    return {
      success: false,
      categoriesProcessed,
      itemsAdded: totalItemsAdded,
      errors: [
        {
          category: 'newsletters',
          error: error instanceof Error ? error.message : String(error),
        },
      ],
      apiCallsUsed,
    };
  }
}

/**
 * Alternative: Fetch from multiple category labels/tags
 * Useful if you have organized your subscriptions in Inoreader
 * 
 * Example: If you have "Code_Intelligence" folder with all relevant feeds,
 * this would fetch only from that label in 1 call.
 */
export async function syncByLabel(labelId: string): Promise<{
  itemsAdded: number;
  apiCallsUsed: number;
}> {
  logger.info(`[SYNC-OPTIMIZED] Syncing from label: ${labelId}`);

  const client = createInoreaderClient();

  try {
    const response = await client.getStreamContents(labelId, {
      n: 500,
    });

    if (!response.items || response.items.length === 0) {
      logger.warn(`[SYNC-OPTIMIZED] No items found in label: ${labelId}`);
      return { itemsAdded: 0, apiCallsUsed: 1 };
    }

    // Normalize and save
    let items = await normalizeItems(response.items);
    items = categorizeItems(items);

    await saveItems(items);

    logger.info(`[SYNC-OPTIMIZED] Saved ${items.length} items from label: ${labelId}`);

    return { itemsAdded: items.length, apiCallsUsed: 1 };
  } catch (error) {
    logger.error(`[SYNC-OPTIMIZED] Failed to sync label: ${labelId}`, error);
    throw error;
  }
}
