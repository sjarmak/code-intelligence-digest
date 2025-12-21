/**
 * API endpoint: POST /api/admin/sync-daily
 * 
 * Daily sync that fetches only the last 30 days of items.
 * 
 * Features:
 * - Time-filtered to last 30 days (reduces API calls to ~5-10)
 * - Resumable if interrupted by rate limits
 * - Safe within 100-call daily budget
 * - Can be run daily with cron-job.org or GitHub Actions
 * 
 * Response:
 * {
 *   "success": true,
 *   "itemsAdded": 500,
 *   "apiCallsUsed": 8,
 *   "categoriesProcessed": ["newsletters", "tech_articles"],
 *   "resumed": false,
 *   "paused": false
 * }
 */

import { NextResponse } from 'next/server';
import { logger } from '@/src/lib/logger';
import { initializeDatabase } from '@/src/lib/db/index';
import { runDailySync } from '@/src/lib/sync/daily-sync';

export async function POST() {
  try {
    logger.info('[SYNC-DAILY-API] Received daily sync request');

    // Initialize database
    await initializeDatabase();

    // Run the daily sync
    const result = await runDailySync();

    logger.info(
      `[SYNC-DAILY-API] Sync ${result.success ? 'succeeded' : 'paused'}: ${result.itemsAdded} items, ${result.apiCallsUsed} calls`
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
    logger.error('[SYNC-DAILY-API] Request failed', error);

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
      .get('daily-sync') as Record<string, unknown> | undefined;

    if (!state) {
      return NextResponse.json({
        status: 'idle',
        message: 'No active sync',
        nextSync: 'Tomorrow or POST /api/admin/sync-daily to start',
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
        message: 'POST /api/admin/sync-daily to resume',
      });
    }

    return NextResponse.json({
      status: s.status,
      itemsProcessed: s.items_processed,
      callsUsed: s.calls_used,
      continuationAvailable: !!s.continuation_token,
    });
  } catch (error) {
    logger.error('[SYNC-DAILY-API] Health check failed', error);
    return NextResponse.json({ status: 'error', error: String(error) }, { status: 500 });
  }
}
