/**
 * Ranking pipeline
 * Combines BM25, LLM, recency, and diversity to produce final ranked items
 */

import { FeedItem, RankedItem, Category } from "../model";
import { getCategoryConfig } from "../../config/categories";
import { BM25Index } from "./bm25";
import { loadScoresForItems } from "../db/items";
import { logger } from "../logger";
import { computeRecencyScore, computeBoostMultiplier } from "./scoring-utils";
import { filterLowQualityItem } from "../../config/filter-patterns";

/**
 * Options for the rankCategory function
 */
export interface RankOptions {
  /** Skip filtering items by date/time window. Default: false */
  skipDateFilter?: boolean;
  /** Include recency score in final ranking. Default: true */
  includeRecency?: boolean;
}

/**
 * Rank items for a given category
 * @param items - Feed items to rank
 * @param category - Category to rank for
 * @param periodDays - Time window in days for filtering items
 * @param options - Optional ranking options
 */
export async function rankCategory(
  items: FeedItem[],
  category: Category,
  periodDays: number,
  options?: RankOptions
): Promise<RankedItem[]> {
  if (items.length === 0) {
    return [];
  }

  logger.info(`Ranking ${items.length} items for category: ${category}`);

  const config = getCategoryConfig(category);
  const skipDateFilter = options?.skipDateFilter ?? false;
  const includeRecency = options?.includeRecency ?? true;

  // Filter to items within time window (unless skipDateFilter is true)
  let recentItems: FeedItem[];
  if (skipDateFilter) {
    recentItems = items;
    logger.info(`Skipping date filter, using all ${items.length} items`);
  } else {
    const now = Date.now();
    const windowMs = periodDays * 24 * 60 * 60 * 1000;
    recentItems = items.filter((item) => {
      const ageMs = now - item.publishedAt.getTime();
      return ageMs <= windowMs;
    });
    logger.info(`${recentItems.length} items within ${periodDays} day window`);
  }

  if (recentItems.length === 0) {
    return [];
  }

  // Filter out low-quality items (bad titles, bad URLs, etc.)
  const qualityItems = recentItems.filter((item) => {
    const filterResult = filterLowQualityItem(item);
    if (filterResult.filtered) {
      logger.debug(`Filtering low-quality item: ${item.title} (${filterResult.reason})`);
      return false;
    }
    return true;
  });

  logger.info(`${qualityItems.length} items after quality filter (removed ${recentItems.length - qualityItems.length})`);

  if (qualityItems.length === 0) {
    return [];
  }

  // Build BM25 index
  const bm25 = new BM25Index();
  bm25.addDocuments(qualityItems);
  // Parse query string into terms
  const queryTerms = config.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const bm25Scores = bm25.score(queryTerms);
  const bm25Normalized = bm25.normalizeScores(bm25Scores);

  // Load pre-computed LLM scores from database (only during daily sync should new scores be calculated)
  const itemIds = qualityItems.map((item) => item.id);
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
  const rankedItems: RankedItem[] = qualityItems.map((item) => {
    const bm25Score = bm25Normalized.get(item.id) ?? 0;
    const llmResult = llmScores[item.id];
    // Compute LLM score from pre-computed relevance and usefulness (0.7 * relevance + 0.3 * usefulness)
    // No score = use BM25 as proxy (better than hardcoded 5/10)
    const llmScore = llmResult
      ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10 // Normalize to [0, 1]
      : bm25Score; // Use BM25 as fallback when no LLM score

    // Compute recency score only if includeRecency is true, otherwise use 1.0 (neutral)
    const recencyScore = includeRecency
      ? computeRecencyScore(item.publishedAt, config.halfLifeDays)
      : 1.0;

    // Apply boosts for domain-specific terms (code search, agents, evaluation, etc.)
    const contentToSearch = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''}`;
    const boostResult = computeBoostMultiplier(contentToSearch, category);
    const boostMultiplier = boostResult.multiplier;
    const boostTags: string[] = boostResult.matchedTerms;

    if (boostMultiplier > 1.0) {
      logger.debug(`Applied ${boostMultiplier}x boost (${boostTags.join(', ')}): "${item.title}"`);
    }

    // Compute final score
    let finalScore =
      config.weights.llm * llmScore +
      config.weights.bm25 * bm25Score +
      config.weights.recency * recencyScore;
    
    // Apply boost multiplier
    finalScore = finalScore * boostMultiplier;

    // Build reasoning string
    const ageDays = Math.round((Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60 * 24));
    const reasoning = [
      `LLM: relevance=${llmResult?.relevance.toFixed(1)}, usefulness=${llmResult?.usefulness.toFixed(1)}`,
      `BM25=${bm25Score.toFixed(2)}`,
      includeRecency
        ? `Recency=${recencyScore.toFixed(2)} (age: ${ageDays}d)`
        : `Recency=disabled (age: ${ageDays}d)`,
      boostMultiplier > 1.0 ? `[BOOST] ${boostMultiplier}x (core domain terms)` : '',
      `Tags: ${llmResult?.tags.join(", ") || "none"}`,
    ].filter(Boolean).join(" | ");

    return {
      ...item,
      bm25Score,
      llmScore: {
        relevance: llmResult?.relevance ?? Math.round((bm25Score * 10)),
        usefulness: llmResult?.usefulness ?? Math.round((bm25Score * 10)),
        tags: [...(llmResult?.tags ?? []), ...boostTags],
      },
      recencyScore,
      finalScore,
      reasoning,
    };
  });

  // Filter out off-topic items
  const validItems = rankedItems.filter((item) => {
    const isOffTopic = item.llmScore.tags.includes("off-topic");
    // For items without LLM scores (using BM25 fallback), be more lenient:
    // require relevance >= 3 instead of config.minRelevance (typically 5)
    const hasLLMScore = llmScores[item.id];
    const minThreshold = hasLLMScore ? config.minRelevance : 3;
    const meetsMinRelevance = item.llmScore.relevance >= minThreshold;

    if (isOffTopic) {
      logger.debug(`Filtering out off-topic item: ${item.title}`);
    }
    if (!meetsMinRelevance) {
      logger.debug(
        `Filtering out low relevance item: ${item.title} (score: ${item.llmScore.relevance}, threshold: ${minThreshold})`
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
