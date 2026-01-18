#!/usr/bin/env npx tsx

/**
 * Test the fulltext endpoint logic directly
 */

import { loadItem } from '../src/lib/db/items';

async function test() {
  const testIds = [
    'ads:2025arXiv250924091G',
    'ads:2025arXiv251113998Q',
    'ads:2026arXiv260109393W',
  ];

  console.log('Testing fulltext endpoint logic:\n');

  for (const itemId of testIds) {
    console.log(`\n📄 Testing: ${itemId}`);

    const item = await loadItem(itemId);

    if (!item) {
      console.log('  ❌ Item not found');
      continue;
    }

    const hasFullText = !!item.fullText && (item.fullText.length >= 100);

    console.log(`  Title: ${item.title.substring(0, 60)}...`);
    console.log(`  fullText exists: ${!!item.fullText}`);
    console.log(`  fullText length: ${item.fullText?.length || 0}`);
    console.log(`  hasFullText (>=100): ${hasFullText}`);
    console.log(`  API would return: { hasFullText: ${hasFullText}, fullTextLength: ${item.fullText?.length || 0} }`);

    if (hasFullText) {
      console.log('  ✅ Should show indicator');
    } else {
      console.log('  ❌ Will NOT show indicator');
    }
  }
}

test().catch(console.error);
