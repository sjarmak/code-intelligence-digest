#!/usr/bin/env npx tsx

/**
 * Test the fulltext API endpoint directly with specific item IDs
 */

import { loadItem } from '../src/lib/db/items';

async function test() {
  const testItemIds = [
    'ads:2025arXiv250924091G',
    'ads:2025arXiv251113998Q',
    'ads:2026arXiv260109393W',
    'tag:google.com,2005:reader/item/0000000b26006610',
  ];

  for (const itemId of testItemIds) {
    console.log(`\nTesting: ${itemId}`);
    const item = await loadItem(itemId);

    if (!item) {
      console.log('  ❌ Item not found');
      continue;
    }

    const hasFullText = !!item.fullText;
    const fullTextLength = item.fullText?.length || 0;

    console.log(`  Title: ${item.title.substring(0, 60)}...`);
    console.log(`  Has fullText: ${hasFullText}`);
    console.log(`  fullText length: ${fullTextLength}`);
    console.log(`  API would return hasFullText: ${hasFullText}`);

    if (hasFullText) {
      console.log(`  ✅ Should show indicator`);
    } else {
      console.log(`  ❌ Will NOT show indicator (no full_text in database)`);
    }
  }
}

test().catch(console.error);
