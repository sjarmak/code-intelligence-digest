#!/usr/bin/env tsx
/**
 * Delete subscription/promotional items from database
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

async function main() {
  await initializeDatabase();
  const driver = detectDriver();

  // Patterns for subscription/promotional titles
  const subscriptionTitlePatterns = [
    '%Pragmatic Engineer in 2025%',
    '%subscribe to%',
    '%sign up%',
    '%Welcome to%',
    '%Thanks for subscribing%',
    '%You\'re on the list%',
  ];

  if (driver === 'postgres') {
    const client = await getDbClient();

    for (const pattern of subscriptionTitlePatterns) {
      const result = await client.query(
        `SELECT id, title, url FROM items WHERE title ILIKE $1`,
        [pattern]
      );

      if (result.rows.length > 0) {
        console.log(`\nFound ${result.rows.length} items matching "${pattern}":`);
        result.rows.forEach((row: any) => {
          console.log(`  - ${row.title}`);
          console.log(`    URL: ${row.url}`);
        });

        // Delete these items
        await client.run(
          `DELETE FROM items WHERE title ILIKE $1`,
          [pattern]
        );
        console.log(`  Deleted ${result.rows.length} items`);
      }
    }
  } else {
    const sqlite = require('better-sqlite3')('.data/digest.db');
    for (const pattern of subscriptionTitlePatterns) {
      const items = sqlite.prepare(`SELECT id, title, url FROM items WHERE title LIKE ?`).all(pattern);

      if (items.length > 0) {
        console.log(`\nFound ${items.length} items matching "${pattern}":`);
        items.forEach((row: any) => {
          console.log(`  - ${row.title}`);
          console.log(`    URL: ${row.url}`);
        });

        sqlite.prepare(`DELETE FROM items WHERE title LIKE ?`).run(pattern);
        console.log(`  Deleted ${items.length} items`);
      }
    }
  }

  console.log('\n✅ Done!');
}

main().catch(console.error);




