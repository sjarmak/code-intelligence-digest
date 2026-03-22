/**
 * Score all cached items using GPT-4o
 * Stores results in item_scores table
 * Falls back to heuristics if OPENAI_API_KEY is not set
 */

import * as dotenv from 'dotenv';
import * as path from 'path';

// Load .env.local
dotenv.config({ path: path.resolve(process.cwd(), '.env.local') });

import { initializeDatabase } from '../src/lib/db/index.js';
import { getDbClient } from '../src/lib/db/driver.js';
import { loadItemsByCategory } from '../src/lib/db/items.js';
import { scoreWithLLM } from '../src/lib/pipeline/llmScore.js';
import { logger } from '../src/lib/logger.js';
import { Category } from '../src/lib/model.js';

const CATEGORIES: Category[] = [
  'newsletters',
  'tech_articles',
  'product_news',
  'community',
  'research',
  'ai_news',
  'podcasts',
];

const BATCH_SIZE = 3; // Items per API call (reduced to avoid token limit with large summaries)

async function main() {
  console.log('\n=== Scoring Items with GPT-4o ===\n');

  if (!process.env.OPENAI_API_KEY) {
    console.log('⚠️  OPENAI_API_KEY not set - using heuristic scoring fallback\n');
  }

  await initializeDatabase();
  const client = await getDbClient();

  let totalScored = 0;
  let totalBatches = 0;

  for (const category of CATEGORIES) {
    console.log(`\n📊 ${category.toUpperCase()}`);

    const items = await loadItemsByCategory(category, 30);

    if (items.length === 0) {
      console.log('  No items in this category');
      continue;
    }

    console.log(`  Scoring ${items.length} items in ${Math.ceil(items.length / BATCH_SIZE)} batches...`);

    const results = await scoreWithLLM(items, category, BATCH_SIZE);
    totalBatches += Math.ceil(items.length / BATCH_SIZE);

    for (const item of items) {
      const result = results[item.id];
      if (!result) continue;

      await client.run(
        `
        UPDATE item_scores
        SET llm_relevance = $1,
            llm_usefulness = $2,
            llm_tags = $3
        WHERE item_id = $4
          AND scored_at = (
            SELECT scored_at FROM item_scores
            WHERE item_id = $4
            ORDER BY scored_at DESC
            LIMIT 1
          )
      `,
        [result.relevance, result.usefulness, JSON.stringify(result.tags), item.id]
      );
    }

    totalScored += items.length;

    console.log(`  ✓ Stored ${items.length} LLM scores`);
  }

  console.log(`\n\n✅ Scored ${totalScored} items with GPT-4o in ${totalBatches} batches\n`);
}

main().catch((error) => {
  logger.error('Scoring failed', error);
  process.exit(1);
});
