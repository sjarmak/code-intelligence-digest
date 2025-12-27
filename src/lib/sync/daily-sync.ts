/**
 * Hourly sync strategy: fetch last 4 hours of items (fixed window)
 *
 * Features:
 * - Always fetches last 4 hours regardless of database state (reliable)
 * - Server-side filtering via `ot` parameter minimizes API calls
 * - Database handles deduplication (INSERT OR REPLACE / ON CONFLICT)
 * - Post-processing handles decomposition, categorization, etc.
 * - Resumable if interrupted by rate limits
 * - Tracks progress and continuation tokens
 * - Designed to fit within 1000-call daily limit
 *
 * Why 4 hours?
 * - Since we sync hourly, 4 hours provides overlap to catch items even if one sync fails
 * - Overlap prevents gaps while still being efficient
 * - Server-side filtering means we only get items from that window
 * - Smaller window = fewer items per sync = faster processing
 *
 * Expected cost: 1-2 API calls per sync (24-48 calls/day)
 * Remaining budget: 950+ calls for other uses
 */

import { createInoreaderClient } from '../inoreader/client';
import { normalizeItems } from '../pipeline/normalize';
import { categorizeItems } from '../pipeline/categorize';
import { decomposeFeedItems } from '../pipeline/decompose';
import { saveItems } from '../db/items';
import { computeAndSaveScoresForItems } from '../pipeline/compute-scores';
import { logger } from '../logger';
import { Category, FeedItem } from '../model';
import { getDbClient, detectDriver, nowTimestamp } from '../db/driver';
import { getGlobalApiBudget, incrementGlobalApiCalls, getCachedUserId, setCachedUserId } from '../db/index';

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

const SYNC_ID = 'hourly-sync';
const FALLBACK_HOURS_IF_EMPTY = 4; // Fallback window if database has no items (matches sync window)

/**
 * Get current sync state from database
 */
async function getSyncState(): Promise<SyncStateRow | null> {
  try {
    const client = await getDbClient();
    // Use SQLite-style ? placeholder - Postgres client will convert it
    const result = await client.query(
      'SELECT * FROM sync_state WHERE id = ?',
      [SYNC_ID]
    );

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as unknown as SyncStateRow;
    return row;
  } catch (error) {
    logger.warn('[DAILY-SYNC] Could not load sync state, starting fresh', error as Record<string, unknown>);
    return null;
  }
}

/**
 * Save sync state to resume later if interrupted
 */
async function saveSyncState(data: {
  continuationToken?: string | null;
  itemsProcessed: number;
  callsUsed: number;
  status: 'in_progress' | 'completed' | 'paused';
  error?: string;
}): Promise<void> {
  try {
    const client = await getDbClient();
    const driver = detectDriver();
    const now = Math.floor(Date.now() / 1000);

    // Build SQL with driver-specific timestamp expression
    const timestampExpr = nowTimestamp(driver);

    // Use ON CONFLICT syntax that works for both SQLite and Postgres
    // Use SQLite-style ? placeholders - the Postgres client will convert them to $1, $2, etc.
    // Note: last_updated_at uses driver-specific SQL expression (not a parameter)
    const sql = `
      INSERT INTO sync_state
      (id, continuation_token, items_processed, calls_used, started_at, last_updated_at, status, error)
      VALUES (?, ?, ?, ?, ?, ${timestampExpr}, ?, ?)
      ON CONFLICT (id) DO UPDATE SET
        continuation_token = excluded.continuation_token,
        items_processed = excluded.items_processed,
        calls_used = excluded.calls_used,
        last_updated_at = ${timestampExpr},
        status = excluded.status,
        error = excluded.error
    `;

    // Parameters: ?=id, ?=continuation_token, ?=items_processed, ?=calls_used, ?=started_at, ?=status, ?=error
    // Note: last_updated_at is handled by SQL expression (strftime/EXTRACT), not a parameter
    await client.run(sql, [
      SYNC_ID,
      data.continuationToken || null,
      data.itemsProcessed,
      data.callsUsed,
      now,
      data.status,
      data.error || null
    ]);
    logger.debug('[DAILY-SYNC] Saved sync state', data);
  } catch (error) {
    logger.error('[DAILY-SYNC] Failed to save sync state', error);
  }
}

