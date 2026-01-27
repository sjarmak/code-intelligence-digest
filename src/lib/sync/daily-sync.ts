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

import { createInoreaderClient } from "../inoreader/client";
import { normalizeItems } from "../pipeline/normalize";
import { categorizeItems } from "../pipeline/categorize";
import { decomposeFeedItems } from "../pipeline/decompose";
import { saveItems, getNewestItemTimestamp } from "../db/items";
import { computeAndSaveScoresForItems } from "../pipeline/compute-scores";
import { logger } from "../logger";
import { Category, FeedItem } from "../model";
import { getDbClient, detectDriver, nowTimestamp } from "../db/driver";
import { getCachedUserId, setCachedUserId } from "../db/index";
import { incrementApiCalls } from "../db/api-budget";
import { syncResearchFromADS } from "./ads-research-sync";
import { findUnknownFeeds, forceRefreshFeedsCache } from "../../config/feeds";

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
  "newsletters",
  "podcasts",
  "tech_articles",
  "ai_news",
  "product_news",
  "community",
  "research",
  "marketing",
];

const SYNC_ID = "daily-sync";
// Inoreader supports up to 1000 items per request - use max to minimize API calls
const STREAM_PAGE_SIZE = 1000;

/**
 * Load existing sync state (if resuming)
 * Exported for use in cron job to check/manage pause state
 */
export async function loadSyncState(): Promise<SyncStateRow | null> {
  try {
    const client = await getDbClient();
    // Use SQLite-style ? placeholder - Postgres client will convert it
    const result = await client.query("SELECT * FROM sync_state WHERE id = ?", [
      SYNC_ID,
    ]);

    if (result.rows.length === 0) {
      return null;
    }

    const row = result.rows[0] as unknown as SyncStateRow;
    return row;
  } catch (error) {
    logger.error("[DAILY-SYNC] Failed to load sync state", error);
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
  status: "in_progress" | "completed" | "paused";
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

    logger.debug("[DAILY-SYNC] Saved sync state", data);
  } catch (error) {
    logger.error("[DAILY-SYNC] Failed to save sync state", error);
  }
}

/**
 * Clear sync state when completed or to recover from pause state
 */
export async function clearSyncState(): Promise<void> {
  try {
    const client = await getDbClient();
    const driver = detectDriver();
    const sql =
      driver === "postgres"
        ? "DELETE FROM sync_state WHERE id = $1"
        : "DELETE FROM sync_state WHERE id = ?";
    await client.run(sql, [SYNC_ID]);
    logger.info("[DAILY-SYNC] Cleared sync state (sync complete)");
  } catch (error) {
    logger.warn(
      "[DAILY-SYNC] Could not clear sync state",
      error as Record<string, unknown>,
    );
  }
}

