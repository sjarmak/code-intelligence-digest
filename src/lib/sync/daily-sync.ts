/**
 * Daily sync strategy: fetch only recent items (last 30 days)
 * 
 * Features:
 * - Time-filtered to reduce API calls (only last 30 days)
 * - Resumable if interrupted by rate limits
 * - Tracks progress and continuation tokens
 * - Designed to fit within 100-call daily limit
 * 
 * Expected cost: 5-10 API calls per sync
 * Remaining budget: 90+ calls for other uses
 */

import { createInoreaderClient } from '../inoreader/client';
import { normalizeItems } from '../pipeline/normalize';
import { categorizeItems } from '../pipeline/categorize';
import { saveItems } from '../db/items';
import { logger } from '../logger';
import { Category } from '../model';
import { getSqlite } from '../db/index';

interface SyncStateRow {
  id: string;
  continuation_token: string | null;
  items_processed: number;
  calls_used: number;
  started_at: number;
  last_updated_at: number;
  status: string;
  error: string | null;
}

const VALID_CATEGORIES: Category[] = [
  'newsletters',
  'podcasts',
  'tech_articles',
  'ai_news',
  'product_news',
  'community',
  'research',
];

const SYNC_ID = 'daily-sync';
const DAYS_TO_FETCH = 30;

/**
 * Get current sync state from database
 */
function getSyncState(): SyncStateRow | null {
  try {
    const sqlite = getSqlite();
    const row = sqlite
      .prepare('SELECT * FROM sync_state WHERE id = ?')
      .get(SYNC_ID) as SyncStateRow | undefined;
    return row ?? null;
  } catch (error) {
    logger.warn('[DAILY-SYNC] Could not load sync state, starting fresh', error as Record<string, unknown>);
    return null;
  }
}

/**
 * Save sync state to resume later if interrupted
 */
function saveSyncState(data: {
  continuationToken?: string | null;
  itemsProcessed: number;
  callsUsed: number;
  status: 'in_progress' | 'completed' | 'paused';
  error?: string;
}): void {
  try {
    const sqlite = getSqlite();
    sqlite.prepare(`
      INSERT OR REPLACE INTO sync_state 
      (id, continuation_token, items_processed, calls_used, started_at, last_updated_at, status, error)
      VALUES (?, ?, ?, ?, ?, strftime('%s', 'now'), ?, ?)
    `).run(
      SYNC_ID,
      data.continuationToken || null,
      data.itemsProcessed,
      data.callsUsed,
      Math.floor(Date.now() / 1000),
      data.status,
      data.error || null
    );
    logger.debug('[DAILY-SYNC] Saved sync state', data);
  } catch (error) {
    logger.error('[DAILY-SYNC] Failed to save sync state', error);
  }
}

/**
 * Clear sync state when completed
 */
function clearSyncState(): void {
  try {
    const sqlite = getSqlite();
    sqlite.prepare('DELETE FROM sync_state WHERE id = ?').run(SYNC_ID);
    logger.info('[DAILY-SYNC] Cleared sync state (sync complete)');
  } catch (error) {
    logger.warn('[DAILY-SYNC] Could not clear sync state', error as Record<string, unknown>);
  }
}

/**
 * Run daily sync: fetch last 30 days of items
 */
