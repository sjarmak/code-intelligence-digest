/**
 * Test the /api/items endpoint programmatically
 * Simulates what the API would return
 */

import { loadItemsByCategory } from "../src/lib/db/items";
import { rankCategory } from "../src/lib/pipeline/rank";
import { selectWithDiversity } from "../src/lib/pipeline/select";
import { Category } from "../src/lib/model";
import { logger } from "../src/lib/logger";

async function testAPIEndpoint() {
  logger.info("Testing /api/items endpoint...");

  const testCases = [
    { category: "tech_articles" as Category, period: "week", periodDays: 7 },
    { category: "newsletters" as Category, period: "week", periodDays: 7 },
    { category: "research" as Category, period: "month", periodDays: 30 },
  ];

  for (const testCase of testCases) {
    console.log(`\n📌 Testing: GET /api/items?category=${testCase.category}&period=${testCase.period}`);

    try {
      // Simulate API endpoint logic
      const items = await loadItemsByCategory(testCase.category, testCase.periodDays);
      const rankedItems = await rankCategory(items, testCase.category, testCase.periodDays);

      // Apply diversity selection
      const perSourceCaps = { week: 2, month: 3, all: 4 };
      const maxPerSource = perSourceCaps[testCase.period as keyof typeof perSourceCaps] ?? 2;
      const selectionResult = selectWithDiversity(rankedItems, testCase.category, maxPerSource);
      const selectedItems = selectionResult.items;

      // Format response like the API would
      const response = {
        category: testCase.category,
        period: testCase.period,
        periodDays: testCase.periodDays,
        totalItems: selectedItems.length,
        itemsRanked: rankedItems.length,
        itemsFiltered: rankedItems.length - selectedItems.length,
        items: selectedItems.slice(0, 3).map((item) => ({
          id: item.id,
          title: item.title,
          url: item.url,
          sourceTitle: item.sourceTitle,
          publishedAt: item.publishedAt.toISOString(),
          summary: item.summary?.substring(0, 100),
          bm25Score: Number(item.bm25Score.toFixed(3)),
          llmScore: {
            relevance: item.llmScore.relevance,
            usefulness: item.llmScore.usefulness,
            tags: item.llmScore.tags,
          },
          recencyScore: Number(item.recencyScore.toFixed(3)),
          finalScore: Number(item.finalScore.toFixed(3)),
        })),
      };

      console.log(
        `✅ Success: ${response.totalItems} items returned (showing first 3)`
      );
      console.log(JSON.stringify(response, null, 2));
    } catch (error) {
      console.log(`❌ Error:`, error instanceof Error ? error.message : error);
    }
  }

  console.log("\n✅ API endpoint tests completed");
}

testAPIEndpoint();
