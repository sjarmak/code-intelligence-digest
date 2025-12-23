/**
 * POST /api/admin/sync-catchup?days=7
 * 
 * Fetch items from the last N days instead of just since last sync.
 * Useful for:
 * - Bootstrap: populate empty database with historical data
 * - Catch-up: if you missed syncs for a few days
 * - Backfill: test with recent content
 * 
 * Duplicates are automatically handled by database constraints.
 * Items already in DB are updated (no duplicates created).
 * 
 * Query parameters:
 * - days: number of days to fetch (default: 3, max: 30)
 * 
 * Example:
 *   POST /api/admin/sync-catchup?days=7
 *   Fetches last 7 days of items
 */

import { NextRequest, NextResponse } from 'next/server';
import { runDailySync } from '@/src/lib/sync/daily-sync';
import { logger } from '@/src/lib/logger';

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');

    // Parse days parameter
    let days = 3;  // Default: 3 days
    if (daysParam) {
      const parsed = parseInt(daysParam, 10);
      if (isNaN(parsed) || parsed < 1) {
        return NextResponse.json(
          { error: 'Invalid days parameter (must be >= 1)' },
          { status: 400 }
        );
      }
      if (parsed > 30) {
        return NextResponse.json(
          { error: 'Days parameter too large (max 30)' },
          { status: 400 }
        );
      }
      days = parsed;
    }

    logger.info(`[SYNC-CATCHUP] Starting catch-up sync for last ${days} days`);

    // Run sync with lookback window
    const result = await runDailySync({ lookbackDays: days });

    logger.info('[SYNC-CATCHUP] Catch-up sync complete', {
      itemsAdded: result.itemsAdded,
      apiCallsUsed: result.apiCallsUsed,
      categoriesProcessed: result.categoriesProcessed.length,
    });

    return NextResponse.json({
      success: result.success,
      message: `Catch-up sync completed for last ${days} days`,
      itemsAdded: result.itemsAdded,
      apiCallsUsed: result.apiCallsUsed,
      categoriesProcessed: result.categoriesProcessed,
      paused: result.paused,
      error: result.error,
    });
  } catch (error) {
    logger.error('[SYNC-CATCHUP] Catch-up sync failed', error);

    return NextResponse.json(
      {
        error: 'Catch-up sync failed',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 }
    );
  }
}
