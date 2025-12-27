#!/usr/bin/env tsx
/**
 * Quick script to find and fix "The Pragmatic Engineer in 2025" subscription page
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { loadAllItems, saveItems } from '../src/lib/db/items';
import { decomposeNewsletterItems } from '../src/lib/pipeline/decompose';
import { isNewsletterSource } from '../src/lib/pipeline/decompose';
import { logger } from '../src/lib/logger';
import type { FeedItem, RankedItem } from '../src/lib/model';

function feedItemToRankedItem(item: FeedItem): RankedItem {
  return {
    ...item,
    bm25Score: 0.5,
    llmScore: {
      relevance: 5,
      usefulness: 5,
      tags: [],
    },
    recencyScore: 0.5,
    finalScore: 0.5,
    reasoning: "Reprocessed newsletter item",
  };
}

async function main() {
  await initializeDatabase();

  // Find items with "Pragmatic Engineer in 2025" title
  const allItems = await loadAllItems();
  const problematicItems = allItems.filter(item =>
    item.title.toLowerCase().includes('pragmatic engineer') &&
    item.title.toLowerCase().includes('2025')
  );

  console.log(`Found ${problematicItems.length} items matching "Pragmatic Engineer in 2025"`);

  for (const item of problematicItems) {
    console.log(`\nItem ID: ${item.id}`);
    console.log(`Title: ${item.title}`);
    console.log(`URL: ${item.url}`);
    console.log(`Source: ${item.sourceTitle}`);

    // Find the original newsletter item if this is a decomposed article
    let originalItem: FeedItem | undefined;
    if (item.id.includes('-article-')) {
      const originalId = item.id.split('-article-')[0];
      originalItem = allItems.find(i => i.id === originalId);
    } else {
      originalItem = item;
    }

    if (originalItem && isNewsletterSource(originalItem.sourceTitle)) {
      console.log(`\nRe-decomposing original newsletter: ${originalItem.title}`);
      const ranked = feedItemToRankedItem(originalItem);
      const decomposed = decomposeNewsletterItems([ranked]);

      console.log(`Decomposed into ${decomposed.length} articles:`);
      decomposed.forEach((d, idx) => {
        console.log(`  ${idx + 1}. "${d.title}"`);
        console.log(`     URL: ${d.url}`);
      });

      // Filter out the problematic one
      const valid = decomposed.filter(d =>
        !d.title.toLowerCase().includes('pragmatic engineer') ||
        !d.title.toLowerCase().includes('2025')
      );

      if (valid.length < decomposed.length) {
        console.log(`\nFiltered out ${decomposed.length - valid.length} subscription items`);

        // Save only valid items
        const feedItems = valid.map(item => ({
          id: item.id,
          streamId: item.streamId,
          sourceTitle: item.sourceTitle,
          title: item.title,
          url: item.url,
          author: item.author,
          publishedAt: item.publishedAt,
          summary: item.summary,
          contentSnippet: item.contentSnippet,
          categories: item.categories,
          category: item.category,
          raw: item.raw,
          fullText: item.fullText,
        }));

        await saveItems(feedItems);
        console.log(`Saved ${feedItems.length} valid items`);
      }
    }
  }
}

main().catch(console.error);



