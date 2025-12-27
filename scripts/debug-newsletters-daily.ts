/**
 * Debug script to check why only one newsletter article shows in daily view
 */

import { initializeDatabase } from "../src/lib/db/index";
import { loadItemsByCategory } from "../src/lib/db/items";
import { rankCategory } from "../src/lib/pipeline/rank";
import { selectWithDiversity } from "../src/lib/pipeline/select";

async function main() {
  await initializeDatabase();

  console.log('=== DEBUGGING DAILY NEWSLETTERS VIEW ===');
  console.log('');

  // Load items for last 2 days (daily view)
  const items = await loadItemsByCategory('newsletters', 2);
  console.log(`Items in database (last 2 days): ${items.length}`);

  if (items.length === 0) {
    console.log('❌ No items found in database for last 2 days');
    return;
  }

  // Check which items have scores
  const { getSqlite } = await import('../src/lib/db/index');
  const sqlite = getSqlite();
  const itemIds = items.map(i => i.id);
  const placeholders = itemIds.map(() => '?').join(',');
  const scores = sqlite.prepare(`
    SELECT item_id, llm_relevance, llm_usefulness, final_score, scored_at
    FROM item_scores
    WHERE item_id IN (${placeholders})
    ORDER BY scored_at DESC
  `).all(...itemIds) as Array<{
    item_id: string;
    llm_relevance: number;
    llm_usefulness: number;
    final_score: number;
    scored_at: number;
  }>;

  console.log(`Items with scores: ${scores.length}`);
  console.log('');

  // Show sample items
  console.log('Sample items:');
  items.slice(0, 5).forEach((item, i) => {
    const score = scores.find(s => s.item_id === item.id);
    console.log(`  ${i + 1}. ${item.title.substring(0, 60)}...`);
    console.log(`     Source: ${item.sourceTitle}, Score: ${score ? score.final_score.toFixed(3) : 'N/A'}`);
  });
  console.log('');

  // Rank items
  console.log('Ranking items...');
  const ranked = await rankCategory(items, 'newsletters', 2);
  console.log(`Ranked items: ${ranked.length}`);

  if (ranked.length > 0) {
    console.log('');
    console.log('Top 10 ranked items:');
    ranked.slice(0, 10).forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.title.substring(0, 60)}...`);
      console.log(`     Score: ${item.finalScore.toFixed(3)}, LLM: ${item.llmScore.relevance}/${item.llmScore.usefulness}, BM25: ${item.bm25Score.toFixed(3)}`);
      console.log(`     Source: ${item.sourceTitle}`);
    });
  }

  // Apply selection
  console.log('');
  console.log('Applying diversity selection (maxPerSource=5 for daily view)...');
  const selected = selectWithDiversity(ranked, 'newsletters', 5, undefined);
  console.log(`Selected items: ${selected.items.length}`);

  if (selected.items.length > 0) {
    console.log('');
    console.log('Selected items:');
    selected.items.forEach((item, i) => {
      console.log(`  ${i + 1}. ${item.title.substring(0, 60)}...`);
      console.log(`     Score: ${item.finalScore.toFixed(3)}, Source: ${item.sourceTitle}`);
      const reason = selected.reasons.get(item.id);
      if (reason) {
        console.log(`     Reason: ${reason}`);
      }
    });
  } else {
    console.log('');
    console.log('❌ NO ITEMS SELECTED!');
    console.log('This is the problem - selection is filtering out all items.');
  }
}

main().catch(console.error);