export async function runDailySync(options?: {
  lookbackDays?: number;
  forceLookback?: boolean;
}): Promise<{
  success: boolean;
  itemsAdded: number;
  apiCallsUsed: number;
  categoriesProcessed: Category[];
  resumed: boolean;
  paused: boolean;
  error?: string;
}> {
  logger.info("[DAILY-SYNC] Starting daily sync (fetch newer items)");

  const client = createInoreaderClient();
  let totalItemsAdded = 0;
  let callsUsed = 0; // Tracked locally and in database budget
  const categoriesProcessed: Category[] = [];
  const isCatchup = !!options?.lookbackDays;
  const lookbackDays = options?.lookbackDays;
  const forceLookback = options?.forceLookback ?? false;

  // Load existing state (if resuming)
  const existingState = await loadSyncState();
  const resumed = !!existingState && existingState.status === "paused";
  let continuation = existingState?.continuation_token || undefined;

  let researchItemsAdded = 0;
  let researchItemsScored = 0;

  try {
    // Sync research from ADS instead of Inoreader
    const adsToken = process.env.ADS_API_TOKEN;

    if (adsToken) {
      try {
        logger.info("[DAILY-SYNC] Syncing research papers from ADS...");
        const researchResult = await syncResearchFromADS(adsToken);
        researchItemsAdded = researchResult.itemsAdded;
        researchItemsScored = researchResult.itemsScored;
        logger.info(
          `[DAILY-SYNC] ADS research sync: ${researchItemsAdded} items added, ${researchItemsScored} scored`,
        );

        // Add research to categories processed
        if (
          researchItemsAdded > 0 &&
          !categoriesProcessed.includes("research")
        ) {
          categoriesProcessed.push("research");
        }
      } catch (error) {
        logger.error(
          "[DAILY-SYNC] ADS research sync failed (continuing with Inoreader sync)",
          error,
        );
      }
    }

    // Get user ID (cached, no API call if available)
    let userId: string | null = await getCachedUserId();

    if (!userId) {
      logger.debug("[DAILY-SYNC] User ID not cached. Fetching from API...");
      try {
        const userInfo = (await client.getUserInfo()) as
          | Record<string, unknown>
          | undefined;
        userId = (userInfo?.userId || userInfo?.id) as string | null;

        if (!userId) {
          throw new Error("Could not determine user ID from Inoreader");
        }

        // Cache it for future syncs
        await setCachedUserId(userId);
        logger.info("[DAILY-SYNC] Cached user ID for future syncs");

        callsUsed++;
        await incrementApiCalls(1);
      } catch (error) {
        // If getUserInfo fails (e.g., 429 error), handle based on error type
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.error(`[DAILY-SYNC] Failed to fetch user info: ${errorMsg}`);

        // Check if it's a 429 (rate limit) or other error
        const isRateLimit =
          errorMsg.includes("429") ||
          errorMsg.includes("rate limit") ||
          errorMsg.includes("Too Many Requests");

        if (isRateLimit) {
          // For rate limits: Don't pause (which requires manual recovery)
          // Instead, exit cleanly and let hourly cron retry automatically
          // This is better because rate limits are transient
          logger.warn(
            `[DAILY-SYNC] Rate limit hit (429). Exiting cleanly for hourly retry. Attempt ${totalItemsAdded > 0 ? "had some progress" : "was fresh"}.`,
          );
          return {
            success: false,
            itemsAdded: totalItemsAdded,
            apiCallsUsed: callsUsed,
            categoriesProcessed,
            resumed,
            paused: false, // Don't pause - let hourly cron retry
            error: `Rate limit (429). Will retry in next hourly cycle (~1 hour).`,
          };
        }

        // For permanent errors (auth, config, etc), pause to prevent retry loop
        logger.error(`[DAILY-SYNC] Permanent error, pausing sync: ${errorMsg}`);
        await saveSyncState({
          continuationToken: continuation,
          itemsProcessed: totalItemsAdded,
          callsUsed,
          status: "paused",
          error: `Failed to fetch user info: ${errorMsg}. Requires manual investigation.`,
        });
        return {
          success: false,
          itemsAdded: totalItemsAdded,
          apiCallsUsed: callsUsed,
          categoriesProcessed,
          resumed,
          paused: true,
          error: `Failed to fetch user info: ${errorMsg}`,
        };
      }
    } else {
      logger.debug("[DAILY-SYNC] Using cached user ID");
    }

    // Determine sync time window
    // Using `nt` (newer than) for server-side filtering - Inoreader only returns items newer than this
    // Key insight: use the newest item timestamp to avoid gaps when syncs are delayed/blocked
    let syncSinceTimestamp: number;
    let reason: string;

    // Get newest item timestamp first - used in both modes
    const newestItemTimestamp = await getNewestItemTimestamp();
    const DEFAULT_WINDOW_HOURS = 4;
    const defaultTimestamp = Math.floor(
      (Date.now() - DEFAULT_WINDOW_HOURS * 60 * 60 * 1000) / 1000,
    );

    if (isCatchup && lookbackDays) {
      // Catch-up mode: SMART catch-up that avoids re-fetching existing items
      // Only go back further than newestItemTimestamp if there's actually a gap
      // Unless forceLookback=true, which bypasses the optimization (for re-categorizing)
      const lookbackTimestamp = Math.floor(
        (Date.now() - lookbackDays * 24 * 60 * 60 * 1000) / 1000,
      );

      if (forceLookback) {
        // Force mode: re-fetch all items from lookback period (expensive, for re-categorizing)
        syncSinceTimestamp = lookbackTimestamp;
        reason = `last ${lookbackDays} days (FORCE mode - re-fetching all items)`;
        logger.warn(
          `[DAILY-SYNC] Force catch-up: will re-fetch ALL items from last ${lookbackDays} days (expensive!)`,
        );
      } else if (
        newestItemTimestamp &&
        newestItemTimestamp > lookbackTimestamp
      ) {
        // We have items newer than the lookback - use newest item timestamp instead
        // This prevents re-fetching thousands of existing items
        syncSinceTimestamp = newestItemTimestamp - 60; // 60s buffer
        const hoursAgo = (Date.now() / 1000 - syncSinceTimestamp) / 3600;
        reason = `since newest item (${hoursAgo.toFixed(1)}h ago) - catch-up mode but DB has recent items`;
        logger.info(
          `[DAILY-SYNC] Catch-up requested ${lookbackDays}d but DB has items from ${hoursAgo.toFixed(1)}h ago - using smart sync`,
        );
      } else {
        // No items in lookback period - do full catch-up
        syncSinceTimestamp = lookbackTimestamp;
        reason = `last ${lookbackDays} days (catch-up mode, no recent items in DB)`;
      }
    } else {
      // Normal mode: fetch items newer than our newest item (with fallback)
      // This ensures no gaps even if syncs are blocked for hours
      const MAX_LOOKBACK_DAYS = 7; // Safety limit to avoid massive catch-ups
      const maxLookbackTimestamp = Math.floor(
        (Date.now() - MAX_LOOKBACK_DAYS * 24 * 60 * 60 * 1000) / 1000,
      );

      if (newestItemTimestamp && newestItemTimestamp > maxLookbackTimestamp) {
        // Use newest item timestamp (subtract 60s buffer for edge cases)
        syncSinceTimestamp = newestItemTimestamp - 60;
        const hoursAgo = (Date.now() / 1000 - syncSinceTimestamp) / 3600;
        reason = `since last sync (${hoursAgo.toFixed(1)}h ago, server-side nt filter)`;
      } else if (newestItemTimestamp) {
        // Newest item is older than max lookback - use max lookback to avoid huge catch-up
        syncSinceTimestamp = maxLookbackTimestamp;
        reason = `last ${MAX_LOOKBACK_DAYS} days (capped, server-side nt filter)`;
      } else {
        // No items yet - use default window
        syncSinceTimestamp = defaultTimestamp;
        reason = `last ${DEFAULT_WINDOW_HOURS} hours (first sync, server-side nt filter)`;
      }
    }

    const allItemsStreamId = `user/${userId}/state/com.google/all`;

    logger.info(
      `[DAILY-SYNC] Fetching items ${reason} (${new Date(syncSinceTimestamp * 1000).toISOString()})`,
    );

    let batchNumber = 0;
    let hasMoreItems = true;
    const allItemsToScore: FeedItem[] = [];
    let totalScoresComputed = 0;

    while (hasMoreItems) {
      batchNumber++;

      logger.debug(
        `[DAILY-SYNC] Fetching batch ${batchNumber}${continuation ? " (continuation)" : ""} (${callsUsed} calls used so far)`,
      );

      try {
        // Fetch batch - use `ot` for server-side filtering (only items NEWER than timestamp)
        // Note: Inoreader's naming is counterintuitive:
        //   - `ot` = "older than" = exclude items older than this = return items PUBLISHED AFTER this time
        //   - `nt` = "newer than" = exclude items newer than this = return items PUBLISHED BEFORE this time
        // We want items NEWER than syncSinceTimestamp, so we use `ot`
        const response = await client.getStreamContents(allItemsStreamId, {
          n: STREAM_PAGE_SIZE,
          continuation,
          ot: syncSinceTimestamp,
        });

        callsUsed++;
        await incrementApiCalls(1);

        if (!response.items || response.items.length === 0) {
          logger.info("[DAILY-SYNC] No more items to fetch (empty response)");
          hasMoreItems = false;
          break;
        }

        // Check for unknown feeds on first batch - auto-refresh cache if new subscriptions detected
        if (batchNumber === 1) {
          const streamIds = response.items
            .map((item) => item.origin?.streamId)
            .filter((id): id is string => !!id);
          const uniqueStreamIds = [...new Set(streamIds)];
          const unknownFeeds = await findUnknownFeeds(uniqueStreamIds);

          if (unknownFeeds.length > 0) {
            logger.info(
              `[DAILY-SYNC] Detected ${unknownFeeds.length} unknown feeds - refreshing feeds cache`,
              {
                unknownFeeds: unknownFeeds.slice(0, 5), // Log first 5
              },
            );

            try {
              const refreshResult = await forceRefreshFeedsCache();
              callsUsed++; // forceRefreshFeedsCache makes 1 API call
              await incrementApiCalls(1);

              logger.info(
                `[DAILY-SYNC] Feeds cache refreshed: ${refreshResult.total} total, ${refreshResult.newFeeds.length} new`,
              );
            } catch (refreshError) {
              logger.warn(
                "[DAILY-SYNC] Failed to refresh feeds cache, continuing with existing cache",
                {
                  error: refreshError,
                },
              );
            }
          }
        }

        // Normalize, decompose newsletters, and categorize
        let items = await normalizeItems(response.items);
        items = decomposeFeedItems(items);
        items = categorizeItems(items);

        // Server-side `ot` filter + DB deduplication (ON CONFLICT) handle filtering.
        // No client-side timestamp filter needed — it previously caused items to be
        // silently discarded when crawlTimeMsec diverged from the DB created_at used
        // to compute the sync window.
        logger.info(
          `[DAILY-SYNC] Batch ${batchNumber}: ${response.items.length} raw -> ${items.length} processed items`,
        );

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
              logger.debug(
                `[DAILY-SYNC] Batch ${batchNumber}: scoring ${categoryItems.length} items immediately after save...`,
              );
              const batchScoreResult =
                await computeAndSaveScoresForItems(categoryItems);
              totalScoresComputed += batchScoreResult.totalScored;
            } catch (scoreError) {
              logger.error(
                `[DAILY-SYNC] Batch ${batchNumber}: Failed to score items (will retry at end)`,
                scoreError,
              );
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
          status: continuation ? "in_progress" : "completed",
        });

        hasMoreItems = !!continuation && continuation.length > 0;
      } catch (error) {
        // Check if it's a 429 (rate limit) error
        const errorMsg = error instanceof Error ? error.message : String(error);
        const isRateLimit =
          errorMsg.includes("429") ||
          errorMsg.includes("rate limit") ||
          errorMsg.includes("Too Many Requests");

        if (isRateLimit) {
          // For rate limits: Don't pause (which requires manual recovery)
          // Instead, exit cleanly and let hourly cron retry automatically
          logger.warn(
            `[DAILY-SYNC] Rate limit reached (429). Exiting cleanly. Will retry in next hourly cycle.`,
          );
          logger.info(
            `[DAILY-SYNC] Made progress: ${totalItemsAdded} items added, ${callsUsed} API calls used`,
          );

          // Save progress so far (don't pause, just mark as exit)
          if (continuation) {
            // If we have a continuation token, save it for later retry
            await saveSyncState({
              continuationToken: continuation,
              itemsProcessed: totalItemsAdded,
              callsUsed,
              status: "in_progress", // Mark as paused progress, not as failed
              error: "Rate limited - will resume from continuation token",
            });
          }

          return {
            success: false,
            itemsAdded: totalItemsAdded,
            apiCallsUsed: callsUsed,
            categoriesProcessed,
            resumed,
            paused: false, // Don't pause - let hourly cron retry
            error: `Rate limit (429) after ${totalItemsAdded} items. Will retry in next hourly cycle.`,
          };
        }

        // For other errors, re-throw to be handled by caller
        throw error;
      }
    }

    // Score any remaining items that weren't scored during batch processing
    let scoresComputed = totalScoresComputed;
    if (allItemsToScore.length > 0) {
      logger.info(
        `[DAILY-SYNC] Computing relevance scores for ${allItemsToScore.length} remaining items...`,
      );
      try {
        const scoreResult = await computeAndSaveScoresForItems(allItemsToScore);
        scoresComputed += scoreResult.totalScored;
        logger.info(
          `[DAILY-SYNC] Computed and saved scores for ${scoreResult.totalScored} remaining items across ${scoreResult.categoriesScored.length} categories`,
        );
      } catch (error) {
        logger.error(
          `[DAILY-SYNC] Failed to compute scores for remaining items (items still saved)`,
          error,
        );
      }
    } else {
      logger.info(
        `[DAILY-SYNC] All items were scored during batch processing - no remaining items to score`,
      );
    }

    await clearSyncState();

    const avgItemsPerCall =
      totalItemsAdded > 0 ? (totalItemsAdded / callsUsed).toFixed(1) : "0";
    const totalItemsIncludingResearch = totalItemsAdded + researchItemsAdded;
    const totalScoresIncludingResearch = scoresComputed + researchItemsScored;

    logger.info(
      `[DAILY-SYNC] Complete: ${totalItemsIncludingResearch} items (${totalItemsAdded} from Inoreader, ${researchItemsAdded} from ADS), ${totalScoresIncludingResearch} scored, ${categoriesProcessed.length} categories, ${callsUsed} API calls (${avgItemsPerCall} items/call)`,
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
    const isRateLimit =
      errorMsg.includes("429") ||
      errorMsg.includes("rate limit") ||
      errorMsg.includes("Too Many Requests");
    const pauseError = isRateLimit
      ? "Rate limit reached (429). Will resume automatically."
      : errorMsg;

    await saveSyncState({
      continuationToken: continuation,
      itemsProcessed: totalItemsAdded,
      callsUsed,
      status: "paused",
      error: pauseError,
    });

    logger.error("[DAILY-SYNC] Sync failed", error);

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
