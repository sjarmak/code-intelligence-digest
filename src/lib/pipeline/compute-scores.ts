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

/**
 * Compute recency score with exponential decay
 */
function computeRecencyScore(
  publishedAt: Date,
  halfLifeDays: number
): number {
  const now = Date.now();
  const ageMs = now - publishedAt.getTime();
  const ageDays = ageMs / (24 * 60 * 60 * 1000);
  const halfLifeMs = halfLifeDays * 24 * 60 * 60 * 1000;

  // Exponential decay: score = 0.2 + 0.8 * e^(-ln(2) * age / halfLife)
  // This gives us a score that decays from 1.0 to 0.2 over the half-life period
  const decayFactor = Math.exp(-Math.log(2) * (ageMs / halfLifeMs));
  return 0.2 + 0.8 * decayFactor;
}

/**
 * Compute and save scores for items in a category
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

  // Build BM25 index - only for items that need scoring
  const bm25 = new BM25Index();
  bm25.addDocuments(itemsToScore);
  const queryTerms = config.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const bm25Scores = bm25.score(queryTerms);
  const bm25Normalized = bm25.normalizeScores(bm25Scores);

  // Filter out items with insufficient content before LLM scoring
  // Items with only a title (no summary/content) should not be scored by LLM
  // They'll get low BM25-based scores instead
  const itemsWithContent = itemsToScore.filter((item) => {
    const hasRealContent =
      (item.summary && item.summary.length > item.title.length + 20) ||
      (item.contentSnippet && item.contentSnippet.length > item.title.length + 20) ||
      (item.fullText && item.fullText.length > 100);

    if (!hasRealContent) {
      logger.debug(`[SCORE-COMPUTE] Skipping LLM scoring for item "${item.title}" - insufficient content (only title)`);
    }

    return hasRealContent;
  });

  // Compute LLM scores only for items with sufficient content
  logger.info(`[SCORE-COMPUTE] Computing LLM scores for ${itemsWithContent.length} items (filtered ${itemsToScore.length - itemsWithContent.length} items with insufficient content)...`);
  const llmScores = itemsWithContent.length > 0
    ? await scoreWithLLM(itemsWithContent, category, 30) // Batch size 30
    : {};

  // Compute all scores and combine - only for items that need scoring
  const rankedItems: RankedItem[] = itemsToScore.map((item) => {
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
    const contentToSearch = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''}`.toLowerCase();
    const boostTags: string[] = [];

    // For product_news category, heavily boost mentions of specific products
    if (category === "product_news") {
      const productNames = [
        'augment code',
        'claude code',
        'cursor',
        'windsurf',
        'warp',
        'greptile',
        'coderabbit',
        'codex',
        'gemini cli',
        'github copilot',
        'kilo',
      ];

      const matchingProducts = productNames.filter(product =>
        contentToSearch.includes(product)
      );

      if (matchingProducts.length > 0) {
        // Heavy boost for product mentions: 4x for 2+ products, 3x for 1 product
        boostMultiplier = matchingProducts.length >= 2 ? 4.0 : 3.0;
        boostTags.push(...matchingProducts);
        logger.debug(`Applied ${boostMultiplier}x PRODUCT BOOST for ${matchingProducts.join(", ")}: "${item.title}"`);
      }
    }

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
      boostMultiplier = 5.0;
      boostTags.push('sourcegraph');
    } else {
      const matchingCoreTerms = coreTerms.filter(term => contentToSearch.includes(term)).length;
      const hasAgent = contentToSearch.includes('agent') || contentToSearch.includes('agentic') || contentToSearch.includes('coding agent');
      const hasCodeContext = coreTerms.slice(1, 8).some(term => contentToSearch.includes(term));

      if (matchingCoreTerms >= 3) {
        boostMultiplier = 3.0;
      } else if (matchingCoreTerms === 2) {
        boostMultiplier = 2.0;
      } else if (hasAgent && hasCodeContext) {
        boostMultiplier = 2.5;
      } else if (matchingCoreTerms === 1) {
        boostMultiplier = 1.5;
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
    };
  });

  // Save scores to database
  await saveItemScores(rankedItems, category);
  logger.info(`[SCORE-COMPUTE] Saved scores for ${rankedItems.length} items in category: ${category}`);

  return rankedItems.length;
}

/**
 * Compute and save scores for all items, grouped by category
 */
export async function computeAndSaveScoresForItems(
  items: FeedItem[]
): Promise<{ totalScored: number; categoriesScored: Category[] }> {
  if (items.length === 0) {
    return { totalScored: 0, categoriesScored: [] };
  }

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
  let totalScored = 0;
  const categoriesScored: Category[] = [];

  for (const [category, categoryItems] of itemsByCategory.entries()) {
    const scored = await computeAndSaveScoresForCategory(categoryItems, category);
    totalScored += scored;
    if (scored > 0) {
      categoriesScored.push(category);
    }
  }

  logger.info(`[SCORE-COMPUTE] Complete: ${totalScored} items scored across ${categoriesScored.length} categories`);

  return { totalScored, categoriesScored };
}

