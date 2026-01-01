#!/usr/bin/env tsx
/**
 * Find items in database with localhost URLs
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

async function findLocalhostUrls() {
  try {
    await initializeDatabase();
    const client = await getDbClient();

    console.log('\n🔍 Finding items with localhost URLs\n');
    console.log('='.repeat(80));

    // Find items with localhost URLs
    const result = await client.query(
      `SELECT id, title, url, category, source_title, published_at
       FROM items
       WHERE url LIKE '%localhost%' OR url LIKE '%127.0.0.1%'
       ORDER BY published_at DESC
       LIMIT 50`
    );

    if (result.rows.length === 0) {
      console.log('✅ No items found with localhost URLs');
    } else {
      console.log(`⚠️  Found ${result.rows.length} items with localhost URLs:\n`);

      for (const row of result.rows) {
        const item = row as Record<string, unknown>;
        const publishedAt = new Date(Number(item.published_at) * 1000);
        console.log(`Title: ${String(item.title).substring(0, 60)}...`);
        console.log(`  URL: ${item.url}`);
        console.log(`  Category: ${item.category}`);
        console.log(`  Source: ${item.source_title}`);
        console.log(`  Published: ${publishedAt.toISOString()}`);
        console.log(`  ID: ${item.id}`);
        console.log('');
      }
    }

    console.log('='.repeat(80) + '\n');
  } catch (error) {
    logger.error('Failed to find localhost URLs', error);
    console.error('Error:', error);
    process.exit(1);
  }
}

findLocalhostUrls();



