/**
 * Compute and save relevance scores for items
 * Called during sync to pre-compute scores for faster API responses
 */

import { FeedItem, RankedItem, Category } from "../model";
import { getCategoryConfig } from "../../config/categories";
import { BM25Index } from "./bm25";
import { scoreWithLLM } from "./llmScore";
import { saveItemScores } from "../db/scores";
import { loadScoresForItems } from "../db/items";
import { logger } from "../logger";
import {
  withDegradationTracking,
  getDegradationSummary,
  type DegradationSummary,
} from "../observability/degradation";
import { computeProductBoost, findProductMentions } from "../../config/products";
import { computeWatchlistBoost } from "../../config/watchlist";
import { detectCompetitorSignals } from "../../config/competitor-intel";

/**
 * Compute recency score with exponential decay
 */
function computeRecencyScore(
  publishedAt: Date,
  halfLifeDays: number
): number {
  const now = Date.now();
  const ageMs = now - publishedAt.getTime();
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;

  // Exponential decay: score = 0.2 + 0.8 * e^(-ln(2) * age / halfLife)
  // This gives us a score that decays from 1.0 to 0.2 over the half-life period
  const decayFactor = Math.exp(-Math.log(2) * (ageMs / halfLifeMs));
  return 0.2 + 0.8 * decayFactor;
}

/**
 * Compute and save scores for items in a category
 * Processes items in batches to avoid memory issues
 */
