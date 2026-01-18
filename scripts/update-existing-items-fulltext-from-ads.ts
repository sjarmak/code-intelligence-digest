#!/usr/bin/env npx tsx

/**
 * Update existing items' full_text from ads_papers.body
 *
 * This script updates items that already exist in the items table
 * but don't have full_text populated, by copying from ads_papers.body
 *
 * Run with: npx tsx scripts/update-existing-items-fulltext-from-ads.ts
 */

import { detectDriver, getDbClient } from '../src/lib/db/driver';
import { getSqlite } from '../src/lib/db/index';
import { logger } from '../src/lib/logger';

async function updateExistingItemsFullText() {
  try {
    logger.info('🚀 Starting update of existing items full_text from ads_papers...\n');

    const driver = detectDriver();
    let updated = 0;
    let notFound = 0;
    let noBody = 0;

    if (driver === 'postgres') {
      const client = await getDbClient();

      // Update items that have ads: prefix, null full_text, and matching body in ads_papers
      const result = await client.run(`
        UPDATE items
        SET
          full_text = ads_papers.body,
          full_text_source = 'ads_api',
          full_text_fetched_at = EXTRACT(EPOCH FROM NOW())::INTEGER,
          updated_at = EXTRACT(EPOCH FROM NOW())::INTEGER
        FROM ads_papers
        WHERE items.id = 'ads:' || ads_papers.bibcode
          AND items.full_text IS NULL
          AND ads_papers.body IS NOT NULL
          AND LENGTH(ads_papers.body) >= 100
      `);

      updated = result.rowCount || 0;

      // Count items that should have been updated but don't have body in ads_papers
      const notFoundResult = await client.query(`
        SELECT COUNT(*) as count
        FROM items
        WHERE items.id LIKE 'ads:%'
          AND items.full_text IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM ads_papers
            WHERE 'ads:' || ads_papers.bibcode = items.id
              AND ads_papers.body IS NOT NULL
              AND LENGTH(ads_papers.body) >= 100
          )
      `);

      notFound = parseInt(notFoundResult.rows[0]?.count || '0', 10);

    } else {
      const sqlite = getSqlite();

      // Update items that have ads: prefix, null full_text, and matching body in ads_papers
      const updateStmt = sqlite.prepare(`
        UPDATE items
        SET
          full_text = (
            SELECT body FROM ads_papers
            WHERE 'ads:' || ads_papers.bibcode = items.id
              AND ads_papers.body IS NOT NULL
              AND LENGTH(ads_papers.body) >= 100
            LIMIT 1
          ),
          full_text_source = 'ads_api',
          full_text_fetched_at = strftime('%s', 'now'),
          updated_at = strftime('%s', 'now')
        WHERE items.id LIKE 'ads:%'
          AND items.full_text IS NULL
          AND EXISTS (
            SELECT 1 FROM ads_papers
            WHERE 'ads:' || ads_papers.bibcode = items.id
              AND ads_papers.body IS NOT NULL
              AND LENGTH(ads_papers.body) >= 100
          )
      `);

      const updateResult = updateStmt.run();
      updated = updateResult.changes || 0;

      // Count items that should have been updated but don't have body in ads_papers
      const notFoundStmt = sqlite.prepare(`
        SELECT COUNT(*) as count
        FROM items
        WHERE items.id LIKE 'ads:%'
          AND items.full_text IS NULL
          AND NOT EXISTS (
            SELECT 1 FROM ads_papers
            WHERE 'ads:' || ads_papers.bibcode = items.id
              AND ads_papers.body IS NOT NULL
              AND LENGTH(ads_papers.body) >= 100
          )
      `);

      const notFoundResult = notFoundStmt.get() as { count: number } | undefined;
      notFound = notFoundResult?.count || 0;
    }

    logger.info(`\n📊 Summary:`);
    logger.info(`  Updated items: ${updated}`);
    logger.info(`  Items without body in ads_papers: ${notFound}`);
    logger.info(`\n✅ Update complete!`);

  } catch (error) {
    logger.error('Update failed:', error);
    throw error;
  }
}

updateExistingItemsFullText().catch(console.error);
