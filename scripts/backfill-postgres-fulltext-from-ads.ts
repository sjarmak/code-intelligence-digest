#!/usr/bin/env npx tsx

/**
 * Backfill full_text for research items in PostgreSQL from ads_papers.body
 *
 * This script:
 * 1. Finds research items with ads: prefix that don't have full_text
 * 2. Extracts bibcode from item ID (ads:YYYYarXivYYMMNNNNN -> YYYYarXivYYMMNNNNN)
 * 3. Copies body from ads_papers to items.full_text
 *
 * Run with:
 *   # Source .env.local first to get DATABASE_URL
 *   set -a && source .env.local && set +a && npx tsx scripts/backfill-postgres-fulltext-from-ads.ts
 *
 *   # Or set DATABASE_URL directly
 *   DATABASE_URL=postgres://... npx tsx scripts/backfill-postgres-fulltext-from-ads.ts
 */

import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

async function backfillPostgresFullText() {
  // Check for DATABASE_URL first
  const dbUrl = process.env.DATABASE_URL || process.env.LOCAL_DATABASE_URL;
  if (!dbUrl || !dbUrl.startsWith('postgres')) {
    logger.error('DATABASE_URL or LOCAL_DATABASE_URL must be set to a PostgreSQL connection string.');
    logger.error('Example: DATABASE_URL=postgres://user:pass@host:5432/dbname npx tsx scripts/backfill-postgres-fulltext-from-ads.ts');
    logger.error('Or source .env.local: set -a && source .env.local && set +a && npx tsx scripts/backfill-postgres-fulltext-from-ads.ts');
    process.exit(1);
  }

  const driver = detectDriver();

  if (driver !== 'postgres') {
    logger.error(`This script is for PostgreSQL only. Current driver: ${driver}`);
    logger.error(`DATABASE_URL: ${dbUrl ? 'set' : 'not set'}`);
    logger.error('Please ensure DATABASE_URL is set to a PostgreSQL connection string.');
    process.exit(1);
  }

  const client = await getDbClient();
  const now = Math.floor(Date.now() / 1000);

  logger.info('🔍 Finding research items without full_text...');

  // Find research items with ads: prefix that don't have full_text
  const result = await client.query(
    `SELECT id, title
     FROM items
     WHERE id LIKE 'ads:%'
       AND category = 'research'
       AND (full_text IS NULL OR LENGTH(full_text) < 100)
     ORDER BY published_at DESC
     LIMIT 1000`
  );

  const itemsToBackfill = result.rows as Array<{ id: string; title: string }>;
  logger.info(`Found ${itemsToBackfill.length} research items without full_text\n`);

  if (itemsToBackfill.length === 0) {
    logger.info('✅ All research items already have full_text');
    return;
  }

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of itemsToBackfill) {
    try {
      // Extract bibcode from item ID: ads:YYYYarXivYYMMNNNNN -> YYYYarXivYYMMNNNNN
      const bibcode = item.id.replace(/^ads:/, '');

      if (!bibcode || bibcode.length < 10) {
        logger.warn(`Invalid bibcode for item ${item.id}`);
        skipped++;
        continue;
      }

      // Look up body from ads_papers
      const adsResult = await client.query(
        'SELECT body FROM ads_papers WHERE bibcode = $1 AND body IS NOT NULL AND LENGTH(body) >= 100 LIMIT 1',
        [bibcode]
      );

      if (adsResult.rows.length === 0) {
        skipped++;
        continue;
      }

      const body = (adsResult.rows[0] as { body: string }).body;

      if (body && body.length >= 100) {
        // Update items table with full_text
        await client.query(
          `UPDATE items
           SET full_text = $1,
               full_text_fetched_at = $2,
               full_text_source = 'ads_api'
           WHERE id = $3`,
          [body, now, item.id]
        );
        successful++;

        if (successful % 10 === 0) {
          logger.info(`Progress: ${successful} successful, ${failed} failed, ${skipped} skipped`);
        }
      } else {
        skipped++;
      }
    } catch (error) {
      logger.warn(`Failed to backfill ${item.id}: ${error instanceof Error ? error.message : String(error)}`);
      failed++;
    }
  }

  logger.info(`\n✅ Backfill complete:`);
  logger.info(`   Successful: ${successful}`);
  logger.info(`   Failed: ${failed}`);
  logger.info(`   Skipped (no body in ads_papers): ${skipped}`);
}

backfillPostgresFullText().catch(console.error);
