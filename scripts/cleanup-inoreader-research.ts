#!/usr/bin/env tsx
/**
 * Cleanup script to remove old Inoreader research items
 *
 * Since we now sync research from ADS instead of Inoreader, this script
 * removes old research items that came from Inoreader feeds.
 *
 * Usage:
 *   npx tsx scripts/cleanup-inoreader-research.ts [--dry-run] [--days=7]
 *
 * Options:
 *   --dry-run: Show what would be deleted without actually deleting
 *   --days=N: Only delete items older than N days (default: 0, delete all)
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

interface CleanupStats {
  totalFound: number;
  deleted: number;
  errors: number;
  skipped: number;
}

async function cleanupInoreaderResearch(options: {
  dryRun: boolean;
  daysOld?: number;
}): Promise<CleanupStats> {
  const { dryRun, daysOld } = options;

  logger.info(`\n🧹 Starting cleanup of Inoreader research items${dryRun ? ' (DRY RUN)' : ''}...`);
  if (daysOld !== undefined && daysOld > 0) {
    logger.info(`   Only deleting items older than ${daysOld} days`);
  }

  await initializeDatabase();
  const client = await getDbClient();
  const driver = detectDriver();

  // Build query to find Inoreader research items
  // Inoreader items have IDs starting with "tag:google.com"
  // ADS items have IDs starting with "ads:"
  let whereClause = "category = 'research' AND id LIKE 'tag:google.com%'";
  const params: any[] = [];

  if (daysOld !== undefined && daysOld > 0) {
    const cutoffTime = Math.floor((Date.now() - daysOld * 24 * 60 * 60 * 1000) / 1000);
    whereClause += ` AND created_at < ?`;
    params.push(cutoffTime);
  }

  // First, count how many items we'll delete
  const countResult = await client.query(
    `SELECT COUNT(*) as count FROM items WHERE ${whereClause}`,
    params
  );
  const totalFound = driver === 'postgres'
    ? parseInt((countResult.rows[0] as any).count, 10)
    : (countResult.rows[0] as any).count;

  logger.info(`\n📊 Found ${totalFound} Inoreader research items to ${dryRun ? 'delete (dry run)' : 'delete'}`);

  if (totalFound === 0) {
    logger.info('✅ No items to clean up');
    return { totalFound: 0, deleted: 0, errors: 0, skipped: 0 };
  }

  // Show some examples (use driver-specific date formatting)
  const dateFormatExpr = driver === 'postgres'
    ? `to_timestamp(created_at)::text`
    : `datetime(created_at, 'unixepoch')`;
  const sampleResult = await client.query(
    `SELECT id, source_title, title, ${dateFormatExpr} as created FROM items WHERE ${whereClause} ORDER BY created_at DESC LIMIT 5`,
    params
  );

  if (sampleResult.rows.length > 0) {
    logger.info('\n📋 Sample items that will be deleted:');
    sampleResult.rows.forEach((row: any) => {
      const r = row as { id: string; source_title: string; title: string; created: string };
      logger.info(`   - ${r.source_title}: ${r.title.substring(0, 60)}... (${r.created})`);
    });
  }

  if (dryRun) {
    logger.info('\n🔍 DRY RUN: No items were actually deleted');
    return { totalFound, deleted: 0, errors: 0, skipped: totalFound };
  }

  // Confirm deletion
  logger.info(`\n⚠️  About to delete ${totalFound} items...`);

  // Delete items
  let deleted = 0;
  let errors = 0;

  try {
    // Delete in batches to avoid overwhelming the database
    const BATCH_SIZE = 1000;

    while (deleted < totalFound) {
      // Check remaining count before deletion
      const beforeResult = await client.query(
        `SELECT COUNT(*) as count FROM items WHERE ${whereClause}`,
        params
      );
      const before = driver === 'postgres'
        ? parseInt((beforeResult.rows[0] as any).count, 10)
        : (beforeResult.rows[0] as any).count;

      if (before === 0) break;

      // Delete batch (PostgreSQL needs subquery for LIMIT)
      if (driver === 'postgres') {
        // PostgreSQL: Use DELETE with subquery for LIMIT
        await client.query(
          `DELETE FROM items WHERE id IN (SELECT id FROM items WHERE ${whereClause} LIMIT ${BATCH_SIZE})`,
          params
        );
      } else {
        // SQLite: Can use LIMIT directly
        await client.query(
          `DELETE FROM items WHERE ${whereClause} LIMIT ${BATCH_SIZE}`,
          params
        );
      }

      // Check remaining count after deletion
      const afterResult = await client.query(
        `SELECT COUNT(*) as count FROM items WHERE ${whereClause}`,
        params
      );
      const after = driver === 'postgres'
        ? parseInt((afterResult.rows[0] as any).count, 10)
        : (afterResult.rows[0] as any).count;

      const batchDeleted = before - after;
      deleted += batchDeleted;

      logger.info(`   Deleted batch: ${deleted}/${totalFound} items (${after} remaining)`);

      if (batchDeleted === 0) {
        // No more items deleted, break to avoid infinite loop
        break;
      }
    }

    // Also delete associated scores
    logger.info('\n🧹 Cleaning up associated item scores...');
    const scoresBeforeResult = await client.query(
      `SELECT COUNT(*) as count FROM item_scores WHERE item_id LIKE 'tag:google.com%' AND category = 'research'`
    );
    const scoresBefore = driver === 'postgres'
      ? parseInt((scoresBeforeResult.rows[0] as any).count, 10)
      : (scoresBeforeResult.rows[0] as any).count;

    await client.query(
      `DELETE FROM item_scores WHERE item_id LIKE 'tag:google.com%' AND category = 'research'`
    );

    const scoresAfterResult = await client.query(
      `SELECT COUNT(*) as count FROM item_scores WHERE item_id LIKE 'tag:google.com%' AND category = 'research'`
    );
    const scoresAfter = driver === 'postgres'
      ? parseInt((scoresAfterResult.rows[0] as any).count, 10)
      : (scoresAfterResult.rows[0] as any).count;

    const scoresDeleted = scoresBefore - scoresAfter;
    logger.info(`   Deleted ${scoresDeleted} associated scores`);

    // Also delete embeddings if they exist
    try {
      const embeddingsBeforeResult = await client.query(
        `SELECT COUNT(*) as count FROM item_embeddings WHERE item_id LIKE 'tag:google.com%'`
      );
      const embeddingsBefore = driver === 'postgres'
        ? parseInt((embeddingsBeforeResult.rows[0] as any).count, 10)
        : (embeddingsBeforeResult.rows[0] as any).count;

      await client.query(
        `DELETE FROM item_embeddings WHERE item_id LIKE 'tag:google.com%'`
      );

      const embeddingsAfterResult = await client.query(
        `SELECT COUNT(*) as count FROM item_embeddings WHERE item_id LIKE 'tag:google.com%'`
      );
      const embeddingsAfter = driver === 'postgres'
        ? parseInt((embeddingsAfterResult.rows[0] as any).count, 10)
        : (embeddingsAfterResult.rows[0] as any).count;

      const embeddingsDeleted = embeddingsBefore - embeddingsAfter;
      if (embeddingsDeleted > 0) {
        logger.info(`   Deleted ${embeddingsDeleted} associated embeddings`);
      }
    } catch (error) {
      // Embeddings table might not exist, that's okay
      logger.debug('   No embeddings to clean up (table may not exist)');
    }

  } catch (error) {
    logger.error('Error during deletion', error);
    errors++;
  }

  logger.info(`\n✅ Cleanup complete: ${deleted} items deleted, ${errors} errors`);

  return {
    totalFound,
    deleted,
    errors,
    skipped: dryRun ? totalFound : 0,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const daysArg = args.find(arg => arg.startsWith('--days='));
  const daysOld = daysArg ? parseInt(daysArg.split('=')[1], 10) : undefined;

  if (daysOld !== undefined && (isNaN(daysOld) || daysOld < 0)) {
    console.error('Error: --days must be a non-negative integer');
    process.exit(1);
  }

  try {
    const stats = await cleanupInoreaderResearch({ dryRun, daysOld });

    console.log('\n' + '='.repeat(60));
    console.log('📊 Cleanup Summary');
    console.log('='.repeat(60));
    console.log(`Total found:     ${stats.totalFound}`);
    console.log(`Deleted:         ${stats.deleted}`);
    console.log(`Skipped:         ${stats.skipped}`);
    console.log(`Errors:          ${stats.errors}`);
    console.log('='.repeat(60) + '\n');

    if (dryRun) {
      console.log('💡 This was a dry run. Run without --dry-run to actually delete items.');
    }
  } catch (error) {
    logger.error('Cleanup failed', error);
    console.error('\n❌ Cleanup failed:', error);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((error) => {
    logger.error('Unhandled error in cleanup script', error);
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

