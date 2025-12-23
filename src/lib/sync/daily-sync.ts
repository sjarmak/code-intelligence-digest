/**
 * Daily sync strategy: fetch only items newer than what we already have
 * 
 * Features:
 * - Tracks last synced item timestamp in database
 * - Fetches only items published after that timestamp
 * - Falls back to 24-hour window if database is empty
 * - Resumable if interrupted by rate limits
 * - Tracks progress and continuation tokens
 * - Designed to fit within 100-call daily limit
 * 
 * Expected cost: 1-3 API calls per sync
 * Remaining budget: 97+ calls for other uses
 */

import { createInoreaderClient } from '../inoreader/client';
import { normalizeItems } from '../pipeline/normalize';
import { categorizeItems } from '../pipeline/categorize';
import { saveItems, getLastPublishedTimestamp } from '../db/items';
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
const FALLBACK_HOURS_IF_EMPTY = 24; // Fallback window if database has no items

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
 * Run daily sync: fetch items newer than the last one in our database
 * This ensures we never miss items and uses minimal API calls
 * 
 * @param lookbackDays Optional: override default sync window. Use for bootstrap or catch-up.
 *                     If provided, fetches items from the last N days instead of since last sync.
 *                     Example: runDailySync({ lookbackDays: 7 }) fetches last 7 days.
 */
export async function runDailySync(options?: { lookbackDays?: number }): Promise<{
  success: boolean;
  itemsAdded: number;
  apiCallsUsed: number;
  categoriesProcessed: Category[];
  resumed: boolean;
  paused: boolean;
  error?: string;
}> {
  const lookbackDays = options?.lookbackDays;
  const isCatchup = lookbackDays !== undefined;
  
  if (isCatchup) {
    logger.info(`[DAILY-SYNC] Starting catch-up sync (fetch last ${lookbackDays} days)`);
  } else {
    logger.info('[DAILY-SYNC] Starting daily sync (fetch newer items)');
  }

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

    // Determine sync time window
    let syncSinceTimestamp: number;
    let reason: string;

    if (isCatchup && lookbackDays) {
      // Catch-up mode: fetch from N days ago regardless of database state
      syncSinceTimestamp = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
      reason = `last ${lookbackDays} days (catch-up mode)`;
    } else {
      // Normal mode: fetch items newer than what we already have
      const lastPublished = await getLastPublishedTimestamp();
      if (lastPublished) {
        // Fetch items newer than the most recent one we have
        syncSinceTimestamp = lastPublished;
        reason = `since last item (${new Date(lastPublished * 1000).toISOString()})`;
      } else {
        // Database is empty: fallback to last 24 hours
        syncSinceTimestamp = Math.floor((Date.now() - FALLBACK_HOURS_IF_EMPTY * 60 * 60 * 1000) / 1000);
        reason = `last ${FALLBACK_HOURS_IF_EMPTY} hours (database empty)`;
      }
    }

    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[DAILY-SYNC] Fetching items ${reason} (${new Date(syncSinceTimestamp * 1000).toISOString()})`
    );

    let batchNumber = 0;
    let hasMoreItems = true;

    while (hasMoreItems) {
      batchNumber++;

      logger.debug(
        `[DAILY-SYNC] Fetching batch ${batchNumber}${continuation ? ' (continuation)' : ''} (${callsUsed} calls used so far)`
      );

      // Fetch batch (items newer than last sync)
      // Uses `ot` parameter (older than) to only return items newer than syncSinceTimestamp
      // This significantly reduces API calls by filtering on server-side
      const response = await client.getStreamContents(allItemsStreamId, {
        n: 1000,
        continuation,
        ot: syncSinceTimestamp, // Only fetch items newer than this timestamp
      });

      callsUsed++;

      if (!response.items || response.items.length === 0) {
        logger.info('[DAILY-SYNC] No more items to fetch (empty response)');
        hasMoreItems = false;
        break;
      }

      // Note: We cannot do early termination based on the oldest item in batch
      // because Inoreader doesn't guarantee items are sorted chronologically.
      // Items from Dec 2 can be mixed with items from Dec 23 in the same batch.
      // Instead, we rely on the continuation token to determine if there are more items.

      logger.info(
        `[DAILY-SYNC] Batch ${batchNumber}: fetched ${response.items.length} items (${callsUsed} calls used)`
      );

      // Normalize and categorize
      let items = await normalizeItems(response.items);
      items = categorizeItems(items);

      // Filter to only items newer than sync threshold (client-side enforcement)
      const syncThresholdDate = new Date(syncSinceTimestamp * 1000);
      const beforeFilter = items.length;
      items = items.filter((item) => item.publishedAt.getTime() > syncThresholdDate.getTime());
      const afterFilter = items.length;

      if (beforeFilter !== afterFilter) {
        logger.debug(
          `[DAILY-SYNC] Batch ${batchNumber}: filtered ${beforeFilter - afterFilter} items at/before sync threshold`
        );
      }

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
