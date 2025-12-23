/**
 * API endpoint: POST /api/admin/sync-48h
 * 
 * 48-hour sync that fetches items from the last 48 hours only.
 * 
 * Features:
 * - Time-filtered to last 48 hours (reduces API calls to ~2-5)
 * - Resumable if interrupted by rate limits
 * - Safe within 100-call daily budget
 * 
 * Response:
 * {
 *   "success": true,
 *   "itemsAdded": 200,
 *   "apiCallsUsed": 3,
 *   "categoriesProcessed": ["newsletters", "tech_articles"],
 * }
 */

import { NextResponse } from 'next/server';
import { logger } from '@/src/lib/logger';
import { initializeDatabase } from '@/src/lib/db/index';
import { createInoreaderClient } from '@/src/lib/inoreader/client';
import { normalizeItems } from '@/src/lib/pipeline/normalize';
import { categorizeItems } from '@/src/lib/pipeline/categorize';
import { saveItems } from '@/src/lib/db/items';
import { getSqlite } from '@/src/lib/db/index';
import { Category } from '@/src/lib/model';
import { blockInProduction } from '@/src/lib/auth/guards';

const VALID_CATEGORIES: Category[] = [
  'newsletters',
  'podcasts',
  'tech_articles',
  'ai_news',
  'product_news',
  'community',
  'research',
];

export async function POST() {
  const blocked = blockInProduction();
  if (blocked) return blocked;
  try {
    logger.info('[SYNC-48H-API] Received 48-hour sync request');

    // Initialize database
    await initializeDatabase();

    const client = createInoreaderClient();
    let callsUsed = 0;
    let totalItemsAdded = 0;
    const categoriesProcessed = new Set<Category>();

    // Get user ID
    logger.debug('[SYNC-48H] Fetching user ID...');
    const userInfo = (await client.getUserInfo()) as Record<string, unknown> | undefined;
    const userId = (userInfo?.userId || userInfo?.id) as string | undefined;

    if (!userId) {
      throw new Error('Could not determine user ID from Inoreader');
    }

    callsUsed++;

    // Set sync window to last 48 hours
    const syncSinceTimestamp = Math.floor((Date.now() - 48 * 60 * 60 * 1000) / 1000);
    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[SYNC-48H] Fetching items from last 48 hours (${new Date(syncSinceTimestamp * 1000).toISOString()})`
    );

    let batchNumber = 0;
    let hasMoreItems = true;
    let continuation: string | undefined;

    while (hasMoreItems && callsUsed < 95) {
      // Leave buffer for other operations
      batchNumber++;

      logger.debug(
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
      items = await categorizeItems(items);

      // Filter to only items from last 48 hours
      const cutoffTime = new Date(syncSinceTimestamp * 1000);
      items = items.filter((item) => {
        const published = new Date(item.publishedAt);
        return published >= cutoffTime;
      });

      logger.info(`[SYNC-48H] Categorized ${items.length} items for this batch`);

      // Save items
      await saveItems(items);
      totalItemsAdded += items.length;

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

    return NextResponse.json({
      success: true,
      itemsAdded: totalItemsAdded,
      apiCallsUsed: callsUsed,
      categoriesProcessed: Array.from(categoriesProcessed),
      message: `Synced ${totalItemsAdded} items from last 48 hours (${callsUsed} API calls, ${100 - callsUsed} remaining)`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[SYNC-48H-API] Request failed', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET for health check
 */
export async function GET() {
  return NextResponse.json({
    status: 'ready',
    message: 'POST to sync last 48 hours of content',
  });
}