/**
 * Clear sync state when completed
 */
async function clearSyncState(): Promise<void> {
  try {
    const client = await getDbClient();
    await client.run('DELETE FROM sync_state WHERE id = $1', [SYNC_ID]);
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

  const existingState = await getSyncState();
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
    // Check global budget before starting
    const budget = await getGlobalApiBudget();
    const percentUsed = Math.round((budget.callsUsed / budget.quotaLimit) * 100);
    logger.info(`[DAILY-SYNC] Global API budget: ${budget.callsUsed}/${budget.quotaLimit} calls used (${percentUsed}%)`);

    // Conservative pause thresholds: pause at 5% remaining (50 calls for 1000 quota)
    const PAUSE_THRESHOLD = Math.max(50, Math.floor(budget.quotaLimit * 0.05));
    if (budget.remaining <= PAUSE_THRESHOLD) {
      logger.warn(`[DAILY-SYNC] Only ${budget.remaining} calls remaining (${Math.round((budget.remaining / budget.quotaLimit) * 100)}%). Pausing to protect daily limit.`);
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

    // Warn at usage milestones
    if (percentUsed >= 90) {
      logger.warn(`[DAILY-SYNC] ⚠️  CRITICAL: ${percentUsed}% of API budget used (${budget.remaining} remaining)`);
    } else if (percentUsed >= 75) {
      logger.warn(`[DAILY-SYNC] ⚠️  WARNING: ${percentUsed}% of API budget used (${budget.remaining} remaining)`);
    } else if (percentUsed >= 50) {
      logger.info(`[DAILY-SYNC] ℹ️  ${percentUsed}% of API budget used (${budget.remaining} remaining)`);
    }

    // Get user ID (cached, no API call if available)
    let userId: string | null = await getCachedUserId();

    if (!userId) {
      logger.debug('[DAILY-SYNC] User ID not cached. Fetching from API...');
      const userInfo = (await client.getUserInfo()) as Record<string, unknown> | undefined;
      userId = (userInfo?.userId || userInfo?.id) as string | null;

      if (!userId) {
        throw new Error('Could not determine user ID from Inoreader');
      }

      // Cache it for future syncs
      await setCachedUserId(userId);
      logger.info('[DAILY-SYNC] Cached user ID for future syncs');

      callsUsed++;
      // Note: API call is automatically tracked by InoreaderClient
    } else {
      logger.debug('[DAILY-SYNC] Using cached user ID');
    }

    // Determine sync time window
    let syncSinceTimestamp: number;
    let reason: string;

    if (isCatchup && lookbackDays) {
      // Catch-up mode: fetch from N days ago (for manual catch-up scenarios)
      syncSinceTimestamp = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
      reason = `last ${lookbackDays} days (catch-up mode)`;
    } else {
      // Normal mode: always fetch last 4 hours (fixed window)
      // Since we sync hourly, 4 hours provides overlap to catch items even if one sync fails
      // This is more reliable than "newer than last sync" because:
      // 1. Doesn't depend on sync history
      // 2. Handles missed syncs gracefully
      // 3. Database deduplication prevents duplicates
      // 4. Server-side filtering (ot parameter) minimizes API calls
      // 5. Smaller window = fewer items per sync = faster processing
      const SYNC_WINDOW_HOURS = 4;
      syncSinceTimestamp = Math.floor((Date.now() - SYNC_WINDOW_HOURS * 60 * 60 * 1000) / 1000);
      reason = `last ${SYNC_WINDOW_HOURS} hours (fixed window)`;
    }

    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[DAILY-SYNC] Fetching items ${reason} (${new Date(syncSinceTimestamp * 1000).toISOString()})`
    );

    let batchNumber = 0;
    let hasMoreItems = true;
    const allItemsToScore: FeedItem[] = []; // Collect all items for scoring at the end

    while (hasMoreItems) {
      batchNumber++;

      logger.debug(
        `[DAILY-SYNC] Fetching batch ${batchNumber}${continuation ? ' (continuation)' : ''} (${callsUsed} calls used so far)`
      );

      // Fetch batch (items newer than last sync)
      // Uses `ot` parameter (older than) to only return items newer than syncSinceTimestamp
      // This significantly reduces API calls by filtering on server-side
      // Note: Inoreader API caps at ~100 items per request, so n=100 is the effective limit
      const response = await client.getStreamContents(allItemsStreamId, {
        n: 100, // Inoreader API limit is ~100 items per request (n=1000 is capped)
        continuation,
        ot: syncSinceTimestamp, // Only fetch items newer than this timestamp
      });

      callsUsed++;
      // Note: API call is automatically tracked by InoreaderClient

      // Check budget after each call with conservative threshold
      const currentBudget = await getGlobalApiBudget();
      const currentPercentUsed = Math.round((currentBudget.callsUsed / currentBudget.quotaLimit) * 100);
      const PAUSE_THRESHOLD = Math.max(50, Math.floor(currentBudget.quotaLimit * 0.05));

      if (currentBudget.remaining <= PAUSE_THRESHOLD) {
        logger.warn(`[DAILY-SYNC] Budget near limit after batch ${batchNumber} (${currentPercentUsed}% used, ${currentBudget.remaining} remaining). Pausing.`);
        await saveSyncState({
          continuationToken: response.continuation,
          itemsProcessed: totalItemsAdded,
          callsUsed,
          status: 'paused',
          error: `Rate limit near. ${currentBudget.remaining} calls remaining (${currentPercentUsed}% used).`,
        });
        return {
          success: false,
          itemsAdded: totalItemsAdded,
          apiCallsUsed: callsUsed,
          categoriesProcessed,
          resumed,
          paused: true,
          error: `Rate limit near. ${currentBudget.remaining} calls remaining (${currentPercentUsed}% used).`,
        };
      }

      // Warn at usage milestones
      if (currentPercentUsed >= 90) {
        logger.warn(`[DAILY-SYNC] ⚠️  CRITICAL: ${currentPercentUsed}% of API budget used after batch ${batchNumber}`);
      } else if (currentPercentUsed >= 75) {
        logger.warn(`[DAILY-SYNC] ⚠️  WARNING: ${currentPercentUsed}% of API budget used after batch ${batchNumber}`);
      }

      if (!response.items || response.items.length === 0) {
        logger.info('[DAILY-SYNC] No more items to fetch (empty response)');
        hasMoreItems = false;
        break;
      }

      // Efficiency check: if we're getting very few items per call, we might be wasting API calls
      // This can happen if the continuation token keeps returning empty or near-empty batches
      const batchItemsCount = response.items.length;
      if (batchItemsCount < 10 && batchNumber > 1) {
        logger.warn(`[DAILY-SYNC] Low efficiency: only ${batchItemsCount} items in batch ${batchNumber}. Consider stopping if this persists.`);
      }

      // Note: We cannot do early termination based on the oldest item in batch
      // because Inoreader doesn't guarantee items are sorted chronologically.
      // Items from Dec 2 can be mixed with items from Dec 23 in the same batch.
      // Instead, we rely on the continuation token to determine if there are more items.

      // Calculate efficiency metrics
      const avgItemsPerCall = totalItemsAdded > 0 ? (totalItemsAdded / callsUsed).toFixed(1) : '0';
      const efficiency = response.items.length > 0 ? `${response.items.length} items/call` : '0 items/call';

      logger.info(
        `[DAILY-SYNC] Batch ${batchNumber}: fetched ${response.items.length} items (${callsUsed} calls used, ${efficiency}, ${avgItemsPerCall} avg items/call overall)`
      );

      // Normalize, decompose newsletters, and categorize
      let items = await normalizeItems(response.items);
      logger.debug(`[DAILY-SYNC] Normalized ${items.length} items`);

      // Decompose newsletter items into individual articles
      items = decomposeFeedItems(items);
      logger.debug(`[DAILY-SYNC] After decomposition: ${items.length} items`);

      items = categorizeItems(items);
      logger.debug(`[DAILY-SYNC] Categorized ${items.length} items`);

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

      // After decomposition, items may have been re-categorized (e.g., newsletter articles -> ai_news, product_news)
      // Save ALL items regardless of their final category, not just the original category
      // This ensures decomposed articles appear in their correct categories
      if (items.length > 0) {
        try {
          await saveItems(items);
          totalItemsAdded += items.length;

          // Collect items for scoring at the end
          allItemsToScore.push(...items);

          // Track all categories present in this batch
          items.forEach((item) => {
            if (!categoriesProcessed.includes(item.category)) {
              categoriesProcessed.push(item.category);
            }
          });

          logger.debug(`[DAILY-SYNC] Batch ${batchNumber}: saved ${items.length} items (categories: ${Array.from(new Set(items.map(i => i.category))).join(', ')})`);
        } catch (error) {
          logger.error(`[DAILY-SYNC] Failed to save items`, error);
        }
      }

      // Update sync state (resume point)
      continuation = response.continuation || undefined;
      await saveSyncState({
        continuationToken: continuation,
        itemsProcessed: totalItemsAdded,
        callsUsed,
        status: continuation ? 'in_progress' : 'completed',
      });

      // Safety check: pause if we've used 95% of quota (conservative threshold)
      const SAFETY_THRESHOLD = Math.floor(budget.quotaLimit * 0.95);
      if (callsUsed >= SAFETY_THRESHOLD) {
        const percentUsed = Math.round((callsUsed / budget.quotaLimit) * 100);
        logger.warn(`[DAILY-SYNC] Approaching rate limit (${callsUsed} calls used, ${percentUsed}% of quota). Pausing. Will resume tomorrow.`);
        await saveSyncState({
          continuationToken: continuation,
          itemsProcessed: totalItemsAdded,
          callsUsed,
          status: 'paused',
          error: `Rate limit approaching (${percentUsed}% used). Will resume tomorrow.`,
        });

        return {
          success: false,
          itemsAdded: totalItemsAdded,
          apiCallsUsed: callsUsed,
          categoriesProcessed,
          resumed,
          paused: true,
          error: `Paused at ${callsUsed} calls (${percentUsed}% of quota) to stay within daily limit. Will resume tomorrow.`,
        };
      }

      hasMoreItems = !!continuation && continuation.length > 0;
    }

    // Sync complete - now compute and save relevance scores
    logger.info(`[DAILY-SYNC] Computing relevance scores for ${allItemsToScore.length} items...`);
    let scoresComputed = 0;
    try {
      const scoreResult = await computeAndSaveScoresForItems(allItemsToScore);
      scoresComputed = scoreResult.totalScored;
      logger.info(`[DAILY-SYNC] Computed and saved scores for ${scoresComputed} items across ${scoreResult.categoriesScored.length} categories`);
    } catch (error) {
      logger.error(`[DAILY-SYNC] Failed to compute scores (items still saved)`, error);
      // Don't fail the sync if scoring fails - items are already saved
    }

    await clearSyncState();

    // Final efficiency report
    const finalBudget = await getGlobalApiBudget();
    const finalPercentUsed = Math.round((finalBudget.callsUsed / finalBudget.quotaLimit) * 100);
    const avgItemsPerCall = totalItemsAdded > 0 ? (totalItemsAdded / callsUsed).toFixed(1) : '0';

    logger.info(
      `[DAILY-SYNC] Complete: ${totalItemsAdded} items, ${scoresComputed} scored, ${categoriesProcessed.length} categories, ${callsUsed} API calls (${avgItemsPerCall} items/call, ${finalPercentUsed}% of quota used)`
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
    await saveSyncState({
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
