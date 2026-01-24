#!/usr/bin/env tsx
/**
 * Clear paused sync state to allow resumption
 * 
 * The sync was paused on Jan 21 due to Inoreader 429 rate limit.
 * This script clears the paused state so the next cron run can retry.
 * 
 * Usage:
 *   npx tsx scripts/unpause-sync.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

async function main() {
  try {
    logger.info('🔄 Initializing database...');
    await initializeDatabase();
    const client = await getDbClient();

    logger.info('🔍 Checking current sync state...');
    const result = await client.query('SELECT * FROM sync_state WHERE id = ?', ['daily-sync']);

    if (result.rows.length === 0) {
      logger.info('✅ No paused sync found - sync is already in good state');
      return;
    }

    const state = result.rows[0] as any;
    logger.info('Found paused sync:', {
      status: state.status,
      started_at: new Date(state.started_at * 1000).toISOString(),
      error: state.error,
    });

    if (state.status === 'paused') {
      logger.warn('⚠️  Sync is paused. Clearing to allow resumption...');
      
      // Delete the paused state
      await client.run('DELETE FROM sync_state WHERE id = ?', ['daily-sync']);
      
      logger.info('✅ Cleared paused sync state');
      logger.info('📅 Next hourly cron run will restart the sync fresh');
      logger.info('⏱️  Expected: Within 1 hour');
    } else {
      logger.info(`✅ Sync status is '${state.status}' (not paused)`);
    }
  } catch (error) {
    logger.error('❌ Failed to unpause sync', error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Unhandled error:', error);
  process.exit(1);
});
