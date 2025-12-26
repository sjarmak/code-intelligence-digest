/**
 * Weekly sync strategy: fetch last 7 days in a single optimized call
 *
 * Features:
 * - Single batch fetch of last 7 days of items (n=1000)
 * - Only uses continuation if >1000 items in 7 days (rare)
 * - Resumable if interrupted by rate limits
 * - Expected cost: 1-2 API calls
 * - Minimal code, minimal overhead
 *
 * Best for: Weekly digests where you want all content at once
 */

import { createInoreaderClient } from '../inoreader/client';
import { normalizeItems } from '../pipeline/normalize';
import { categorizeItems } from '../pipeline/categorize';
import { saveItems } from '../db/items';
import { logger } from '../logger';
import { Category } from '../model';
import { getSqlite, getGlobalApiBudget, incrementGlobalApiCalls, getCachedUserId, setCachedUserId } from '../db/index';

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

const SYNC_ID = 'weekly-sync';
const LOOKBACK_DAYS = 7;

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
    logger.warn('[WEEKLY-SYNC] Could not load sync state, starting fresh', error as Record<string, unknown>);
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
    logger.debug('[WEEKLY-SYNC] Saved sync state', data);
  } catch (error) {
    logger.error('[WEEKLY-SYNC] Failed to save sync state', error);
  }
}

/**
 * Clear sync state when completed
 */
function clearSyncState(): void {
  try {
    const sqlite = getSqlite();
    sqlite.prepare('DELETE FROM sync_state WHERE id = ?').run(SYNC_ID);
    logger.info('[WEEKLY-SYNC] Cleared sync state (sync complete)');
  } catch (error) {
    logger.warn('[WEEKLY-SYNC] Could not clear sync state', error as Record<string, unknown>);
  }
}

/**
 * Run weekly sync: fetch all items from the last 7 days
 * Optimized for minimal API calls (typically 1-2)
 */
