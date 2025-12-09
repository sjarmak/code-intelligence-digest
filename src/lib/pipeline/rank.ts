/**
 * Ranking pipeline
 * Combines BM25, LLM, recency, and diversity to produce final ranked items
 */

import { FeedItem, RankedItem, Category } from "../model";
import { getCategoryConfig } from "../../config/categories";
import { BM25Index } from "./bm25";
import { loadScoresForItems } from "../db/items";
import { logger } from "../logger";

/**
 * Compute recency score with exponential decay
 * Score decays from 1.0 to 0.2 over the half-life period
 */
function computeRecencyScore(
  publishedAt: Date,
  halfLifeDays: number
): number {
  const ageMs = Date.now() - publishedAt.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay: score = 2^(-ageDays / halfLifeDays)
  // At halfLife, score = 0.5
  const decayedScore = Math.pow(2, -ageDays / halfLifeDays);

  // Clamp to [0.2, 1.0]
  return Math.max(0.2, Math.min(1.0, decayedScore));
}

/**
 * Rank items for a given category
 */
export async function rankCategory(
  items: FeedItem[],
  category: Category,
  periodDays: number
): Promise<RankedItem[]> {
  if (items.length === 0) {
    return [];
  }

  logger.info(`Ranking ${items.length} items for category: ${category}`);

  const config = getCategoryConfig(category);

  // Filter to items within time window
  const now = Date.now();
  const windowMs = periodDays * 24 * 60 * 60 * 1000;
  const recentItems = items.filter((item) => {
    const ageMs = now - item.publishedAt.getTime();
    return ageMs <= windowMs;
  });

  logger.info(`${recentItems.length} items within ${periodDays} day window`);

  if (recentItems.length === 0) {
    return [];
  }

  // Build BM25 index
  const bm25 = new BM25Index();
  bm25.addDocuments(recentItems);
  // Parse query string into terms
  const queryTerms = config.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const bm25Scores = bm25.score(queryTerms);
  const bm25Normalized = bm25.normalizeScores(bm25Scores);

  // Load pre-computed LLM scores from database (only during daily sync should new scores be calculated)
  const itemIds = recentItems.map((item) => item.id);
  const preComputedScores = await loadScoresForItems(itemIds);
  
  // Convert to LLMScoreResult format expected by the ranking logic
  const llmScores: Record<string, { relevance: number; usefulness: number; tags: string[] }> = {};
  for (const itemId of itemIds) {
    const score = preComputedScores[itemId];
    if (score) {
      llmScores[itemId] = {
        relevance: score.llm_relevance,
        usefulness: score.llm_usefulness,
        tags: score.llm_tags,
      };
    }
  }

  // Compute all scores and combine
  const rankedItems: RankedItem[] = recentItems.map((item) => {
    const bm25Score = bm25Normalized.get(item.id) ?? 0;
    const llmResult = llmScores[item.id];
    // Compute LLM score from pre-computed relevance and usefulness (0.7 * relevance + 0.3 * usefulness)
    const llmScore = llmResult
      ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10 // Normalize to [0, 1]
      : 0.5;
    const recencyScore = computeRecencyScore(item.publishedAt, config.halfLifeDays);

    // Compute final score
    const finalScore =
      config.weights.llm * llmScore +
      config.weights.bm25 * bm25Score +
      config.weights.recency * recencyScore;

    // Build reasoning string
    const reasoning = [
      `LLM: relevance=${llmResult?.relevance.toFixed(1)}, usefulness=${llmResult?.usefulness.toFixed(1)}`,
      `BM25=${bm25Score.toFixed(2)}`,
      `Recency=${recencyScore.toFixed(2)} (age: ${Math.round((Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60 * 24))}d)`,
      `Tags: ${llmResult?.tags.join(", ") || "none"}`,
    ].join(" | ");

    return {
      ...item,
      bm25Score,
      llmScore: {
        relevance: llmResult?.relevance ?? 5,
        usefulness: llmResult?.usefulness ?? 5,
        tags: llmResult?.tags ?? [],
      },
      recencyScore,
      finalScore,
      reasoning,
    };
  });

  // Filter out off-topic items
  const validItems = rankedItems.filter((item) => {
    const isOffTopic = item.llmScore.tags.includes("off-topic");
    const meetsMinRelevance = item.llmScore.relevance >= config.minRelevance;

    if (isOffTopic) {
      logger.debug(`Filtering out off-topic item: ${item.title}`);
    }
    if (!meetsMinRelevance) {
      logger.debug(
        `Filtering out low relevance item: ${item.title} (score: ${item.llmScore.relevance})`
      );
    }

    return !isOffTopic && meetsMinRelevance;
  });

  // Sort by final score
  validItems.sort((a, b) => b.finalScore - a.finalScore);

  logger.info(
    `Ranked to ${validItems.length} valid items (filtered ${rankedItems.length - validItems.length})`
  );

  return validItems;
}
