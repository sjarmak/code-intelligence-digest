#!/usr/bin/env npx tsx

/**
 * Backfill full_text for research items from ads_papers.body
 *
 * This script:
 * 1. Finds research items that don't have full_text
 * 2. Looks up their bibcode from the URL
 * 3. Copies body from ads_papers to items.full_text
 *
 * Run with: npx tsx scripts/backfill-research-fulltext-from-ads.ts
 */

import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { getSqlite } from '../src/lib/db/index';
import { saveFullText } from '../src/lib/db/items';
import { logger } from '../src/lib/logger';

function extractBibcodeFromUrl(url: string): string | null {
  // Match arXiv URLs: arxiv.org/abs/YYMM.NNNNN
  const arxivMatch = url.match(/arxiv\.org(?:\/abs|\/pdf)\/(\d{4}\.\d{4,5})/);
  if (arxivMatch) {
    // Convert to bibcode format: YYYYarXivYYMMNNNNN
    const arxivId = arxivMatch[1];
    const [year, num] = arxivId.split('.');
    const yearShort = year.substring(2); // Last 2 digits
    const numPadded = num.padStart(5, '0');
    return `20${yearShort}arXiv${year}${numPadded}`;
  }

  // Match ADS URLs: adsabs.harvard.edu/abs/YYYYarXivYYMMNNNNN
  const adsMatch = url.match(/adsabs\.harvard\.edu\/abs\/(\d{4}arXiv\d{4,5}\w*)/);
  if (adsMatch) {
    return adsMatch[1];
  }

  return null;
}

async function backfillResearchFullText() {
  const driver = detectDriver();
  const now = Math.floor(Date.now() / 1000);

  logger.info('🔍 Finding research items without full_text...');

  let itemsToBackfill: Array<{ id: string; url: string; title: string }> = [];

  if (driver === 'postgres') {
    const client = await getDbClient();
    const result = await client.query(
      `SELECT id, url, title
       FROM items
       WHERE category = 'research'
         AND (full_text IS NULL OR LENGTH(full_text) < 100)
       ORDER BY published_at DESC
       LIMIT 1000`
    );
    itemsToBackfill = result.rows as Array<{ id: string; url: string; title: string }>;
  } else {
    const sqlite = getSqlite();
    itemsToBackfill = sqlite
      .prepare(
        `SELECT id, url, title
         FROM items
         WHERE category = 'research'
           AND (full_text IS NULL OR LENGTH(full_text) < 100)
         ORDER BY published_at DESC
         LIMIT 1000`
      )
      .all() as Array<{ id: string; url: string; title: string }>;
  }

  logger.info(`Found ${itemsToBackfill.length} research items without full_text`);

  if (itemsToBackfill.length === 0) {
    logger.info('✅ All research items already have full_text');
    return;
  }

  let successful = 0;
  let failed = 0;
  let skipped = 0;

  for (const item of itemsToBackfill) {
    try {
      const bibcode = extractBibcodeFromUrl(item.url);
      if (!bibcode) {
        skipped++;
        continue;
      }

      // Look up body from ads_papers
      let body: string | null = null;

      if (driver === 'postgres') {
        const client = await getDbClient();
        const result = await client.query(
          'SELECT body FROM ads_papers WHERE bibcode = $1 AND body IS NOT NULL AND LENGTH(body) >= 100 LIMIT 1',
          [bibcode]
        );
        if (result.rows.length > 0) {
          body = (result.rows[0] as { body: string }).body;
        }
      } else {
        const sqlite = getSqlite();
        const row = sqlite
          .prepare('SELECT body FROM ads_papers WHERE bibcode = ? AND body IS NOT NULL AND LENGTH(body) >= 100 LIMIT 1')
          .get(bibcode) as { body: string } | undefined;
        if (row) {
          body = row.body;
        }
      }

      if (body && body.length >= 100) {
        await saveFullText(item.id, body, 'ads_api');
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
  logger.info(`   Skipped (no bibcode or no body): ${skipped}`);
}

backfillResearchFullText().catch(console.error);