export async function computeAndSaveScoresForCategory(
  items: FeedItem[],
  category: Category
): Promise<number> {
  if (items.length === 0) {
    return 0;
  }

  logger.info(`[SCORE-COMPUTE] Computing scores for ${items.length} items in category: ${category}`);

  // Load existing scores to avoid recomputing - only score items that don't have scores
  const itemIds = items.map((item) => item.id);
  const existingScores = await loadScoresForItems(itemIds);

  // Filter out items that already have scores - we only add scores, never rescore
  const itemsToScore = items.filter((item) => !existingScores[item.id]);

  if (itemsToScore.length === 0) {
    logger.info(`[SCORE-COMPUTE] All ${items.length} items already have scores, skipping (no rescoring)`);
    return 0;
  }

  logger.info(`[SCORE-COMPUTE] ${itemsToScore.length} items need scores (${items.length - itemsToScore.length} already have scores, skipping)`);

  const config = getCategoryConfig(category);

  // Process in batches to avoid memory issues (especially for research items with full text)
  // Batch size: 25 items for research (has full text, very memory-intensive), 100 for other categories
  // Research items with full text can be several MB each, so smaller batches are needed
  const BATCH_SIZE = category === 'research' ? 25 : 100;
  let totalScored = 0;

  for (let i = 0; i < itemsToScore.length; i += BATCH_SIZE) {
    const batch = itemsToScore.slice(i, i + BATCH_SIZE);
    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const totalBatches = Math.ceil(itemsToScore.length / BATCH_SIZE);

    logger.info(`[SCORE-COMPUTE] Processing batch ${batchNum}/${totalBatches} (${batch.length} items)...`);

    // Build BM25 index for this batch
    const bm25 = new BM25Index();
    bm25.addDocuments(batch);
    const queryTerms = config.query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 0);
    const bm25Scores = bm25.score(queryTerms);
    const bm25Normalized = bm25.normalizeScores(bm25Scores);

    // Filter out items with insufficient content before LLM scoring
    const itemsWithContent = batch.filter((item) => {
      const hasRealContent =
        (item.summary && item.summary.length > item.title.length + 20) ||
        (item.contentSnippet && item.contentSnippet.length > item.title.length + 20) ||
        (item.fullText && item.fullText.length > 100);
      return hasRealContent;
    });

    // Compute LLM scores only for items with sufficient content
    const llmScores = itemsWithContent.length > 0
      ? await scoreWithLLM(itemsWithContent, category, 30) // LLM batch size 30
      : {};

    // Compute all scores and combine - only for items that need scoring
    const rankedItems: RankedItem[] = batch.map((item) => {
      const bm25Score = bm25Normalized.get(item.id) ?? 0;
      const llmResult = llmScores[item.id];

      // Check if item has insufficient content
      const hasRealContent =
        (item.summary && item.summary.length > item.title.length + 20) ||
        (item.contentSnippet && item.contentSnippet.length > item.title.length + 20) ||
        (item.fullText && item.fullText.length > 100);

      // Compute LLM score from relevance and usefulness (0.7 * relevance + 0.3 * usefulness)
      // For items with insufficient content, use a conservative score (lower than BM25)
      const llmScore = llmResult
        ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10 // Normalize to [0, 1]
        : hasRealContent
          ? bm25Score // Use BM25 as fallback when no LLM score but has content
          : bm25Score * 0.3; // Penalize items with insufficient content (30% of BM25)

      // Compute recency score (only used for "all time" period, and even then it's subtle)
      // For score computation, we don't know the period, so we compute it but it won't be used
      // unless the period is "all time" (handled in rank.ts)
      const recencyScore = computeRecencyScore(item.publishedAt, config.halfLifeDays);

      // Apply boosts for domain-specific terms
      let boostMultiplier = 1.0;
      const contentToSearch = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''}`;
      const lowerContent = contentToSearch.toLowerCase();
      const boostTags: string[] = [];

      // Product-specific boost (stronger for key competitors/own products in product_news)
      const productBoost = computeProductBoost(category, contentToSearch);
      boostMultiplier *= productBoost.multiplier;
      boostTags.push(...productBoost.tags);

      // Watchlist boost: matches high-signal keywords across themes
      const watchlistBoost = computeWatchlistBoost(contentToSearch);
      boostMultiplier *= watchlistBoost.multiplier;
      boostTags.push(...watchlistBoost.matchedTerms);

      // Product-news-specific competitor intelligence enrichment:
      // detect competitor/entity and overlap surfaces, then apply a modest ranking boost.
      if (category === "product_news") {
        const intelSignals = detectCompetitorSignals(contentToSearch);
        if (intelSignals.competitorIds.length > 0 || intelSignals.surfaces.length > 0) {
          const intelBoost = 1 +
            Math.min(
              0.18,
              intelSignals.competitorIds.length * 0.03 + intelSignals.surfaces.length * 0.02
            );
          boostMultiplier *= intelBoost;
          boostTags.push(
            ...intelSignals.competitorIds.map((id) => `competitor:${id}`),
            ...intelSignals.surfaces.map((surface) => `surface:${surface}`)
          );
        }
      }

      // Compute final score
      let finalScore =
        config.weights.llm * llmScore +
        config.weights.bm25 * bm25Score;

      // Apply boost multiplier
      finalScore = finalScore * boostMultiplier;

      // Build reasoning string
      const reasoning = [
        `LLM: relevance=${llmResult?.relevance.toFixed(1)}, usefulness=${llmResult?.usefulness.toFixed(1)}`,
        `BM25=${bm25Score.toFixed(2)}`,
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
        // Preserve productMentions for existing consumers using the older helper
        productMentions: findProductMentions(lowerContent) || undefined,
      };
    });

    // Save scores to database for this batch
    await saveItemScores(rankedItems, category);
    totalScored += rankedItems.length;
    logger.info(`[SCORE-COMPUTE] Saved scores for batch ${batchNum}/${totalBatches} (${rankedItems.length} items, ${totalScored} total so far)`);
  }

  logger.info(`[SCORE-COMPUTE] Complete: ${totalScored} items scored in category: ${category}`);
  return totalScored;
}

export interface ComputeScoresResult {
  totalScored: number;
  categoriesScored: Category[];
  /**
   * Degradation seen while scoring this batch (bd-sgo): pseudo-embeddings and
   * neutral (5,5) LLM scores caused by a missing key, a batch-size mismatch, or
   * a scoring failure. Always present so the caller can persist or inspect it;
   * branch on `.degraded`. This is the "pipeline output" half of surfacing
   * silent fallbacks — agent runs surface the same summary in agent_runs
   * metadata via persistAgentRun.
   */
  degradation: DegradationSummary;
}

/**
 * Compute and save scores for all items, grouped by category.
 *
 * The whole batch runs inside a degradation-tracking context so the neutral-score
 * and pseudo-embedding fallbacks reached during scoring are accumulated and
 * returned in `degradation` — queryable by the caller, not just logged.
 */
export async function computeAndSaveScoresForItems(
  items: FeedItem[]
): Promise<ComputeScoresResult> {
  return withDegradationTracking(async () => {
    let totalScored = 0;
    const categoriesScored: Category[] = [];

    if (items.length > 0) {
      logger.info(`[SCORE-COMPUTE] Computing scores for ${items.length} items across all categories`);

      // Group items by category
      const itemsByCategory = new Map<Category, FeedItem[]>();
      for (const item of items) {
        if (!itemsByCategory.has(item.category)) {
          itemsByCategory.set(item.category, []);
        }
        itemsByCategory.get(item.category)!.push(item);
      }

      // Compute scores for each category
      for (const [category, categoryItems] of itemsByCategory.entries()) {
        const scored = await computeAndSaveScoresForCategory(categoryItems, category);
        totalScored += scored;
        if (scored > 0) {
          categoriesScored.push(category);
        }
      }

      logger.info(`[SCORE-COMPUTE] Complete: ${totalScored} items scored across ${categoriesScored.length} categories`);
    }

    // Inside withDegradationTracking the summary is always established.
    const degradation = getDegradationSummary()!;
    if (degradation.degraded) {
      logger.warn(
        "[SCORE-COMPUTE] Scoring degraded: some items received non-semantic fallback scores",
        { degradation },
      );
    }

    return { totalScored, categoriesScored, degradation };
  });
}
