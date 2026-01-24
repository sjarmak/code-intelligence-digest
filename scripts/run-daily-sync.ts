/**
 * Script to run the daily sync
 * Fetches last 48 hours of items from all Inoreader feeds
 *
 * Usage:
 *   npx tsx scripts/run-daily-sync.ts
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '@/src/lib/db/index';
import { runDailySync } from '@/src/lib/sync/daily-sync';
import { logger } from '@/src/lib/logger';

async function main() {
  try {
    logger.info('[DAILY-SYNC-SCRIPT] Starting daily sync...');

    // Initialize database
    await initializeDatabase();

    // Run the daily sync (fetches last 48 hours by default)
    const result = await runDailySync();

    if (result.success) {
      logger.info('[DAILY-SYNC-SCRIPT] Sync completed successfully', {
        itemsAdded: result.itemsAdded,
        apiCallsUsed: result.apiCallsUsed,
        categoriesProcessed: result.categoriesProcessed,
      });

      console.log('\n✓ Daily sync completed successfully!');
      console.log(`  Items added: ${result.itemsAdded}`);
      console.log(`  API calls used: ${result.apiCallsUsed}`);
      console.log(`  Categories processed: ${result.categoriesProcessed.join(', ')}`);
      console.log(`  Remaining API budget: ${100 - result.apiCallsUsed} calls`);
    } else if (result.paused) {
      logger.warn('[DAILY-SYNC-SCRIPT] Sync paused (rate limit or error)', {
        itemsAdded: result.itemsAdded,
        apiCallsUsed: result.apiCallsUsed,
        error: result.error,
      });

      console.log('\n⚠ Sync paused');
      console.log(`  Items added so far: ${result.itemsAdded}`);
      console.log(`  API calls used: ${result.apiCallsUsed}`);
      console.log(`  Error: ${result.error || 'Rate limit or interruption'}`);
      console.log('  Run again to resume from where it left off');
      process.exit(1);
    } else {
      logger.error('[DAILY-SYNC-SCRIPT] Sync failed', {
        error: result.error,
      });

      console.error('\n✗ Sync failed');
      console.error(`  Error: ${result.error || 'Unknown error'}`);
      process.exit(1);
    }
  } catch (error) {
    logger.error('[DAILY-SYNC-SCRIPT] Fatal error', error);
    console.error('\n✗ Fatal error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

main();