export async function runWeeklySync(): Promise<{
  success: boolean;
  itemsAdded: number;
  apiCallsUsed: number;
  categoriesProcessed: Category[];
  resumed: boolean;
  paused: boolean;
  error?: string;
}> {
  logger.info(`[WEEKLY-SYNC] Starting weekly sync (last ${LOOKBACK_DAYS} days)`);

  const existingState = getSyncState();
  const resumed = existingState ? existingState.status === 'paused' : false;

  if (resumed) {
    logger.info(`[WEEKLY-SYNC] Resuming from previous sync (${existingState!.items_processed} items processed)`);
  }

  const client = createInoreaderClient();
  const categoriesProcessed: Category[] = [];
  let totalItemsAdded = 0;
  let callsUsed = existingState?.calls_used ?? 0;
  let continuation = existingState?.continuation_token || undefined;

  try {
    // Check global budget before starting
    const budget = getGlobalApiBudget();
    logger.info(`[WEEKLY-SYNC] Global API budget: ${budget.callsUsed}/${budget.quotaLimit} calls used`);

    if (budget.remaining <= 1) {
      logger.warn(`[WEEKLY-SYNC] Only ${budget.remaining} calls remaining. Pausing to protect daily limit.`);
      return {
        success: false,
        itemsAdded: 0,
        apiCallsUsed: 0,
        categoriesProcessed: [],
        resumed,
        paused: true,
        error: `Rate limit near. Only ${budget.remaining} calls remaining in daily quota.`,
      };
    }

    // Get user ID (cached, no API call)
    let userId: string | null = getCachedUserId();

    if (!userId) {
      logger.debug('[WEEKLY-SYNC] User ID not cached. Fetching from API...');
      const userInfo = (await client.getUserInfo()) as Record<string, unknown> | undefined;
      const fetchedUserId = (userInfo?.userId || userInfo?.id) as string | undefined;
      userId = fetchedUserId || null;

      if (!userId) {
        throw new Error('Could not determine user ID from Inoreader');
      }

      // Cache it for future syncs
      setCachedUserId(userId);
      logger.info('[WEEKLY-SYNC] Cached user ID for future syncs');

      callsUsed++;
      // Note: API call is automatically tracked by InoreaderClient
    } else {
      logger.debug('[WEEKLY-SYNC] Using cached user ID');
    }

    // Calculate 7-day lookback timestamp
    const syncSinceTimestamp = Math.floor((Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000);
    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[WEEKLY-SYNC] Fetching items since ${new Date(syncSinceTimestamp * 1000).toISOString()} (${LOOKBACK_DAYS} days ago)`
    );

    let batchNumber = 0;
    let hasMoreItems = true;

    while (hasMoreItems) {
      batchNumber++;

      logger.debug(
        `[WEEKLY-SYNC] Fetching batch ${batchNumber}${continuation ? ' (continuation)' : ''} (${callsUsed} calls used)`
      );

      // Single optimized fetch: n=100 (Inoreader API limit) with continuation tokens for pagination
      // Note: Inoreader caps at ~100 items per request, so we paginate with continuation tokens
      const response = await client.getStreamContents(allItemsStreamId, {
        n: 100, // Inoreader API limit is ~100 items per request
        continuation,
        xt: `user/${userId}/state/com.google/read/unix:${syncSinceTimestamp}`, // Exclude read items older than threshold
      });

      callsUsed++;
      // Note: API call is automatically tracked by InoreaderClient

      if (!response.items || response.items.length === 0) {
        logger.info('[WEEKLY-SYNC] No more items to fetch');
        hasMoreItems = false;
        break;
      }

      logger.info(
        `[WEEKLY-SYNC] Batch ${batchNumber}: fetched ${response.items.length} items (${callsUsed} calls used)`
      );

      // Normalize and categorize
      let items = await normalizeItems(response.items);
      items = categorizeItems(items);

      // Filter to only items newer than lookback (client-side enforcement)
      const syncThresholdDate = new Date(syncSinceTimestamp * 1000);
      const beforeFilter = items.length;
      items = items.filter((item) => item.publishedAt.getTime() > syncThresholdDate.getTime());
      const afterFilter = items.length;

      if (beforeFilter !== afterFilter) {
        logger.debug(
          `[WEEKLY-SYNC] Batch ${batchNumber}: filtered ${beforeFilter - afterFilter} items outside window`
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

          logger.debug(`[WEEKLY-SYNC] Batch ${batchNumber}: saved ${categoryItems.length} to ${category}`);
        } catch (error) {
          logger.error(`[WEEKLY-SYNC] Failed to save ${category}`, error);
        }
      }

      // Check if there's more
      continuation = response.continuation || undefined;
      saveSyncState({
        continuationToken: continuation,
        itemsProcessed: totalItemsAdded,
        callsUsed,
        status: continuation ? 'in_progress' : 'completed',
      });

      // Safety: check global budget after each batch
      const currentBudget = getGlobalApiBudget();
      logger.debug(`[WEEKLY-SYNC] Global budget after batch: ${currentBudget.callsUsed}/${currentBudget.quotaLimit}`);

      if (currentBudget.remaining <= 1) {
        logger.warn(`[WEEKLY-SYNC] Global budget critical (${currentBudget.remaining} calls remaining). Pausing.`);
        saveSyncState({
          continuationToken: continuation,
          itemsProcessed: totalItemsAdded,
          callsUsed,
          status: 'paused',
          error: `Global rate limit (${currentBudget.callsUsed}/${currentBudget.quotaLimit}). Will resume tomorrow.`,
        });

        return {
          success: false,
          itemsAdded: totalItemsAdded,
          apiCallsUsed: callsUsed,
          categoriesProcessed,
          resumed,
          paused: true,
          error: `Paused at ${currentBudget.callsUsed} global calls to stay within daily limit. Will resume tomorrow.`,
        };
      }

      hasMoreItems = !!continuation && continuation.length > 0;
    }

    // Sync complete
    clearSyncState();

    logger.info(
      `[WEEKLY-SYNC] Complete: ${totalItemsAdded} items, ${categoriesProcessed.length} categories, ${callsUsed} API calls`
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

    logger.error('[WEEKLY-SYNC] Sync failed', error);

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
