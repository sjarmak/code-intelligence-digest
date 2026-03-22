/**
 * Score all cached items using BM25
 * Stores results in item_scores table
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index';
import { getDbClient } from '../src/lib/db/driver';
import { loadItemsByCategory } from '../src/lib/db/items';
import { BM25Index } from '../src/lib/pipeline/bm25';
import { getCategoryConfig } from '../src/config/categories';
import { logger } from '../src/lib/logger';
import { Category } from '../src/lib/model';

const CATEGORIES: Category[] = [
  'newsletters',
  'tech_articles',
  'product_news',
  'community',
  'research',
  'ai_news',
  'podcasts',
];

async function main() {
  console.log('\n=== Scoring Items with BM25 ===\n');

  await initializeDatabase();
  const client = await getDbClient();

  let totalScored = 0;

  for (const category of CATEGORIES) {
    console.log(`\n📊 ${category.toUpperCase()}`);

    const items = await loadItemsByCategory(category, 30);

    if (items.length === 0) {
      console.log('  No items in this category');
      continue;
    }

    console.log(`  Scoring ${items.length} items...`);

    const bm25 = new BM25Index();
    bm25.addDocuments(items);

    const config = getCategoryConfig(category);
    const queryTerms = config.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);

    const bm25Scores = bm25.score(queryTerms);
    const bm25Normalized = bm25.normalizeScores(bm25Scores);

    const now = Math.floor(Date.now() / 1000);

    for (const item of items) {
      const bm25Score = bm25Normalized.get(item.id) || 0;

      await client.run(
        `
        INSERT INTO item_scores (
          item_id, category, bm25_score, llm_relevance, llm_usefulness,
          llm_tags, recency_score, engagement_score, final_score, reasoning, scored_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      `,
        [
          item.id,
          category,
          bm25Score,
          5,
          5,
          '[]',
          0.5,
          null,
          bm25Score,
          null,
          now,
        ]
      );
    }

    totalScored += items.length;

    console.log(`  ✓ Stored ${items.length} scores`);
  }

  console.log(`\n\n✅ Scored ${totalScored} total items with BM25\n`);
}

main().catch((error) => {
  logger.error('Scoring failed', error);
  process.exit(1);
});