export async function runDailySync(): Promise<{
  success: boolean;
  itemsAdded: number;
  apiCallsUsed: number;
  categoriesProcessed: Category[];
  resumed: boolean;
  paused: boolean;
  error?: string;
}> {
  logger.info('[DAILY-SYNC] Starting daily sync (last 30 days)');

  const existingState = getSyncState();
  const resumed = existingState ? existingState.status === 'paused' : false;

  if (resumed) {
    logger.info(`[DAILY-SYNC] Resuming from previous sync (${existingState!.items_processed} items processed)`);
  }

  const client = createInoreaderClient();
  const categoriesProcessed: Category[] = [];
  let totalItemsAdded = 0;
  let callsUsed = existingState?.calls_used ?? 0;
  let continuation = existingState?.continuation_token || undefined;

  try {
    // Get user ID
    logger.debug('[DAILY-SYNC] Fetching user ID...');
    const userInfo = (await client.getUserInfo()) as Record<string, unknown> | undefined;
    const userId = (userInfo?.userId || userInfo?.id) as string | undefined;

    if (!userId) {
      throw new Error('Could not determine user ID from Inoreader');
    }

    callsUsed++;

    // Calculate time window: last 30 days
    const thirtyDaysAgo = Math.floor((Date.now() - DAYS_TO_FETCH * 24 * 60 * 60 * 1000) / 1000);
    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[DAILY-SYNC] Fetching items from last ${DAYS_TO_FETCH} days (since ${new Date(thirtyDaysAgo * 1000).toISOString()})`
    );

    let batchNumber = 0;
    let hasMoreItems = true;

    while (hasMoreItems) {
      batchNumber++;

      logger.debug(
        `[DAILY-SYNC] Fetching batch ${batchNumber}${continuation ? ' (continuation)' : ''} (${callsUsed} calls used so far)`
      );

      // Fetch batch
      const response = await client.getStreamContents(allItemsStreamId, {
        n: 1000,
        continuation,
        xt: `user/${userId}/state/com.google/read/unix:${thirtyDaysAgo}`, // Exclude read items before threshold
      });

      callsUsed++;

      if (!response.items || response.items.length === 0) {
        logger.info('[DAILY-SYNC] No more items to fetch');
        hasMoreItems = false;
        break;
      }

      logger.info(
        `[DAILY-SYNC] Batch ${batchNumber}: fetched ${response.items.length} items (${callsUsed} calls used)`
      );

      // Normalize and categorize
      let items = await normalizeItems(response.items);
      items = categorizeItems(items);

      // Save by category
      for (const category of VALID_CATEGORIES) {
        const categoryItems = items.filter((i) => i.category === category);
        if (categoryItems.length === 0) continue;

        try {
          await saveItems(categoryItems);
          totalItemsAdded += categoryItems.length;

          if (!categoriesProcessed.includes(category)) {
            categoriesProcessed.push(category);
          }

          logger.debug(`[DAILY-SYNC] Batch ${batchNumber}: saved ${categoryItems.length} to ${category}`);
        } catch (error) {
          logger.error(`[DAILY-SYNC] Failed to save ${category}`, error);
        }
      }

      // Update sync state (resume point)
      continuation = response.continuation || undefined;
      saveSyncState({
        continuationToken: continuation,
        itemsProcessed: totalItemsAdded,
        callsUsed,
        status: continuation ? 'in_progress' : 'completed',
      });

      // Safety check: if we've used 95+ calls, pause and resume tomorrow
      if (callsUsed >= 95) {
        logger.warn(`[DAILY-SYNC] Approaching rate limit (${callsUsed} calls used). Pausing. Will resume tomorrow.`);
        saveSyncState({
          continuationToken: continuation,
          itemsProcessed: totalItemsAdded,
          callsUsed,
          status: 'paused',
          error: 'Rate limit approaching. Will resume tomorrow.',
        });

        return {
          success: false,
          itemsAdded: totalItemsAdded,
          apiCallsUsed: callsUsed,
          categoriesProcessed,
          resumed,
          paused: true,
          error: 'Paused at 95 calls to stay within daily limit. Will resume tomorrow.',
        };
      }

      hasMoreItems = !!continuation && continuation.length > 0;
    }

    // Sync complete
    clearSyncState();

    logger.info(
      `[DAILY-SYNC] Complete: ${totalItemsAdded} items, ${categoriesProcessed.length} categories, ${callsUsed} API calls`
    );

    return {
      success: true,
      itemsAdded: totalItemsAdded,
      apiCallsUsed: callsUsed,
      categoriesProcessed,
      resumed,
      paused: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);

    // Save error state for resumption
    saveSyncState({
      continuationToken: continuation,
      itemsProcessed: totalItemsAdded,
      callsUsed,
      status: 'paused',
      error: errorMsg,
    });

    logger.error('[DAILY-SYNC] Sync failed', error);

    return {
      success: false,
      itemsAdded: totalItemsAdded,
      apiCallsUsed: callsUsed,
      categoriesProcessed,
      resumed,
      paused: true,
      error: errorMsg,
    };
  }
}
