#!/usr/bin/env npx tsx

/**
 * Test the fulltext API endpoint directly
 */

import { loadItem } from '../src/lib/db/items';

async function test() {
  // Test with an item we know has full_text
  const testItemId = 'tag:google.com,2005:reader/item/0000000b1a9b4159';

  console.log(`Testing loadItem for: ${testItemId}\n`);

  const item = await loadItem(testItemId);

  if (!item) {
    console.log('❌ Item not found');
    return;
  }

  console.log(`✅ Item loaded:`);
  console.log(`   Title: ${item.title}`);
  console.log(`   URL: ${item.url}`);
  console.log(`   Has fullText: ${!!item.fullText}`);
  console.log(`   fullText length: ${item.fullText?.length || 0}`);
  console.log(`   fullText preview: ${item.fullText?.substring(0, 100) || 'N/A'}...`);

  // Test what the API would return
  const hasFullText = !!item.fullText;
  console.log(`\n📡 API would return:`);
  console.log(`   hasFullText: ${hasFullText}`);
  console.log(`   fullText: ${item.fullText ? `${item.fullText.length} chars` : 'null'}`);
}

test().catch(console.error);
