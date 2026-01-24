#!/usr/bin/env npx tsx

/**
 * List all content sources from the feeds table in the database cache
 */

import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

async function listContentSources() {
  try {
    const client = await getDbClient();
    const driver = detectDriver();

    let query: string;
    if (driver === 'postgres') {
      query = `
        SELECT
          canonical_name,
          stream_id,
          default_category,
          vendor,
          source_relevance,
          updated_at
        FROM feeds
        ORDER BY canonical_name ASC
      `;
    } else {
      query = `
        SELECT
          canonical_name,
          stream_id,
          default_category,
          vendor,
          source_relevance,
          updated_at
        FROM feeds
        ORDER BY canonical_name ASC
      `;
    }

    const result = await client.query(query);
    const feeds = result.rows;

    if (feeds.length === 0) {
      console.log('No feeds found in database cache.');
      return;
    }

    // Group by category
    const byCategory: Record<string, typeof feeds> = {};
    for (const feed of feeds) {
      const category = (feed.default_category as string) || 'Unknown';
      if (!byCategory[category]) {
        byCategory[category] = [];
      }
      byCategory[category].push(feed);
    }

    console.log('\n📰 Full List of Content Sources in Database Cache\n');
    console.log('='.repeat(100));

    // Output by category
    for (const [category, categoryFeeds] of Object.entries(byCategory).sort()) {
      console.log(`\n## ${category.toUpperCase()} (${categoryFeeds.length} sources)\n`);

      for (const feed of categoryFeeds.sort((a, b) => {
        const nameA = (a.canonical_name as string) || '';
        const nameB = (b.canonical_name as string) || '';
        return nameA.localeCompare(nameB);
      })) {
        const name = (feed.canonical_name as string) || 'Unknown';
        const vendor = (feed.vendor as string) || 'N/A';
        const streamId = (feed.stream_id as string) || '';
        const relevance = feed.source_relevance !== null ? feed.source_relevance : 1;

        console.log(`  • ${name}`);
        console.log(`    Vendor: ${vendor}`);
        console.log(`    Stream ID: ${streamId}`);
        console.log(`    Relevance: ${relevance}`);
        console.log('');
      }
    }

    console.log('='.repeat(100));
    console.log(`\nTotal: ${feeds.length} content sources\n`);

    // Summary by category
    console.log('Summary by Category:');
    for (const [category, categoryFeeds] of Object.entries(byCategory).sort()) {
      console.log(`  ${category}: ${categoryFeeds.length}`);
    }

    await client.close();
  } catch (error) {
    logger.error('Failed to list content sources', error);
    console.error('Error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

listContentSources();
