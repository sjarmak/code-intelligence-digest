/**
 * Shared sync state management for daily and weekly syncs
 *
 * Features:
 * - Unified state interface for all sync types
 * - Database driver abstraction (SQLite dev, PostgreSQL prod)
 * - Resumable sync support with continuation tokens
 * - Progress tracking for rate limit management
 */

import { getDbClient } from '../db/driver';
import { logger } from '../logger';

/**
 * Sync state stored in database
 */
export interface SyncState {
  /** Unique sync identifier (e.g., 'daily-sync', 'weekly-sync') */
  id: string;
  /** Continuation token for resuming pagination */
  continuationToken: string | null;
  /** Number of items processed so far */
  itemsProcessed: number;
  /** Number of API calls used */
  callsUsed: number;
  /** Unix timestamp when sync started */
  startedAt: number;
  /** Unix timestamp of last state update */
  lastUpdatedAt: number;
  /** Current sync status */
  status: 'in_progress' | 'completed' | 'paused';
  /** Error message if sync failed or paused with error */
  error: string | null;
}

/**
 * Database row format (snake_case columns)
 */
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

/**
 * Input for saving sync state (all fields optional except required ones)
 */
export interface SyncStateInput {
  continuationToken?: string | null;
  itemsProcessed: number;
  callsUsed: number;
  status: 'in_progress' | 'completed' | 'paused';
  error?: string;
}

/**
 * Convert database row to SyncState interface
 */
function rowToSyncState(row: SyncStateRow): SyncState {
  return {
    id: row.id,
    continuationToken: row.continuation_token,
    itemsProcessed: row.items_processed,
    callsUsed: row.calls_used,
    startedAt: row.started_at,
    lastUpdatedAt: row.last_updated_at,
    status: row.status as SyncState['status'],
    error: row.error,
  };
}

/**
 * Load sync state from database
 *
 * @param syncId - Unique identifier for the sync (e.g., 'daily-sync', 'weekly-sync')
 * @returns The sync state if found, null otherwise
 *
 * @example
 * const state = await loadSyncState('daily-sync');
 * if (state?.status === 'paused') {
 *   // Resume from state.continuationToken
 * }
 */
export async function loadSyncState(syncId: string): Promise<SyncState | null> {
  try {
    const db = await getDbClient();
    const result = await db.query(
      'SELECT * FROM sync_state WHERE id = ?',
      [syncId]
    );
    const row = result.rows[0] as unknown as SyncStateRow | undefined;

    if (!row) {
      return null;
    }

    return rowToSyncState(row);
  } catch (error) {
    logger.warn(`[SYNC-STATE] Could not load sync state for ${syncId}, starting fresh`, error as Record<string, unknown>);
    return null;
  }
}

/**
 * Save sync state to database for resumption
 *
 * @param syncId - Unique identifier for the sync
 * @param data - State data to save
 *
 * @example
 * await saveSyncState('weekly-sync', {
 *   continuationToken: response.continuation,
 *   itemsProcessed: totalItems,
 *   callsUsed: apiCalls,
 *   status: 'in_progress',
 * });
 */
export async function saveSyncState(syncId: string, data: SyncStateInput): Promise<void> {
  try {
    const db = await getDbClient();
    const now = Math.floor(Date.now() / 1000);

    // Use driver-compatible upsert syntax
    if (db.driver === 'postgres') {
      await db.run(`
        INSERT INTO sync_state
        (id, continuation_token, items_processed, calls_used, started_at, last_updated_at, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (id) DO UPDATE SET
          continuation_token = EXCLUDED.continuation_token,
          items_processed = EXCLUDED.items_processed,
          calls_used = EXCLUDED.calls_used,
          last_updated_at = EXCLUDED.last_updated_at,
          status = EXCLUDED.status,
          error = EXCLUDED.error
      `, [
        syncId,
        data.continuationToken ?? null,
        data.itemsProcessed,
        data.callsUsed,
        now,
        now,
        data.status,
        data.error ?? null
      ]);
    } else {
      await db.run(`
        INSERT OR REPLACE INTO sync_state
        (id, continuation_token, items_processed, calls_used, started_at, last_updated_at, status, error)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `, [
        syncId,
        data.continuationToken ?? null,
        data.itemsProcessed,
        data.callsUsed,
        now,
        now,
        data.status,
        data.error ?? null
      ]);
    }

    logger.debug(`[SYNC-STATE] Saved sync state for ${syncId}`, {
      ...data,
      syncId,
    });
  } catch (error) {
    logger.error(`[SYNC-STATE] Failed to save sync state for ${syncId}`, error);
  }
}

/**
 * Clear sync state when sync completes successfully
 *
 * @param syncId - Unique identifier for the sync to clear
 *
 * @example
 * // After successful sync completion
 * await clearSyncState('daily-sync');
 */
export async function clearSyncState(syncId: string): Promise<void> {
  try {
    const db = await getDbClient();
    await db.run('DELETE FROM sync_state WHERE id = ?', [syncId]);
    logger.info(`[SYNC-STATE] Cleared sync state for ${syncId} (sync complete)`);
  } catch (error) {
    logger.warn(`[SYNC-STATE] Could not clear sync state for ${syncId}`, error as Record<string, unknown>);
  }
}
