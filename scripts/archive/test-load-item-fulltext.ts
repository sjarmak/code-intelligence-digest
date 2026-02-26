#!/usr/bin/env npx tsx

import { loadItem } from '../src/lib/db/items';

async function test() {
  const itemId = 'ads:2025arXiv250924091G';
  console.log(`Testing loadItem for: ${itemId}\n`);

  const item = await loadItem(itemId);

  if (!item) {
    console.log('❌ Item not found');
    return;
  }

  console.log('✅ Item loaded:');
  console.log(`   ID: ${item.id}`);
  console.log(`   Title: ${item.title}`);
  console.log(`   Has fullText: ${!!item.fullText}`);
  console.log(`   fullText length: ${item.fullText?.length || 0}`);
  console.log(`   fullText preview: ${item.fullText?.substring(0, 100) || 'N/A'}...`);

  // Test what API would return
  const hasFullText = !!item.fullText;
  console.log(`\n📡 API would return:`);
  console.log(`   hasFullText: ${hasFullText}`);
  console.log(`   fullText: ${item.fullText ? `${item.fullText.length} chars` : 'null'}`);
}

test().catch(console.error);
