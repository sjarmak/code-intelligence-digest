/**
 * Periodic sync from Inoreader API to database
 * Decouples data retrieval from request path
 *
 * This runs periodically (scheduled job) and pulls fresh data from Inoreader,
 * saving it to the database. Read requests always hit the database cache.
 */

import { createInoreaderClient } from '../inoreader/client';
import { getStreamsByCategory } from '@/src/config/feeds';
import { normalizeItems } from '../pipeline/normalize';
import { categorizeItems } from '../pipeline/categorize';
import { decomposeFeedItems } from '../pipeline/decompose';
import { saveItems } from '../db/items';
import { logger } from '../logger';
import { Category, FeedItem } from '../model';

const VALID_CATEGORIES: Category[] = [
  'newsletters',
  'podcasts',
  'tech_articles',
  'ai_news',
  'product_news',
  'community',
  'research',
];

/**
 * Sync all items from Inoreader for all categories
 * Call this periodically from a cron job or scheduled task
 */
export async function syncAllCategories(): Promise<{
  success: boolean;
  categoriesProcessed: Category[];
  itemsAdded: number;
  errors: Array<{ category: Category; error: string }>;
}> {
  const errors: Array<{ category: Category; error: string }> = [];
  const categoriesProcessed: Category[] = [];
  let totalItemsAdded = 0;

  logger.info('Starting full Inoreader sync for all categories');

  for (const category of VALID_CATEGORIES) {
    try {
      const result = await syncCategory(category);
      categoriesProcessed.push(category);
      totalItemsAdded += result.itemsAdded;
      logger.info(
        `Synced category: ${category}, added: ${result.itemsAdded} items`
      );
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error(`Failed to sync category: ${category}`, error);
      errors.push({ category, error: errorMsg });
    }
  }

  logger.info(
    `Sync completed: ${categoriesProcessed.length}/${VALID_CATEGORIES.length} categories, ${totalItemsAdded} total items added`
  );

  return {
    success: errors.length === 0,
    categoriesProcessed,
    itemsAdded: totalItemsAdded,
    errors,
  };
}

/**
 * Sync a single category from Inoreader
 */
export async function syncCategory(category: Category): Promise<{
  itemsAdded: number;
  itemsSkipped: number;
}> {
  logger.info(`Syncing category: ${category}`);

  // Get all streams for this category
  const streamIds = await getStreamsByCategory(category);
  if (streamIds.length === 0) {
    logger.warn(`No streams configured for category: ${category}`);
    return { itemsAdded: 0, itemsSkipped: 0 };
  }

  logger.debug(
    `Found ${streamIds.length} streams for category: ${category}`
  );

  // Create Inoreader client
  const client = createInoreaderClient();

  // Fetch items from all streams
  const allItems = [];
  let itemsSkipped = 0;

  for (const streamId of streamIds) {
    try {
      logger.debug(`Fetching stream: ${streamId}`);
      const response = await client.getStreamContents(streamId, { n: 100 });
      allItems.push(...response.items);
      logger.debug(`Fetched ${response.items.length} items from ${streamId}`);
    } catch (error) {
      logger.error(`Failed to fetch stream ${streamId}`, error);
      // Continue with other streams on error - don't fail the whole sync
    }
  }

  if (allItems.length === 0) {
    logger.warn(`No items fetched for category: ${category}`);
    return { itemsAdded: 0, itemsSkipped: 0 };
  }

  logger.info(`Fetched ${allItems.length} total items from Inoreader`);

  // Normalize items
  let items = await normalizeItems(allItems);
  logger.debug(`Normalized ${items.length} items`);

  // Decompose newsletter items into individual articles (before categorization)
  // This ensures articles from newsletters are available via /api/items
  items = decomposeFeedItems(items);
  logger.debug(`After decomposition: ${items.length} items`);

  // Categorize items
  items = categorizeItems(items);

  // After decomposition, items may have been re-categorized (e.g., newsletter articles -> ai_news, product_news)
  // Save ALL items regardless of their final category, not just the original category
  // This ensures decomposed articles appear in their correct categories
  const itemsByCategory = new Map<Category, FeedItem[]>();
  for (const item of items) {
    if (!itemsByCategory.has(item.category)) {
      itemsByCategory.set(item.category, []);
    }
    itemsByCategory.get(item.category)!.push(item);
  }

  // Log category distribution
  for (const [cat, catItems] of itemsByCategory.entries()) {
    logger.info(`Items in category ${cat}: ${catItems.length}`);
  }

  // Filter to items in this category (for return value)
  const categoryItems = items.filter((i) => i.category === category);

  // Save ALL items to database (they'll be stored with their final categories)
  // This is important because decomposed articles may have been re-categorized
  try {
    await saveItems(items);
    logger.info(
      `Saved ${items.length} total items to database (${categoryItems.length} in requested category: ${category})`
    );
  } catch (error) {
    logger.error(`Failed to save items for category: ${category}`, error);
    throw error;
  }

  itemsSkipped = allItems.length - categoryItems.length;
  return { itemsAdded: categoryItems.length, itemsSkipped };
}

/**
 * Sync a single stream from Inoreader
 * Useful for incremental updates or manual triggering
 */
export async function syncStream(
  streamId: string
): Promise<{ itemsAdded: number }> {
  logger.info(`Syncing stream: ${streamId}`);

  const client = createInoreaderClient();

  try {
    const response = await client.getStreamContents(streamId, { n: 100 });
    logger.debug(`Fetched ${response.items.length} items from ${streamId}`);

    if (response.items.length === 0) {
      return { itemsAdded: 0 };
    }

    // Normalize and categorize
    let items = await normalizeItems(response.items);
    items = categorizeItems(items);

    // Save all items (they've been categorized)
    await saveItems(items);

    logger.info(`Synced ${items.length} items for stream: ${streamId}`);
    return { itemsAdded: items.length };
  } catch (error) {
    logger.error(`Failed to sync stream: ${streamId}`, error);
    throw error;
  }
}
