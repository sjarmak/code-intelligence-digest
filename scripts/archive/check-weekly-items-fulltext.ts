#!/usr/bin/env npx tsx

/**
 * Check which items are in weekly view and if they have full_text
 */

import { loadItemsByCategory } from '../src/lib/db/items';
import { detectDriver, getDbClient } from '../src/lib/db/driver';
import { getSqlite } from '../src/lib/db/index';

async function checkWeeklyItems() {
  const driver = detectDriver();
  const now = Math.floor(Date.now() / 1000);
  const weekAgo = now - 604800; // 7 days

  console.log('Checking items in weekly range (last 7 days)...\n');

  const categories = ['research', 'tech_articles', 'ai_news', 'newsletters', 'product_news'];

  for (const category of categories) {
    console.log(`\n📂 ${category.toUpperCase()}:`);

    let items: Array<{ id: string; title: string; url: string; full_text: string | null; full_text_length: number }> = [];

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT id, title, url, full_text, LENGTH(full_text) as full_text_length
         FROM items
         WHERE category = $1
           AND published_at >= $2
         ORDER BY published_at DESC
         LIMIT 10`,
        [category, weekAgo]
      );
      items = result.rows as typeof items;
    } else {
      const sqlite = getSqlite();
      items = sqlite
        .prepare(
          `SELECT id, title, url, full_text, LENGTH(full_text) as full_text_length
           FROM items
           WHERE category = ?
             AND published_at >= ?
           ORDER BY published_at DESC
           LIMIT 10`
        )
        .all(category, weekAgo) as typeof items;
    }

    if (items.length === 0) {
      console.log('   No items in weekly range');
      continue;
    }

    const withFullText = items.filter(item => item.full_text && item.full_text_length >= 100);

    console.log(`   Total items: ${items.length}`);
    console.log(`   With full_text: ${withFullText.length} (${Math.round((withFullText.length / items.length) * 100)}%)`);

    if (withFullText.length > 0) {
      console.log(`\n   ✅ Items WITH full_text:`);
      withFullText.slice(0, 3).forEach(item => {
        console.log(`      - ${item.title.substring(0, 60)}...`);
        console.log(`        ID: ${item.id}`);
        console.log(`        Length: ${item.full_text_length} chars`);
      });
    }

    const withoutFullText = items.filter(item => !item.full_text || item.full_text_length < 100);
    if (withoutFullText.length > 0 && withoutFullText.length <= 3) {
      console.log(`\n   ❌ Items WITHOUT full_text:`);
      withoutFullText.forEach(item => {
        console.log(`      - ${item.title.substring(0, 60)}...`);
        console.log(`        ID: ${item.id}`);
      });
    }
  }
}

checkWeeklyItems().catch(console.error);
