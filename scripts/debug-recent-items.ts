#!/usr/bin/env tsx
/**
 * Debug script to check why recent items aren't showing up
 * Shows items from last 24 hours with their scores and filtering status
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { loadItemsByCategory } from '../src/lib/db/items';
import { rankCategory } from '../src/lib/pipeline/rank';
import { getCategoryConfig } from '../src/config/categories';
import { logger } from '../src/lib/logger';
import type { Category, RankedItem } from '../src/lib/model';

const CATEGORIES: Category[] = [
  'newsletters',
  'podcasts',
  'tech_articles',
  'ai_news',
  'product_news',
  'community',
  'research',
];

async function debugRecentItems() {
  try {
    await initializeDatabase();

    console.log('\n🔍 Debugging Recent Items (Last 24 Hours)\n');
    console.log('='.repeat(80));

    for (const category of CATEGORIES) {
      console.log(`\n📁 Category: ${category}`);
      console.log('-'.repeat(80));

      // Load items from last 24 hours
      const items = await loadItemsByCategory(category, 1);
      console.log(`  Loaded ${items.length} items from database (last 24h)`);

      if (items.length === 0) {
        console.log('  ⚠️  No items found in database for this category');
        continue;
      }

      // Rank items
      const rankedItems = await rankCategory(items, category, 1);
      console.log(`  Ranked to ${rankedItems.length} items (after filtering)`);

      const config = getCategoryConfig(category);
      const filteredOut = items.length - rankedItems.length;
      const targetItems = config.maxItems;

      if (rankedItems.length < targetItems && items.length >= targetItems) {
        console.log(`  ⚠️  Only ${rankedItems.length} items passed (target: ${targetItems})`);
        console.log(`  💡 Adaptive threshold should have lowered from ${config.minRelevance} to get more items`);
      } else if (filteredOut > 0) {
        console.log(`  ℹ️  ${filteredOut} items filtered out (target: ${targetItems}, got: ${rankedItems.length})`);
      }

      // Show top items with scores
      console.log(`\n  Top ${Math.min(5, rankedItems.length)} items:`);
      rankedItems.slice(0, 5).forEach((item, idx) => {
        console.log(`\n  ${idx + 1}. ${item.title.substring(0, 60)}...`);
        console.log(`     Relevance: ${item.llmScore.relevance}/10 (min: ${config.minRelevance})`);
        console.log(`     Usefulness: ${item.llmScore.usefulness}/10`);
        console.log(`     Final Score: ${item.finalScore.toFixed(3)}`);
        console.log(`     Tags: ${item.llmScore.tags.join(', ') || 'none'}`);
        console.log(`     Published: ${item.publishedAt.toISOString()}`);
      });

      // Show items that were filtered out (if we can identify them)
      if (filteredOut > 0 && items.length <= 20) {
        // For small sets, try to identify what was filtered
        console.log(`\n  Checking why items were filtered...`);
        // Note: We'd need to re-rank without filtering to see this, but that's expensive
        // Instead, just show the threshold
        console.log(`  Items need LLM relevance >= ${config.minRelevance} to pass`);
      }
    }

    console.log('\n' + '='.repeat(80));
    console.log('\n💡 Tips:');
    console.log('  - Items are filtered if LLM relevance < minRelevance (typically 5)');
    console.log('  - Items tagged "off-topic" are always filtered');
    console.log('  - Items without LLM scores need relevance >= 3 (BM25 fallback)');
    console.log('  - Check logs for "Filtering out low relevance item" messages\n');
  } catch (error) {
    logger.error('Failed to debug recent items', error);
    console.error('Error:', error);
    process.exit(1);
  }
}

debugRecentItems();

