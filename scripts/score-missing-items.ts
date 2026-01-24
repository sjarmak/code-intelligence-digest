#!/usr/bin/env tsx
/**
 * Score items that are missing scores
 * Run this after sync to ensure all items have scores
 *
 * Usage:
 *   npx tsx scripts/score-missing-items.ts [days]
 *
 * Default: scores items from last 7 days
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local for local development
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { computeAndSaveScoresForItems } from '../src/lib/pipeline/compute-scores';
import { logger } from '../src/lib/logger';
import { Category } from '../src/lib/model';

const DAYS_TO_CHECK = parseInt(process.argv[2] || '7', 10);

async function scoreMissingItems() {
  await initializeDatabase();
  const client = await getDbClient();

  const categories: Category[] = ['newsletters', 'podcasts', 'tech_articles', 'ai_news', 'product_news', 'community', 'research'];
  const cutoffTime = Math.floor((Date.now() - DAYS_TO_CHECK * 24 * 60 * 60 * 1000) / 1000);
  const dateColumn = 'created_at';

  let totalScored = 0;

  logger.info(`Scoring items missing scores from last ${DAYS_TO_CHECK} days...`);

  for (const category of categories) {
    const whereClause = category === 'newsletters'
      ? `i.category = ? AND i.id LIKE '%-article-%' AND i.${dateColumn} >= ?`
      : `i.category = ? AND i.${dateColumn} >= ?`;

    // Find items without scores
    const result = await client.query(
      `SELECT i.* FROM items i
       LEFT JOIN item_scores s ON i.id = s.item_id
       WHERE ${whereClause}
       AND s.item_id IS NULL
       ORDER BY i.${dateColumn} DESC`,
      [category, cutoffTime]
    );

    if (result.rows.length === 0) {
      logger.info(`${category}: All items have scores`);
      continue;
    }

    logger.info(`${category}: Found ${result.rows.length} items without scores`);

    // Map to FeedItem format
    const items = result.rows.map((row: any) => {
      let finalUrl = row.url;
      if (row.url && (row.url.includes('inoreader.com') || row.url.includes('google.com/reader') || row.url.includes('awstrack.me'))) {
        if (row.extracted_url && !row.extracted_url.includes('inoreader.com')) {
          finalUrl = row.extracted_url;
        } else {
          return null;
        }
      }

      return {
        id: row.id,
        streamId: row.stream_id,
        sourceTitle: row.source_title,
        title: row.title,
        url: finalUrl,
        author: row.author || undefined,
        publishedAt: new Date(row.published_at * 1000),
        createdAt: row.created_at ? new Date(row.created_at * 1000) : undefined,
        summary: row.summary || undefined,
        contentSnippet: row.content_snippet || undefined,
        categories: JSON.parse(row.categories),
        category: row.category,
        raw: {},
        fullText: row.full_text || undefined,
      };
    }).filter(item => item !== null);

    if (items.length === 0) {
      logger.warn(`  Skipping (all items have invalid URLs)`);
      continue;
    }

    try {
      const scoreResult = await computeAndSaveScoresForItems(items);
      totalScored += scoreResult.totalScored;
      logger.info(`  ✅ Scored ${scoreResult.totalScored} items`);
    } catch (error) {
      logger.error(`  ❌ Failed to score: ${error}`);
    }
  }

  logger.info(`\n✅ Complete: Scored ${totalScored} items`);
}

if (require.main === module) {
  scoreMissingItems().catch((error) => {
    logger.error('Failed to score missing items', error);
    process.exit(1);
  });
}

