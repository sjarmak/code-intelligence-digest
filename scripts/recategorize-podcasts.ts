#!/usr/bin/env npx tsx
/**
 * Recategorize existing items that should be podcasts
 * Detects podcast items based on title patterns and updates their category
 */

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { logger } from '../src/lib/logger';

/**
 * Detect if a title indicates a podcast
 */
function isPodcastTitle(title: string): boolean {
  const lower = title.toLowerCase();

  const podcastPatterns = [
    /^podcast:/i,
    /\bpodcast\b.*episode/i,
    /episode \d+/i,
    /^ep\.\s*\d+/i,
  ];

  for (const pattern of podcastPatterns) {
    if (pattern.test(title)) {
      return true;
    }
  }

  if (lower.startsWith('podcast:') || lower.includes('podcast:')) {
    return true;
  }

  return false;
}

async function main() {
  console.log('\n=== Recategorizing Podcast Items ===\n');

  await initializeDatabase();
  const db = await getDbClient();

  // Find items that look like podcasts but aren't categorized as podcasts
  const query = `
    SELECT id, title, category, source_title
    FROM items
    WHERE category != 'podcasts'
    AND (
      title ILIKE 'podcast:%'
      OR title ILIKE '%podcast%episode%'
      OR title ~* 'episode \\d+'
      OR title ~* '^ep\\.\\s*\\d+'
    )
    ORDER BY published_at DESC
  `;

  const result = await db.query(query);
  const candidates = result.rows as Array<{
    id: string;
    title: string;
    category: string;
    source_title: string;
  }>;

  console.log(`Found ${candidates.length} potential podcast items to recategorize\n`);

  if (candidates.length === 0) {
    console.log('✅ No items need recategorization');
    return;
  }

  // Show preview
  console.log('Preview (first 10):');
  for (const item of candidates.slice(0, 10)) {
    console.log(`  ${item.source_title}: "${item.title}"`);
    console.log(`    Current: ${item.category} → Will change to: podcasts\n`);
  }

  // Update categories
  console.log(`\nUpdating ${candidates.length} items...`);

  let updated = 0;
  for (const item of candidates) {
    if (isPodcastTitle(item.title)) {
      await db.query(
        'UPDATE items SET category = $1, updated_at = extract(epoch from now())::integer WHERE id = $2',
        ['podcasts', item.id]
      );
      updated++;
    }
  }

  console.log(`\n✅ Recategorized ${updated} items from various categories to podcasts\n`);

  // Show summary by source
  const summary = await db.query(`
    SELECT source_title, COUNT(*) as count
    FROM items
    WHERE category = 'podcasts'
    GROUP BY source_title
    ORDER BY count DESC
  `);

  console.log('Podcasts by source:');
  for (const row of summary.rows) {
    console.log(`  ${row.source_title}: ${row.count} podcasts`);
  }
}

main().catch((error) => {
  logger.error('Recategorization failed', error);
  console.error('Failed:', error);
  process.exit(1);
});
