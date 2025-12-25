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

  // Filter to items within time window and with valid URLs
  const now = Date.now();
  const windowMs = periodDays * 24 * 60 * 60 * 1000;
  const recentItems = items.filter((item) => {
    const ageMs = now - item.publishedAt.getTime();
    const withinWindow = ageMs <= windowMs;

    // Filter out items with invalid URLs (localhost, empty, or invalid)
    const hasValidUrl = item.url &&
      item.url.startsWith('http://') || item.url.startsWith('https://');
    const isNotLocalhost = !item.url.includes('localhost') && !item.url.includes('127.0.0.1');

    if (!hasValidUrl || !isNotLocalhost) {
      logger.debug(`Filtering out item with invalid URL: "${item.title}" (URL: ${item.url})`);
      return false;
    }

    return withinWindow;
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
    // No score = use BM25 as proxy (better than hardcoded 5/10)
    const llmScore = llmResult
      ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10 // Normalize to [0, 1]
      : bm25Score; // Use BM25 as fallback when no LLM score
    const recencyScore = computeRecencyScore(item.publishedAt, config.halfLifeDays);

    // Apply boosts for domain-specific terms (code search, agents, evaluation, etc.)
    let boostMultiplier = 1.0;
    const contentToSearch = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''}`.toLowerCase();
    const boostTags: string[] = [];

    // SOURCEGRAPH: Highest priority
    const hasSourcegraph = contentToSearch.includes('sourcegraph');

    // Core domain terms
    const coreTerms = [
      'deep search',
      'code search',
      'code intelligence',
      'coding agent',
      'codebase understanding',
      'information retrieval',
      'context management',
      'context window',
      'software engineering',
      'benchmark',
      'evaluation',
      'developer productivity',
      'ai tooling',
    ];

    if (hasSourcegraph) {
      // Sourcegraph gets maximum boost - it's a core product we want to highlight
      boostMultiplier = 5.0;
      boostTags.push('sourcegraph');
      logger.debug(`Applied 5x SOURCEGRAPH BOOST: "${item.title}"`);
    } else {
      // Count matching core terms (excluding sourcegraph)
      const matchingCoreTerms = coreTerms.filter(term => contentToSearch.includes(term)).length;

      // Check for compound terms (agent + code search/intelligence/context)
      const hasAgent = contentToSearch.includes('agent') || contentToSearch.includes('agentic') || contentToSearch.includes('coding agent');
      const hasCodeContext = coreTerms.slice(1, 8).some(term => contentToSearch.includes(term)); // code search through context management

      if (matchingCoreTerms >= 3) {
        // Multiple domain terms = strong signal
        boostMultiplier = 3.0;
        logger.debug(`Applied 3x boost (${matchingCoreTerms} core terms): "${item.title}"`);
      } else if (matchingCoreTerms === 2) {
        boostMultiplier = 2.0;
        logger.debug(`Applied 2x boost (2 core terms): "${item.title}"`);
      } else if (hasAgent && hasCodeContext) {
        // Agent + code search/context = sweet spot
        boostMultiplier = 2.5;
        logger.debug(`Applied 2.5x boost (agent + code context): "${item.title}"`);
      } else if (matchingCoreTerms === 1) {
        boostMultiplier = 1.5;
        logger.debug(`Applied 1.5x boost (1 core term): "${item.title}"`);
      }
    }

    // Compute final score
    let finalScore =
      config.weights.llm * llmScore +
      config.weights.bm25 * bm25Score +
      config.weights.recency * recencyScore;

    // Apply boost multiplier
    finalScore = finalScore * boostMultiplier;

    // Build reasoning string
    const reasoning = [
      `LLM: relevance=${llmResult?.relevance.toFixed(1)}, usefulness=${llmResult?.usefulness.toFixed(1)}`,
      `BM25=${bm25Score.toFixed(2)}`,
      `Recency=${recencyScore.toFixed(2)} (age: ${Math.round((Date.now() - item.publishedAt.getTime()) / (1000 * 60 * 60 * 24))}d)`,
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

  // Sort by final score first (before filtering)
  rankedItems.sort((a, b) => b.finalScore - a.finalScore);

  // Filter out off-topic items (always filter these, regardless of threshold)
  const nonOffTopicItems = rankedItems.filter((item) => {
    const isOffTopic = item.llmScore.tags.includes("off-topic");
    if (isOffTopic) {
      logger.debug(`Filtering out off-topic item: ${item.title}`);
    }
    return !isOffTopic;
  });

  // Adaptive threshold: start with configured minRelevance, but lower it if needed
  // to ensure we return at least maxItems (or as many as available)
  const targetItems = config.maxItems;
  let currentThreshold = config.minRelevance;
  const minAllowedThreshold = 3; // Never go below 3 (too permissive)

  // For items without LLM scores (BM25 fallback), use lower threshold
  const hasLLMScore = (item: RankedItem) => !!llmScores[item.id];

  let validItems: RankedItem[] = [];

  // Try progressively lower thresholds until we have enough items
  while (currentThreshold >= minAllowedThreshold && validItems.length < targetItems) {
    validItems = nonOffTopicItems.filter((item) => {
      const itemHasLLMScore = hasLLMScore(item);
      // For items without LLM scores, use more lenient threshold (3)
      const itemThreshold = itemHasLLMScore ? currentThreshold : 3;
      const meetsMinRelevance = item.llmScore.relevance >= itemThreshold;

      if (!meetsMinRelevance && currentThreshold === config.minRelevance) {
        // Only log on first pass to avoid spam
        logger.debug(
          `Filtering out low relevance item: ${item.title} (score: ${item.llmScore.relevance}, threshold: ${itemThreshold})`
        );
      }

      return meetsMinRelevance;
    });

    // If we have enough items, stop
    if (validItems.length >= targetItems) {
      break;
    }

    // Lower threshold and try again (but not below minAllowedThreshold)
    if (currentThreshold > minAllowedThreshold) {
      currentThreshold = Math.max(minAllowedThreshold, currentThreshold - 1);
      logger.debug(
        `Lowering relevance threshold to ${currentThreshold} to get more items (have ${validItems.length}, need ${targetItems})`
      );
    } else {
      // Can't go lower, use what we have
      break;
    }
  }

  // Take only top targetItems (already sorted by final score)
  validItems = validItems.slice(0, targetItems);

  if (currentThreshold < config.minRelevance) {
    logger.info(
      `Ranked to ${validItems.length} valid items (lowered threshold from ${config.minRelevance} to ${currentThreshold} to reach target of ${targetItems})`
    );
  } else {
    logger.info(
      `Ranked to ${validItems.length} valid items (filtered ${rankedItems.length - validItems.length}, threshold: ${currentThreshold})`
    );
  }

  return validItems;
}
