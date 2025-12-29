/**
 * Hourly sync strategy: fetch last 4 hours of items (fixed window)
 *
 * Features:
 * - Always fetches last 4 hours regardless of database state (reliable)
 * - Server-side filtering via `ot` parameter minimizes API calls
 * - Database handles deduplication (INSERT OR REPLACE / ON CONFLICT)
 * - Post-processing handles decomposition, categorization, etc.
 * - Resumable if interrupted by rate limits (429 errors from Inoreader)
 * - Tracks progress and continuation tokens
 * - Relies on Inoreader's 429 errors for rate limiting (no internal counting)
 *
 * Why 4 hours?
 * - Since we sync hourly, 4 hours provides overlap to catch items even if one sync fails
 * - Overlap prevents gaps while still being efficient
 * - Server-side filtering means we only get items from that window
 * - Smaller window = fewer items per sync = faster processing
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
import { getCachedUserId, setCachedUserId } from '../db/index';
import { syncResearchFromADS } from './ads-research-sync';

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

/**
 * Load existing sync state (if resuming)
 */
async function loadSyncState(): Promise<SyncStateRow | null> {
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
    logger.error('[DAILY-SYNC] Failed to load sync state', error);
    return null;
  }
}

/**
 * Save sync state (for resumability)
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

    await client.run(sql, [
      SYNC_ID,
      data.continuationToken || null,
      data.itemsProcessed,
      data.callsUsed,
      now,
      data.status,
      data.error || null,
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
    const driver = detectDriver();
    const sql = driver === 'postgres'
      ? 'DELETE FROM sync_state WHERE id = $1'
      : 'DELETE FROM sync_state WHERE id = ?';
    await client.run(sql, [SYNC_ID]);
    logger.info('[DAILY-SYNC] Cleared sync state (sync complete)');
  } catch (error) {
    logger.warn('[DAILY-SYNC] Could not clear sync state', error as Record<string, unknown>);
  }
}

export async function runDailySync(options?: { lookbackDays?: number }): Promise<{
  success: boolean;
  itemsAdded: number;
  apiCallsUsed: number;
  categoriesProcessed: Category[];
  resumed: boolean;
  paused: boolean;
  error?: string;
}> {
  logger.info('[DAILY-SYNC] Starting daily sync (fetch newer items)');

  const client = createInoreaderClient();
  let totalItemsAdded = 0;
  let callsUsed = 0; // Just for logging/reporting, not used for rate limiting
  const categoriesProcessed: Category[] = [];
  const isCatchup = !!options?.lookbackDays;
  const lookbackDays = options?.lookbackDays;

  // Load existing state (if resuming)
  const existingState = await loadSyncState();
  const resumed = !!existingState && existingState.status === 'paused';
  let continuation = existingState?.continuation_token || undefined;

  let researchItemsAdded = 0;
  let researchItemsScored = 0;

  try {
    // Sync research from ADS instead of Inoreader
    const adsToken = process.env.ADS_API_TOKEN;

    if (adsToken) {
      try {
        logger.info('[DAILY-SYNC] Syncing research papers from ADS...');
        const researchResult = await syncResearchFromADS(adsToken);
        researchItemsAdded = researchResult.itemsAdded;
        researchItemsScored = researchResult.itemsScored;
        logger.info(`[DAILY-SYNC] ADS research sync: ${researchItemsAdded} items added, ${researchItemsScored} scored`);

        // Add research to categories processed
        if (researchItemsAdded > 0 && !categoriesProcessed.includes('research')) {
          categoriesProcessed.push('research');
        }
      } catch (error) {
        logger.error('[DAILY-SYNC] ADS research sync failed (continuing with Inoreader sync)', error);
      }
    }

    // Get user ID (cached, no API call if available)
    let userId: string | null = await getCachedUserId();

    if (!userId) {
      logger.debug('[DAILY-SYNC] User ID not cached. Fetching from API...');
      try {
        const userInfo = (await client.getUserInfo()) as Record<string, unknown> | undefined;
        userId = (userInfo?.userId || userInfo?.id) as string | null;

        if (!userId) {
          throw new Error('Could not determine user ID from Inoreader');
        }

        // Cache it for future syncs
        await setCachedUserId(userId);
        logger.info('[DAILY-SYNC] Cached user ID for future syncs');

        callsUsed++;
      } catch (error) {
        // If getUserInfo fails (e.g., 429 error), pause and resume later
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[DAILY-SYNC] Failed to fetch user info: ${errorMsg}`);
        
        // Check if it's a 429 (rate limit) or other error
        const isRateLimit = errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('Too Many Requests');
        const pauseError = isRateLimit 
          ? `Rate limit reached. Will resume automatically.`
          : `Failed to fetch user info: ${errorMsg}`;
        
        await saveSyncState({
          continuationToken: continuation,
          itemsProcessed: totalItemsAdded,
          callsUsed,
          status: 'paused',
          error: pauseError,
        });
        return {
          success: false,
          itemsAdded: totalItemsAdded,
          apiCallsUsed: callsUsed,
          categoriesProcessed,
          resumed,
          paused: true,
          error: pauseError,
        };
      }
    } else {
      logger.debug('[DAILY-SYNC] Using cached user ID');
    }

    // Determine sync time window
    let syncSinceTimestamp: number;
    let otTimestamp: number;
    let reason: string;

    if (isCatchup && lookbackDays) {
      // Catch-up mode: fetch from N days ago (for manual catch-up scenarios)
      syncSinceTimestamp = Math.floor((Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000);
      otTimestamp = syncSinceTimestamp; // Use same window for ot in catch-up mode
      reason = `last ${lookbackDays} days (catch-up mode)`;
    } else {
      // Normal mode: fetch items that Inoreader received in the last 4 hours
      const SYNC_WINDOW_HOURS = 4;
      const OT_WINDOW_DAYS = 7;
      syncSinceTimestamp = Math.floor((Date.now() - SYNC_WINDOW_HOURS * 60 * 60 * 1000) / 1000);
      otTimestamp = Math.floor((Date.now() - OT_WINDOW_DAYS * 24 * 60 * 60 * 1000) / 1000);
      reason = `last ${SYNC_WINDOW_HOURS} hours (createdAt filter), ot=${OT_WINDOW_DAYS}d window`;
    }

    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[DAILY-SYNC] Fetching items ${reason} (${new Date(syncSinceTimestamp * 1000).toISOString()})`
    );

    let batchNumber = 0;
    let hasMoreItems = true;
    const allItemsToScore: FeedItem[] = [];
    let totalScoresComputed = 0;

    while (hasMoreItems) {
      batchNumber++;

      logger.debug(
        `[DAILY-SYNC] Fetching batch ${batchNumber}${continuation ? ' (continuation)' : ''} (${callsUsed} calls used so far)`
      );

      try {
        // Fetch batch
        const response = await client.getStreamContents(allItemsStreamId, {
          n: 100,
          continuation,
          ot: otTimestamp,
        });

        callsUsed++;

        if (!response.items || response.items.length === 0) {
          logger.info('[DAILY-SYNC] No more items to fetch (empty response)');
          hasMoreItems = false;
          break;
        }

        // Normalize, decompose newsletters, and categorize
        let items = await normalizeItems(response.items);
        items = decomposeFeedItems(items);
        items = categorizeItems(items);

        // Filter by createdAt (when Inoreader received it) for the sync window
        const beforeFilter = items.length;
        items = items.filter(
          (item) => item.createdAt && Math.floor(item.createdAt.getTime() / 1000) >= syncSinceTimestamp
        );
        const afterFilter = items.length;

        if (beforeFilter > afterFilter) {
          logger.debug(
            `[DAILY-SYNC] Filtered ${beforeFilter - afterFilter} items outside window`
          );
        }

        // Save and score by category
        for (const category of VALID_CATEGORIES) {
          const categoryItems = items.filter((i) => i.category === category);
          if (categoryItems.length === 0) continue;

          try {
            await saveItems(categoryItems);
            totalItemsAdded += categoryItems.length;

            if (!categoriesProcessed.includes(category)) {
              categoriesProcessed.push(category);
            }

            // Score items immediately after saving
            try {
              logger.debug(`[DAILY-SYNC] Batch ${batchNumber}: scoring ${categoryItems.length} items immediately after save...`);
              const batchScoreResult = await computeAndSaveScoresForItems(categoryItems);
              totalScoresComputed += batchScoreResult.totalScored;
            } catch (scoreError) {
              logger.error(`[DAILY-SYNC] Batch ${batchNumber}: Failed to score items (will retry at end)`, scoreError);
              allItemsToScore.push(...categoryItems);
            }
          } catch (error) {
            logger.error(`[DAILY-SYNC] Failed to save ${category}`, error);
          }
        }

        // Save progress
        continuation = response.continuation || undefined;
        await saveSyncState({
          continuationToken: continuation,
          itemsProcessed: totalItemsAdded,
          callsUsed,
          status: continuation ? 'in_progress' : 'completed',
        });

        hasMoreItems = !!continuation && continuation.length > 0;
      } catch (error) {
        // Check if it's a 429 (rate limit) error
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isRateLimit = errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('Too Many Requests');
        
        if (isRateLimit) {
          logger.warn(`[DAILY-SYNC] Rate limit reached (429). Pausing sync. Will resume automatically.`);
          await saveSyncState({
            continuationToken: continuation,
            itemsProcessed: totalItemsAdded,
            callsUsed,
            status: 'paused',
            error: 'Rate limit reached (429). Will resume automatically.',
          });
          return {
            success: false,
            itemsAdded: totalItemsAdded,
            apiCallsUsed: callsUsed,
            categoriesProcessed,
            resumed,
            paused: true,
            error: 'Rate limit reached (429). Will resume automatically.',
          };
        }
        
        // For other errors, re-throw
        throw error;
      }
    }

    // Score any remaining items that weren't scored during batch processing
    let scoresComputed = totalScoresComputed;
    if (allItemsToScore.length > 0) {
      logger.info(`[DAILY-SYNC] Computing relevance scores for ${allItemsToScore.length} remaining items...`);
      try {
        const scoreResult = await computeAndSaveScoresForItems(allItemsToScore);
        scoresComputed += scoreResult.totalScored;
        logger.info(`[DAILY-SYNC] Computed and saved scores for ${scoreResult.totalScored} remaining items across ${scoreResult.categoriesScored.length} categories`);
      } catch (error) {
        logger.error(`[DAILY-SYNC] Failed to compute scores for remaining items (items still saved)`, error);
      }
    } else {
      logger.info(`[DAILY-SYNC] All items were scored during batch processing - no remaining items to score`);
    }

    await clearSyncState();

    const avgItemsPerCall = totalItemsAdded > 0 ? (totalItemsAdded / callsUsed).toFixed(1) : '0';
    const totalItemsIncludingResearch = totalItemsAdded + researchItemsAdded;
    const totalScoresIncludingResearch = scoresComputed + researchItemsScored;

    logger.info(
      `[DAILY-SYNC] Complete: ${totalItemsIncludingResearch} items (${totalItemsAdded} from Inoreader, ${researchItemsAdded} from ADS), ${totalScoresIncludingResearch} scored, ${categoriesProcessed.length} categories, ${callsUsed} API calls (${avgItemsPerCall} items/call)`
    );

    return {
      success: true,
      itemsAdded: totalItemsAdded + researchItemsAdded,
      apiCallsUsed: callsUsed,
      categoriesProcessed,
      resumed,
      paused: false,
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    
    // Check if it's a rate limit error
    const isRateLimit = errorMsg.includes('429') || errorMsg.includes('rate limit') || errorMsg.includes('Too Many Requests');
    const pauseError = isRateLimit
      ? 'Rate limit reached (429). Will resume automatically.'
      : errorMsg;

    await saveSyncState({
      continuationToken: continuation,
      itemsProcessed: totalItemsAdded,
      callsUsed,
      status: 'paused',
      error: pauseError,
    });

    logger.error('[DAILY-SYNC] Sync failed', error);

    return {
      success: false,
      itemsAdded: totalItemsAdded,
      apiCallsUsed: callsUsed,
      categoriesProcessed,
      resumed,
      paused: isRateLimit,
      error: pauseError,
    };
  }
}
