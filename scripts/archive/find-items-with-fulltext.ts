#!/usr/bin/env npx tsx

/**
 * Find items with full text in the weekly range
 */

import { getDbClient, detectDriver } from '../src/lib/db/driver';
import { getSqlite } from '../src/lib/db/index';

async function findItemsWithFullText() {
  const driver = detectDriver();
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 604800; // 7 days in seconds
  const monthAgo = now - 2592000; // 30 days in seconds

  // First check weekly
  console.log('Checking weekly range (last 7 days)...\n');

  if (driver === 'postgres') {
    const client = await getDbClient();
    let result = await client.query(
      `SELECT id, title, url, source_title, category, published_at,
              LENGTH(full_text) as fulltext_length, full_text_source
       FROM items
       WHERE full_text IS NOT NULL
         AND LENGTH(full_text) > 100
         AND published_at >= $1
         AND category IN ('research', 'tech_articles', 'newsletters')
       ORDER BY published_at DESC
       LIMIT 10`,
      [weekAgo]
    );

    if (result.rows.length === 0) {
      console.log('No items found in weekly range. Checking monthly range...\n');
      result = await client.query(
        `SELECT id, title, url, source_title, category, published_at,
                LENGTH(full_text) as fulltext_length, full_text_source
         FROM items
         WHERE full_text IS NOT NULL
           AND LENGTH(full_text) > 100
           AND published_at >= $1
           AND category IN ('research', 'tech_articles', 'newsletters')
         ORDER BY published_at DESC
         LIMIT 10`,
        [monthAgo]
      );
    }

    console.log('\n📄 Items with full text:\n');
    for (const row of result.rows) {
      const rowTyped = row as { published_at: number; title: string; source_title: string; category: string; fulltext_length: number; full_text_source: string | null; url: string; id: string };
      const daysAgo = Math.floor((now - rowTyped.published_at) / 86400);
      console.log(`Title: ${rowTyped.title}`);
      console.log(`Source: ${rowTyped.source_title}`);
      console.log(`Category: ${rowTyped.category}`);
      console.log(`Full text length: ${rowTyped.fulltext_length} chars`);
      console.log(`Source: ${rowTyped.full_text_source || 'unknown'}`);
      console.log(`Published: ${new Date(rowTyped.published_at * 1000).toLocaleString()} (${daysAgo} days ago)`);
      console.log(`URL: ${rowTyped.url}`);
      console.log(`ID: ${rowTyped.id}`);
      console.log('---\n');
    }
  } else {
    const sqlite = getSqlite();
    let rows = sqlite
      .prepare(
        `SELECT id, title, url, source_title, category, published_at,
               LENGTH(full_text) as fulltext_length, full_text_source
        FROM items
        WHERE full_text IS NOT NULL
          AND LENGTH(full_text) > 100
          AND published_at >= ?
          AND category IN ('research', 'tech_articles', 'newsletters')
        ORDER BY published_at DESC
        LIMIT 10`
      )
      .all(weekAgo) as Array<{
        id: string;
        title: string;
        url: string;
        source_title: string;
        category: string;
        published_at: number;
        fulltext_length: number;
        full_text_source: string | null;
      }>;

    if (rows.length === 0) {
      console.log('No items found in weekly range. Checking monthly range...\n');
      rows = sqlite
        .prepare(
          `SELECT id, title, url, source_title, category, published_at,
                 LENGTH(full_text) as fulltext_length, full_text_source
          FROM items
          WHERE full_text IS NOT NULL
            AND LENGTH(full_text) > 100
            AND published_at >= ?
            AND category IN ('research', 'tech_articles', 'newsletters')
          ORDER BY published_at DESC
          LIMIT 10`
        )
        .all(monthAgo) as Array<{
          id: string;
          title: string;
          url: string;
          source_title: string;
          category: string;
          published_at: number;
          fulltext_length: number;
          full_text_source: string | null;
        }>;
    }

    console.log('\n📄 Items with full text:\n');
    for (const row of rows) {
      const daysAgo = Math.floor((now - row.published_at) / 86400);
      console.log(`Title: ${row.title}`);
      console.log(`Source: ${row.source_title}`);
      console.log(`Category: ${row.category}`);
      console.log(`Full text length: ${row.fulltext_length} chars`);
      console.log(`Source: ${row.full_text_source || 'unknown'}`);
      console.log(`Published: ${new Date(row.published_at * 1000).toLocaleString()} (${daysAgo} days ago)`);
      console.log(`URL: ${row.url}`);
      console.log(`ID: ${row.id}`);
      console.log('---\n');
    }
  }
}

findItemsWithFullText().catch(console.error);
