/**
 * API endpoint: POST /api/admin/sync-weekly
 * 
 * Weekly sync that fetches the last 7 days of items in a single optimized call.
 * 
 * Features:
 * - Fetches last 7 days of unread items in one batch
 * - Uses n=1000 to minimize continuation tokens
 * - Handles continuation if needed (rare for 7 days)
 * - Resumable if interrupted by rate limits
 * - ~1-2 API calls typical
 * 
 * Response:
 * {
 *   "success": true,
 *   "itemsAdded": 500,
 *   "apiCallsUsed": 2,
 *   "categoriesProcessed": ["newsletters", "tech_articles"],
 *   "resumed": false,
 *   "paused": false
 * }
 */

import { NextResponse } from 'next/server';
import { logger } from '@/src/lib/logger';
import { initializeDatabase } from '@/src/lib/db/index';
import { runWeeklySync } from '@/src/lib/sync/weekly-sync';
import { blockInProduction } from '@/src/lib/auth/guards';

export async function POST() {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    logger.info('[SYNC-WEEKLY-API] Received weekly sync request');

    // Initialize database
    await initializeDatabase();

    // Run the weekly sync
    const result = await runWeeklySync();

    logger.info(
      `[SYNC-WEEKLY-API] Sync ${result.success ? 'succeeded' : 'paused'}: ${result.itemsAdded} items, ${result.apiCallsUsed} calls`
    );

    return NextResponse.json({
      success: result.success,
      itemsAdded: result.itemsAdded,
      apiCallsUsed: result.apiCallsUsed,
      categoriesProcessed: result.categoriesProcessed,
      resumed: result.resumed,
      paused: result.paused,
      error: result.error,
      message: result.paused
        ? `Sync paused (${result.itemsAdded} items added, ${result.apiCallsUsed} calls used). Will resume tomorrow.`
        : `Sync complete (${result.itemsAdded} items, ${result.apiCallsUsed} calls, ${100 - result.apiCallsUsed} remaining)`,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logger.error('[SYNC-WEEKLY-API] Request failed', error);

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      { status: 500 }
    );
  }
}

/**
 * GET for health check / resume status
 */
export async function GET() {
  try {
    await initializeDatabase();

    // Check sync state
    const sqlite = (await import('@/src/lib/db/index')).getSqlite();
    const state = sqlite
      .prepare('SELECT * FROM sync_state WHERE id = ?')
      .get('weekly-sync') as Record<string, unknown> | undefined;

    if (!state) {
      return NextResponse.json({
        status: 'idle',
        message: 'No active sync',
        nextSync: 'POST /api/admin/sync-weekly to start',
      });
    }

    const s = state as Record<string, unknown>;
    
    if (s.status === 'completed') {
      return NextResponse.json({
        status: 'completed',
        itemsProcessed: s.items_processed,
        callsUsed: s.calls_used,
        completedAt: new Date(Number(s.last_updated_at) * 1000).toISOString(),
      });
    }

    if (s.status === 'paused') {
      return NextResponse.json({
        status: 'paused',
        reason: s.error,
        itemsProcessed: s.items_processed,
        callsUsed: s.calls_used,
        resumable: true,
        message: 'POST /api/admin/sync-weekly to resume',
      });
    }

    return NextResponse.json({
      status: s.status,
      itemsProcessed: s.items_processed,
      callsUsed: s.calls_used,
      continuationAvailable: !!s.continuation_token,
    });
  } catch (error) {
    logger.error('[SYNC-WEEKLY-API] Health check failed', error);
    return NextResponse.json({ status: 'error', error: String(error) }, { status: 500 });
  }
}
