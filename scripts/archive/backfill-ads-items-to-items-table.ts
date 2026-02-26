#!/usr/bin/env npx tsx

/**
 * Backfill research items from ads_papers table to items table
 *
 * This ensures all research papers in ads_papers are also in items table
 * with their full_text properly stored.
 *
 * Run with: npx tsx scripts/backfill-ads-items-to-items-table.ts
 */

import { detectDriver, getDbClient } from '../src/lib/db/driver';
import { getSqlite } from '../src/lib/db/index';
import { saveItems } from '../src/lib/db/items';
import { FeedItem } from '../src/lib/model';
import { logger } from '../src/lib/logger';
import { getArxivUrl, getADSUrl } from '../src/lib/ads/client';

interface ADSPaperRow {
  bibcode: string;
  title: string;
  authors: string | null;
  pubdate: string | null;
  abstract: string | null;
  body: string | null;
  arxiv_url: string | null;
  ads_url: string | null;
  year: number | null;
}

async function backfillAdsItemsToItemsTable() {
  try {
    logger.info('🚀 Starting backfill of ads_papers to items table...\n');

    const driver = detectDriver();
    let papers: ADSPaperRow[] = [];

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT bibcode, title, authors, pubdate, abstract, body, arxiv_url, ads_url, year
         FROM ads_papers
         WHERE body IS NOT NULL AND LENGTH(body) >= 100
         ORDER BY year DESC, bibcode`
      );
      papers = result.rows as unknown as ADSPaperRow[];
    } else {
      const sqlite = getSqlite();
      papers = sqlite.prepare(
        `SELECT bibcode, title, authors, pubdate, abstract, body, arxiv_url, ads_url, year
         FROM ads_papers
         WHERE body IS NOT NULL AND LENGTH(body) >= 100
         ORDER BY year DESC, bibcode`
      ).all() as ADSPaperRow[];
    }

    logger.info(`Found ${papers.length} papers in ads_papers with full text\n`);

    if (papers.length === 0) {
      logger.warn('No papers found in ads_papers table');
      return;
    }

    // Check which ones already exist in items table
    const existingIds = new Set<string>();
    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT id FROM items WHERE id LIKE 'ads:%'`
      );
      (result.rows as { id: string }[]).forEach((row) => existingIds.add(row.id));
    } else {
      const sqlite = getSqlite();
      const rows = sqlite.prepare(`SELECT id FROM items WHERE id LIKE 'ads:%'`).all() as { id: string }[];
      rows.forEach(row => existingIds.add(row.id));
    }

    logger.info(`Found ${existingIds.size} existing items with ads: prefix\n`);

    // Convert papers to FeedItems
    const itemsToSave: FeedItem[] = [];
    let skipped = 0;

    for (const paper of papers) {
      const itemId = `ads:${paper.bibcode}`;

      // Skip if already exists
      if (existingIds.has(itemId)) {
        skipped++;
        continue;
      }

      // Parse authors
      let author: string | undefined;
      if (paper.authors) {
        try {
          const authorsArray = JSON.parse(paper.authors);
          author = Array.isArray(authorsArray) ? authorsArray.join(', ') : authorsArray;
        } catch {
          author = paper.authors;
        }
      }

      // Parse pubdate
      let publishedAt: Date;
      if (paper.pubdate) {
        publishedAt = new Date(paper.pubdate);
        if (isNaN(publishedAt.getTime())) {
          publishedAt = new Date();
        }
      } else {
        publishedAt = new Date();
      }

      // Get URL
      const url = paper.arxiv_url || paper.ads_url || getADSUrl(paper.bibcode);

      const feedItem: FeedItem = {
        id: itemId,
        streamId: `ads:research:${paper.bibcode}`,
        sourceTitle: 'ADS Research',
        title: paper.title || 'Untitled',
        url,
        author,
        publishedAt,
        createdAt: publishedAt,
        summary: paper.abstract || undefined,
        contentSnippet: paper.abstract || undefined,
        fullText: paper.body || undefined,
        categories: ['research'],
        category: 'research',
        raw: {
          bibcode: paper.bibcode,
          adsUrl: paper.ads_url || getADSUrl(paper.bibcode),
          arxivUrl: paper.arxiv_url || getArxivUrl(paper.bibcode),
        },
      };

      itemsToSave.push(feedItem);
    }

    logger.info(`\n📊 Summary:`);
    logger.info(`  Total papers in ads_papers: ${papers.length}`);
    logger.info(`  Already in items table: ${skipped}`);
    logger.info(`  To be saved: ${itemsToSave.length}\n`);

    if (itemsToSave.length === 0) {
      logger.info('✅ All papers already in items table');
      return;
    }

    // Save in batches
    const batchSize = 100;
    let saved = 0;

    for (let i = 0; i < itemsToSave.length; i += batchSize) {
      const batch = itemsToSave.slice(i, i + batchSize);
      await saveItems(batch);
      saved += batch.length;
      logger.info(`Saved batch ${Math.floor(i / batchSize) + 1}: ${saved}/${itemsToSave.length} items`);
    }

    logger.info(`\n✅ Backfill complete! Saved ${saved} items to items table`);
  } catch (error) {
    logger.error('Backfill failed:', error);
    throw error;
  }
}

backfillAdsItemsToItemsTable().catch(console.error);
