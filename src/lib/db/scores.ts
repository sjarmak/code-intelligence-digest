/**
 * Item scores database operations
 * Stores all ranking scores for analytics and A/B testing
 */

import { getSqlite } from "./index";
import { RankedItem, Category } from "../model";
import { logger } from "../logger";

/**
 * Save ranked items' scores to database for history/analytics
 */
export async function saveItemScores(items: RankedItem[], category: Category): Promise<void> {
  try {
    const sqlite = getSqlite();

    const stmt = sqlite.prepare(`
      INSERT INTO item_scores 
      (item_id, category, bm25_score, llm_relevance, llm_usefulness, llm_tags, recency_score, engagement_score, final_score, reasoning)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    const insertMany = sqlite.transaction((items: RankedItem[]) => {
      for (const item of items) {
        stmt.run(
          item.id,
          category,
          item.bm25Score,
          item.llmScore.relevance,
          item.llmScore.usefulness,
          JSON.stringify(item.llmScore.tags),
          item.recencyScore,
          item.engagementScore || null,
          item.finalScore,
          item.reasoning
        );
      }
    });

    insertMany(items);
    logger.info(`Saved ${items.length} item scores to database for category ${category}`);
  } catch (error) {
    logger.error(`Failed to save item scores for category ${category}`, error);
    throw error;
  }
}

/**
 * Get latest scores for an item
 */
export async function getItemLatestScores(
  itemId: string
): Promise<{
  bm25Score: number;
  llmRelevance: number;
  llmUsefulness: number;
  llmTags: string[];
  recencyScore: number;
  finalScore: number;
  reasoning: string;
  scoredAt: number;
} | null> {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`
      SELECT * FROM item_scores 
      WHERE item_id = ? 
      ORDER BY scored_at DESC 
      LIMIT 1
    `)
      .get(itemId) as {
      bm25_score: number;
      llm_relevance: number;
      llm_usefulness: number;
      llm_tags: string;
      recency_score: number;
      final_score: number;
      reasoning: string;
      scored_at: number;
    } | undefined;

    if (!row) {
      return null;
    }

    return {
      bm25Score: row.bm25_score,
      llmRelevance: row.llm_relevance,
      llmUsefulness: row.llm_usefulness,
      llmTags: JSON.parse(row.llm_tags || "[]") as string[],
      recencyScore: row.recency_score,
      finalScore: row.final_score,
      reasoning: row.reasoning,
      scoredAt: row.scored_at,
    };
  } catch (error) {
    logger.error(`Failed to get latest scores for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Get score history for an item (all scores over time)
 */
export async function getItemScoreHistory(
  itemId: string
): Promise<
  Array<{
    bm25Score: number;
    finalScore: number;
    llmRelevance: number;
    scoredAt: number;
  }>
> {
  try {
    const sqlite = getSqlite();

    const rows = sqlite
      .prepare(`
      SELECT bm25_score, final_score, llm_relevance, scored_at FROM item_scores 
      WHERE item_id = ? 
      ORDER BY scored_at ASC
    `)
      .all(itemId) as Array<{
      bm25_score: number;
      final_score: number;
      llm_relevance: number;
      scored_at: number;
    }>;

    return rows.map((row) => ({
      bm25Score: row.bm25_score,
      finalScore: row.final_score,
      llmRelevance: row.llm_relevance,
      scoredAt: row.scored_at,
    }));
  } catch (error) {
    logger.error(`Failed to get score history for item ${itemId}`, error);
    return [];
  }
}

/**
 * Get average scores by category (useful for understanding what works)
 */
export async function getAverageScoresByCategory(category: Category): Promise<{
  avgBm25: number;
  avgLlmRelevance: number;
  avgRecency: number;
  avgFinal: number;
  count: number;
}> {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`
      SELECT 
        AVG(bm25_score) as avg_bm25,
        AVG(llm_relevance) as avg_llm_relevance,
        AVG(recency_score) as avg_recency,
        AVG(final_score) as avg_final,
        COUNT(*) as count
      FROM item_scores 
      WHERE category = ?
    `)
      .get(category) as {
      avg_bm25: number | null;
      avg_llm_relevance: number | null;
      avg_recency: number | null;
      avg_final: number | null;
      count: number;
    } | undefined;

    return {
      avgBm25: row?.avg_bm25 || 0,
      avgLlmRelevance: row?.avg_llm_relevance || 0,
      avgRecency: row?.avg_recency || 0,
      avgFinal: row?.avg_final || 0,
      count: row?.count ?? 0,
    };
  } catch (error) {
    logger.error(`Failed to get average scores for category ${category}`, error);
    return { avgBm25: 0, avgLlmRelevance: 0, avgRecency: 0, avgFinal: 0, count: 0 };
  }
}
