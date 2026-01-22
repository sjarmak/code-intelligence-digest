/**
 * POST /api/admin/sync-catchup?days=7
 * 
 * Smart catch-up sync that avoids re-fetching items already in database.
 * 
 * By default, if the database has recent items, sync will only fetch items
 * NEWER than the newest item (efficient - uses 1-2 API calls).
 * 
 * Use force=true to bypass this optimization and re-fetch ALL items from
 * the last N days (expensive - may use 100+ API calls, useful for re-categorizing).
 * 
 * Query parameters:
 * - days: number of days to fetch (default: 3, max: 30)
 * - force: if "true", bypass smart sync and re-fetch everything (expensive!)
 * 
 * Examples:
 *   POST /api/admin/sync-catchup?days=3
 *   → Smart sync: only fetches items newer than newest in DB (1-2 API calls)
 * 
 *   POST /api/admin/sync-catchup?days=7&force=true
 *   → Force re-fetch: fetches ALL items from last 7 days (many API calls)
 *   → Use this when you need to re-categorize existing items
 */

import { NextRequest, NextResponse } from 'next/server';
import { runDailySync } from '@/src/lib/sync/daily-sync';
import { logger } from '@/src/lib/logger';

export async function POST(request: NextRequest): Promise<NextResponse> {
  // Note: This endpoint requires authentication via middleware (cookie-based auth)
  // No blockInProduction since authenticated users should be able to catch up

  try {
    const searchParams = request.nextUrl.searchParams;
    const daysParam = searchParams.get('days');
    const forceParam = searchParams.get('force');

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

    const force = forceParam === 'true';
    const mode = force ? 'force' : 'smart';
    
    logger.info(`[SYNC-CATCHUP] Starting ${mode} catch-up sync for last ${days} days`);
    
    if (force) {
      logger.warn(`[SYNC-CATCHUP] Force mode enabled - will re-fetch all items from last ${days} days (expensive!)`);
    }

    // Run sync with lookback window
    const result = await runDailySync({ lookbackDays: days, forceLookback: force });

    logger.info('[SYNC-CATCHUP] Catch-up sync complete', {
      itemsAdded: result.itemsAdded,
      apiCallsUsed: result.apiCallsUsed,
      categoriesProcessed: result.categoriesProcessed.length,
      mode,
    });

    return NextResponse.json({
      success: result.success,
      message: `${mode === 'force' ? 'Force' : 'Smart'} catch-up sync completed for last ${days} days`,
      mode,
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
