/**
 * Ranking pipeline
 * Combines BM25, LLM, recency, and diversity to produce final ranked items
 */

import { FeedItem, RankedItem, Category } from "../model";
import { getCategoryConfig } from "../../config/categories";
import { BM25Index } from "./bm25";
import { loadScoresForItems } from "../db/items";
import { logger } from "../logger";
import {
  computeProductBoost,
  findProductMentions,
  getProductById,
  getCompetitorProducts,
} from "../../config/products";

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
  periodDays: number,
  period?: string,
  options?: { skipDateFilter?: boolean }
): Promise<RankedItem[]> {
  if (items.length === 0) {
    return [];
  }

  logger.info(`Ranking ${items.length} items for category: ${category}`);

  const config = getCategoryConfig(category);

  // Filter to items within time window and with valid URLs
  // For "day" period, use createdAt (when Inoreader received it) to show recently received items
  // For other periods, use publishedAt to show items by their original publication date
  // For newsletters with day period, items are already filtered by the API route using the most recent item's timestamp
  // So we should skip date filtering here to avoid double-filtering
  // For research and product_news with day period, items are also already filtered by API route (3 days)
  const now = Date.now();
  const windowMs = periodDays * 24 * 60 * 60 * 1000;
  // Use created_at for day period (1-3 days) to show items by when Inoreader received them
  // For newsletters on weekdays, periodDays will be 1; on weekends, 2; for other categories, 3
  // For newsletters and product_news with day period, skip date filtering since items are already filtered by API route
  // For research: API route handles filtering (created_at for day/week, published_at for month/all)
  const useCreatedAt = periodDays <= 3;
  // Skip date filtering when items are already filtered by API route
  // Research: API route filters by created_at (day/week) or published_at (month/all), so skip here
  const skipDateFilterByCategoryPeriod =
    (period === "day" && (category === "newsletters" || category === "product_news")) ||
    category === "research"; // All research periods are filtered by API route
  const skipDateFilter = options?.skipDateFilter === true ? true : skipDateFilterByCategoryPeriod;

  // Patterns for low-quality items that should be filtered out
  const BAD_TITLE_PATTERNS = [
    /^unsubscribe$/i,
    /^terms of service$/i,
    /^powered by/i,
    /^signup$/i,
    /^work with us$/i,
    /^follow on/i,
    /^track your referrals/i,
    /^apply here$/i,
    /^create your own role$/i,
    /^advertise with us$/i,
    /^view online$/i,
    /^click to open/i,
    /^watch this$/i,
    /^twitter$/i,
    /^releases$/i,
    /^app platform$/i,
    /^lands$/i,
    /^introduces$/i,
    /^rolled out$/i,
    /^drops$/i,
    /^brings$/i,
    /^released$/i,
    /^read the paper$/i,
    /^awesome$/i,
    /^decent$/i,
    /^not great$/i,
    /^spotify$/i,
    /^watch it!$/i,
    /^\.$/i, // Just a period
    /^partner with us$/i,
    /^try the demo$/i,
    /^star on github/i,
    /^explore now$/i,
    /^access bloom$/i,
    // Test/debug content
    /^test the code$/i,
    /^test$/i,
    /^debug$/i,
    /^test article$/i,
    /^test post$/i,
    /^test entry$/i,
    // Sponsor/promotional content
    /\(sponsor\)/i,
    /\(sponsored\)/i,
    /sponsor:/i,
    /^sponsor$/i,
    /promotional content/i,
    /advertisement/i,
    /^ad$/i,
    /^advert$/i,
    /craving more/i,
    /in your inbox/i,
    /^book a demo$/i,
    /^register now$/i,
    /^register$/i,
  ];

  const BAD_URL_PATTERNS = [
    /unsubscribe/i,
    /terms/i,
    /signup/i,
    /beehiiv/i,
    /sparklp\.co/i,
    /refer\.tldr/i,
    /advertise\.tldr/i,
    /jobs\.ashbyhq\.com\/tldr/i,
    /linkedin\.com\/in\//i, // LinkedIn profiles
    /twitter\.com\/[^/]+$/i, // Twitter profiles (not tweets)
    /awstrack\.me/i, // Tracking URLs
  ];

  const recentItems = items.filter((item) => {
    // For newsletters with day period, items are already filtered by API route using most recent item's timestamp
    // Skip date filtering here to avoid double-filtering
    let withinWindow: boolean = true;
    if (!skipDateFilter) {
      // For day period, STRICTLY require createdAt and use it for filtering
      // Do NOT fall back to publishedAt for day period - this causes old items to appear
      if (useCreatedAt) {
        if (!item.createdAt) {
          logger.warn(`[rankCategory] Item ${item.id} missing createdAt for day period - filtering out to prevent old items from appearing`);
          return false;
        }
        const createdAtAgeMs = now - item.createdAt.getTime();
        if (createdAtAgeMs > windowMs) {
          logger.debug(`[rankCategory] Filtering out item ${item.id} - createdAt is ${Math.floor(createdAtAgeMs / (24 * 60 * 60 * 1000))} days ago (outside ${periodDays} day window)`);
          return false;
        }
        // Use createdAt for day period
        withinWindow = createdAtAgeMs <= windowMs;
      } else {
        // For longer periods, use publishedAt
        const ageMs = now - item.publishedAt.getTime();
        withinWindow = ageMs <= windowMs;
      }
    }

    // Filter out items with invalid URLs (localhost, empty, or invalid)
    const hasValidUrl = item.url &&
      (item.url.startsWith('http://') || item.url.startsWith('https://'));
    const isNotLocalhost = !item.url.includes('localhost') && !item.url.includes('127.0.0.1');

    if (!hasValidUrl || !isNotLocalhost) {
      logger.debug(`Filtering out item with invalid URL: "${item.title}" (URL: ${item.url})`);
      return false;
    }

    // Filter out low-quality titles
    const titleLower = item.title.toLowerCase().trim();
    for (const pattern of BAD_TITLE_PATTERNS) {
      if (pattern.test(titleLower)) {
        logger.debug(`Filtering out low-quality item by title: "${item.title}"`);
        return false;
      }
    }

    // Filter out items with sponsor/promotional content in title
    if (titleLower.includes('(sponsor') || titleLower.includes('sponsor)') ||
        titleLower.includes('(sponsored') || titleLower.includes('sponsored)') ||
        titleLower.includes('craving more') || titleLower.includes('in your inbox') ||
        (titleLower.includes('sponsor') && titleLower.length < 50)) { // Short titles with "sponsor"
      logger.debug(`Filtering out sponsored/promotional item: "${item.title}"`);
      return false;
    }

    // Filter out bad URLs
    const urlLower = item.url.toLowerCase();
    for (const pattern of BAD_URL_PATTERNS) {
      if (pattern.test(urlLower)) {
        logger.debug(`Filtering out low-quality item by URL: "${item.title}" (URL: ${item.url})`);
        return false;
      }
    }

    // Filter out items with very short titles (likely not real articles)
    if (item.title.trim().length < 10) {
      logger.debug(`Filtering out item with very short title: "${item.title}"`);
      return false;
    }

    // Filter out non-English articles
    // Use dynamic import at top level to avoid async in filter
    const { shouldFilterNonEnglish } = require("@/src/lib/utils/language-detection");
    if (shouldFilterNonEnglish(item)) {
      logger.debug(`Filtering out non-English item: "${item.title}"`);
      return false;
    }

    return withinWindow;
  });

  logger.info(`${recentItems.length} items within ${periodDays} day window`);

  if (recentItems.length === 0) {
    return [];
  }

  // Pre-filter to reduce items before expensive operations
  logger.info(`Starting early filtering for ${recentItems.length} items`);

  // 1. Filter by minimum content length (avoid empty/spam items)
  const minContentLength = 50;
  const contentFiltered = recentItems.filter(item => {
    const contentLength = (item.title + (item.summary || "") + (item.contentSnippet || "")).length;
    if (contentLength < minContentLength) {
      logger.debug(`Pre-filtering insufficient content: "${item.title}"`);
      return false;
    }
    return true;
  });

  logger.info(`Content pre-filter: ${recentItems.length} → ${contentFiltered.length} items`);

  // 2. Load scores early and filter by quality
  const itemIds = contentFiltered.map(item => item.id);
  logger.debug(`[RANK] Loading scores for ${itemIds.length} items`);
  const preComputedScores = await loadScoresForItems(itemIds);
  logger.debug(`[RANK] Loaded scores for ${Object.keys(preComputedScores).length} items`);

  // Use category-specific minRelevance, but be more lenient for "day" period
  // For daily view, we want to show more items even if they're slightly less relevant
  // This ensures we have enough items to display when viewing "today's" content
  const categoryMinRelevance = getCategoryConfig(category).minRelevance;
  const qualityThreshold = periodDays === 3  // day period is now 3 days
    ? 2  // For "day" period, use very low threshold (2) to show more items
    : Math.max(3, categoryMinRelevance - 1);  // For other periods, use category config minus 1 (min 3)

  const qualityFiltered = contentFiltered.filter(item => {
    const score = preComputedScores[item.id];
    if (score) {
      // Filter off-topic items
      if (score.llm_tags.includes("off-topic")) {
        logger.debug(`Pre-filtering off-topic: "${item.title}"`);
        return false;
      }
      // Filter very low relevance items (use category-specific threshold)
      if (score.llm_relevance < qualityThreshold) {
        logger.debug(`Pre-filtering low relevance: "${item.title}" (${score.llm_relevance} < ${qualityThreshold})`);
        return false;
      }
    }
    // Items without scores pass through (they'll be scored on-the-fly or use BM25)
    return true;
  });

  logger.info(`Quality pre-filter: ${contentFiltered.length} → ${qualityFiltered.length} items`);

  // Build BM25 index with filtered items
  const bm25 = new BM25Index();
  bm25.addDocuments(qualityFiltered);  // Use filtered items instead of recentItems
  // Parse query string into terms
  const queryTerms = config.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const bm25Scores = bm25.score(queryTerms);
  const bm25Normalized = bm25.normalizeScores(bm25Scores);

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

  // Compute all scores and combine (use qualityFiltered instead of recentItems)
  const rankedItems: RankedItem[] = qualityFiltered.map((item) => {
    // Use pre-computed BM25 score if available, otherwise compute it
    const preComputedScore = preComputedScores[item.id];
    const bm25Score = preComputedScore?.bm25_score !== undefined
      ? preComputedScore.bm25_score
      : (bm25Normalized.get(item.id) ?? 0);

    const llmResult = llmScores[item.id];
    // Compute LLM score from pre-computed relevance and usefulness (0.7 * relevance + 0.3 * usefulness)
    // No score = use BM25 as proxy (better than hardcoded 5/10)
    const llmScore = llmResult
      ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10 // Normalize to [0, 1]
      : bm25Score; // Use BM25 as fallback when no LLM score

    // For "day" period, use createdAt for recency; otherwise use publishedAt
    // Recency scores are time-dependent, so we recompute them (they change over time)
    // Only compute recency for "all time" period (90 days), and even then it's subtle
    const dateForRecency = useCreatedAt && item.createdAt ? item.createdAt : item.publishedAt;
    const isAllTimePeriod = periodDays >= 90; // "all time" period
    const recencyScore = isAllTimePeriod
      ? computeRecencyScore(dateForRecency, config.halfLifeDays)
      : 1.0; // No recency boost for non-all-time periods (neutral score)

    // Apply boosts for domain-specific terms (code search, agents, evaluation, etc.)
    let boostMultiplier = 1.0;
    const contentToSearch = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''}`;
    const lowerContent = contentToSearch.toLowerCase();
    const boostTags: string[] = [];

    // Product-specific boost (stronger for key competitors/own products in product_news)
    const productBoost = computeProductBoost(category, contentToSearch);
    boostMultiplier *= productBoost.multiplier;
    boostTags.push(...productBoost.tags);

    // SOURCEGRAPH: Highest priority
    const hasSourcegraph = lowerContent.includes('sourcegraph');

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
      const matchingCoreTerms = coreTerms.filter(term => lowerContent.includes(term)).length;

      // Check for compound terms (agent + code search/intelligence/context)
      const hasAgent = lowerContent.includes('agent') || lowerContent.includes('agentic') || lowerContent.includes('coding agent');
      const hasCodeContext = coreTerms.slice(1, 8).some(term => lowerContent.includes(term)); // code search through context management

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
    // Only apply subtle recency boost for "all time" period (periodDays >= 90)
    // For other periods, recency is already handled by time-boxed filtering
    const recencyWeight = isAllTimePeriod ? 0.05 : 0; // Subtle 5% weight only for all-time

    // Use pre-computed final score as base if available, but still apply dynamic boosts
    let finalScore: number;
    if (preComputedScore?.final_score !== undefined && boostMultiplier === 1.0 && recencyWeight === 0) {
      // Use pre-computed score if no boosts are applied and no recency (most common case)
      finalScore = preComputedScore.final_score;
    } else {
      // Recompute final score (needed when boosts are applied or recency is needed)
      const baseScore = config.weights.llm * llmScore + config.weights.bm25 * bm25Score;
      // Apply subtle recency boost only for all-time period
      const recencyAdjustedScore = baseScore * (1 - recencyWeight) + baseScore * recencyWeight * recencyScore;
      // Apply boost multiplier
      finalScore = recencyAdjustedScore * boostMultiplier;
    }

    // Build reasoning string
    const reasoning = [
      `LLM: relevance=${llmResult?.relevance.toFixed(1)}, usefulness=${llmResult?.usefulness.toFixed(1)}`,
      `BM25=${bm25Score.toFixed(2)}`,
      boostMultiplier > 1.0 ? `[BOOST] ${boostMultiplier}x (core domain terms)` : '',
      `Tags: ${llmResult?.tags.join(", ") || "none"}`,
    ].filter(Boolean).join(" | ");

    const detectedProductIds = findProductMentions(lowerContent);

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
      productMentions: detectedProductIds.length > 0 ? detectedProductIds : undefined,
    };
  });

  // Sort by final score first (before filtering)
  rankedItems.sort((a, b) => b.finalScore - a.finalScore);

  // Filter out off-topic items only (no threshold filtering - show top items by score)
  const nonOffTopicItems = rankedItems.filter((item) => {
    const isOffTopic = item.llmScore.tags.includes("off-topic");
    if (isOffTopic) {
      logger.debug(`Filtering out off-topic item: ${item.title}`);
    }
    return !isOffTopic;
  });

  // Return all non-off-topic items, sorted by final score
  // Selection logic will handle limiting to top 10 and diversity
  logger.info(
    `Ranked to ${nonOffTopicItems.length} valid items (filtered ${rankedItems.length - nonOffTopicItems.length} off-topic items)`
  );

  return nonOffTopicItems;
}

/**
 * Rank items for a given category without recency component
 * Uses formula: finalScore = (LLM_norm * 0.60) + (BM25_norm * 0.40)
 * This prioritizes relevance over recency for audio digest generation
 */
export async function rankCategoryWithoutRecency(
  items: FeedItem[],
  category: Category,
  periodDays: number,
  period?: string
): Promise<RankedItem[]> {
  if (items.length === 0) {
    return [];
  }

  logger.info(`Ranking ${items.length} items for category: ${category} (without recency)`);

  const config = getCategoryConfig(category);

  // Filter to items within time window and with valid URLs (same as rankCategory)
  const now = Date.now();
  const windowMs = periodDays * 24 * 60 * 60 * 1000;
  const useCreatedAt = periodDays <= 3;
  const skipDateFilter = (period === "day" && (category === "newsletters" || category === "product_news")) ||
                         (category === "research");

  // Patterns for low-quality items that should be filtered out (same as rankCategory)
  const BAD_TITLE_PATTERNS = [
    /^unsubscribe$/i,
    /^terms of service$/i,
    /^powered by/i,
    /^signup$/i,
    /^work with us$/i,
    /^follow on/i,
    /^track your referrals/i,
    /^apply here$/i,
    /^create your own role$/i,
    /^advertise with us$/i,
    /^view online$/i,
    /^click to open/i,
    /^watch this$/i,
    /^twitter$/i,
    /^releases$/i,
    /^app platform$/i,
    /^lands$/i,
    /^introduces$/i,
    /^rolled out$/i,
    /^drops$/i,
    /^brings$/i,
    /^released$/i,
    /^read the paper$/i,
    /^awesome$/i,
    /^decent$/i,
    /^not great$/i,
    /^spotify$/i,
    /^watch it!$/i,
    /^\.$/i,
    /^partner with us$/i,
    /^try the demo$/i,
    /^star on github/i,
    /^explore now$/i,
    /^access bloom$/i,
    /^test the code$/i,
    /^test$/i,
    /^debug$/i,
    /^test article$/i,
    /^test post$/i,
    /^test entry$/i,
    /\(sponsor\)/i,
    /\(sponsored\)/i,
    /sponsor:/i,
    /^sponsor$/i,
    /promotional content/i,
    /advertisement/i,
    /^ad$/i,
    /^advert$/i,
    /craving more/i,
    /in your inbox/i,
    /^book a demo$/i,
    /^register now$/i,
    /^register$/i,
  ];

  const BAD_URL_PATTERNS = [
    /unsubscribe/i,
    /terms/i,
    /signup/i,
    /beehiiv/i,
    /sparklp\.co/i,
    /refer\.tldr/i,
    /advertise\.tldr/i,
    /jobs\.ashbyhq\.com\/tldr/i,
    /linkedin\.com\/in\//i,
    /twitter\.com\/[^/]+$/i,
    /awstrack\.me/i,
  ];

  const recentItems = items.filter((item) => {
    let withinWindow: boolean = true;
    if (!skipDateFilter) {
      if (useCreatedAt) {
        if (!item.createdAt) {
          logger.warn(`[rankCategoryWithoutRecency] Item ${item.id} missing createdAt for day period - filtering out`);
          return false;
        }
        const createdAtAgeMs = now - item.createdAt.getTime();
        if (createdAtAgeMs > windowMs) {
          logger.debug(`[rankCategoryWithoutRecency] Filtering out item ${item.id} - createdAt is ${Math.floor(createdAtAgeMs / (24 * 60 * 60 * 1000))} days ago`);
          return false;
        }
        withinWindow = createdAtAgeMs <= windowMs;
      } else {
        const ageMs = now - item.publishedAt.getTime();
        withinWindow = ageMs <= windowMs;
      }
    }

    const hasValidUrl = item.url &&
      (item.url.startsWith('http://') || item.url.startsWith('https://'));
    const isNotLocalhost = !item.url.includes('localhost') && !item.url.includes('127.0.0.1');

    if (!hasValidUrl || !isNotLocalhost) {
      logger.debug(`Filtering out item with invalid URL: "${item.title}" (URL: ${item.url})`);
      return false;
    }

    const titleLower = item.title.toLowerCase().trim();
    for (const pattern of BAD_TITLE_PATTERNS) {
      if (pattern.test(titleLower)) {
        logger.debug(`Filtering out low-quality item by title: "${item.title}"`);
        return false;
      }
    }

    if (titleLower.includes('(sponsor') || titleLower.includes('sponsor)') ||
        titleLower.includes('(sponsored') || titleLower.includes('sponsored)') ||
        titleLower.includes('craving more') || titleLower.includes('in your inbox') ||
        (titleLower.includes('sponsor') && titleLower.length < 50)) {
      logger.debug(`Filtering out sponsored/promotional item: "${item.title}"`);
      return false;
    }

    const urlLower = item.url.toLowerCase();
    for (const pattern of BAD_URL_PATTERNS) {
      if (pattern.test(urlLower)) {
        logger.debug(`Filtering out low-quality item by URL: "${item.title}" (URL: ${item.url})`);
        return false;
      }
    }

    if (item.title.trim().length < 10) {
      logger.debug(`Filtering out item with very short title: "${item.title}"`);
      return false;
    }

    const { shouldFilterNonEnglish } = require("@/src/lib/utils/language-detection");
    if (shouldFilterNonEnglish(item)) {
      logger.debug(`Filtering out non-English item: "${item.title}"`);
      return false;
    }

    return withinWindow;
  });

  logger.info(`${recentItems.length} items within ${periodDays} day window`);

  if (recentItems.length === 0) {
    return [];
  }

  // Pre-filter to reduce items before expensive operations
  logger.info(`Starting early filtering for ${recentItems.length} items`);

  const minContentLength = 50;
  const contentFiltered = recentItems.filter(item => {
    const contentLength = (item.title + (item.summary || "") + (item.contentSnippet || "")).length;
    if (contentLength < minContentLength) {
      logger.debug(`Pre-filtering insufficient content: "${item.title}"`);
      return false;
    }
    return true;
  });

  logger.info(`Content pre-filter: ${recentItems.length} → ${contentFiltered.length} items`);

  const itemIds = contentFiltered.map(item => item.id);
  logger.debug(`[RANK] Loading scores for ${itemIds.length} items`);
  const preComputedScores = await loadScoresForItems(itemIds);
  logger.debug(`[RANK] Loaded scores for ${Object.keys(preComputedScores).length} items`);

  const categoryMinRelevance = getCategoryConfig(category).minRelevance;
  const qualityThreshold = periodDays === 3
    ? 2
    : Math.max(3, categoryMinRelevance - 1);

  const qualityFiltered = contentFiltered.filter(item => {
    const score = preComputedScores[item.id];
    if (score) {
      if (score.llm_tags.includes("off-topic")) {
        logger.debug(`Pre-filtering off-topic: "${item.title}"`);
        return false;
      }
      if (score.llm_relevance < qualityThreshold) {
        logger.debug(`Pre-filtering low relevance: "${item.title}" (${score.llm_relevance} < ${qualityThreshold})`);
        return false;
      }
    }
    return true;
  });

  logger.info(`Quality pre-filter: ${contentFiltered.length} → ${qualityFiltered.length} items`);

  // Build BM25 index
  const bm25 = new BM25Index();
  bm25.addDocuments(qualityFiltered);
  const queryTerms = config.query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 0);
  const bm25Scores = bm25.score(queryTerms);
  const bm25Normalized = bm25.normalizeScores(bm25Scores);

  // Convert to LLMScoreResult format
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

  // Compute all scores and combine (NO RECENCY)
  const rankedItems: RankedItem[] = qualityFiltered.map((item) => {
    const preComputedScore = preComputedScores[item.id];
    const bm25Score = preComputedScore?.bm25_score !== undefined
      ? preComputedScore.bm25_score
      : (bm25Normalized.get(item.id) ?? 0);

    const llmResult = llmScores[item.id];
    // Compute LLM score from pre-computed relevance and usefulness
    const llmScore = llmResult
      ? (0.7 * llmResult.relevance + 0.3 * llmResult.usefulness) / 10 // Normalize to [0, 1]
      : bm25Score; // Use BM25 as fallback when no LLM score

    // Apply boosts for domain-specific terms (same as rankCategory)
    let boostMultiplier = 1.0;
    const contentToSearch = `${item.title} ${item.summary || ''} ${item.contentSnippet || ''}`.toLowerCase();
    const boostTags: string[] = [];

    // Detect product mentions in content (used for filtering and boosting)
    const detectedProductIds = findProductMentions(contentToSearch);

    if (category === "product_news" && detectedProductIds.length > 0) {
      boostMultiplier = detectedProductIds.length >= 2 ? 4.0 : 3.0;
      boostTags.push(...detectedProductIds);
      logger.debug(`Applied ${boostMultiplier}x PRODUCT BOOST for ${detectedProductIds.join(", ")}: "${item.title}"`);
    }

    const hasSourcegraph = contentToSearch.includes('sourcegraph');
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
      logger.debug(`Applied 5x SOURCEGRAPH BOOST: "${item.title}"`);
    } else {
      const matchingCoreTerms = coreTerms.filter(term => contentToSearch.includes(term)).length;
      const hasAgent = contentToSearch.includes('agent') || contentToSearch.includes('agentic') || contentToSearch.includes('coding agent');
      const hasCodeContext = coreTerms.slice(1, 8).some(term => contentToSearch.includes(term));

      if (matchingCoreTerms >= 3) {
        boostMultiplier = 3.0;
        logger.debug(`Applied 3x boost (${matchingCoreTerms} core terms): "${item.title}"`);
      } else if (matchingCoreTerms === 2) {
        boostMultiplier = 2.0;
        logger.debug(`Applied 2x boost (2 core terms): "${item.title}"`);
      } else if (hasAgent && hasCodeContext) {
        boostMultiplier = 2.5;
        logger.debug(`Applied 2.5x boost (agent + code context): "${item.title}"`);
      } else if (matchingCoreTerms === 1) {
        boostMultiplier = 1.5;
        logger.debug(`Applied 1.5x boost (1 core term): "${item.title}"`);
      }
    }

    // Compute final score WITHOUT RECENCY: LLM 60%, BM25 40%
    const baseScore = 0.60 * llmScore + 0.40 * bm25Score;
    const finalScore = baseScore * boostMultiplier;

    // Build reasoning string (no recency mentioned)
    const reasoning = [
      `LLM: relevance=${llmResult?.relevance.toFixed(1)}, usefulness=${llmResult?.usefulness.toFixed(1)}`,
      `BM25=${bm25Score.toFixed(2)}`,
      boostMultiplier > 1.0 ? `[BOOST] ${boostMultiplier}x (core domain terms)` : '',
      `Tags: ${llmResult?.tags.join(", ") || "none"}`,
      `[NO RECENCY]`,
    ].filter(Boolean).join(" | ");

    return {
      ...item,
      bm25Score,
      llmScore: {
        relevance: llmResult?.relevance ?? Math.round((bm25Score * 10)),
        usefulness: llmResult?.usefulness ?? Math.round((bm25Score * 10)),
        tags: [...(llmResult?.tags ?? []), ...boostTags],
      },
      recencyScore: 0, // Set to 0 since it's not used
      finalScore,
      reasoning,
      productMentions: detectedProductIds.length > 0 ? detectedProductIds : undefined,
    };
  });

  // Sort by final score
  rankedItems.sort((a, b) => b.finalScore - a.finalScore);

  // Filter out off-topic items
  const nonOffTopicItems = rankedItems.filter((item) => {
    const isOffTopic = item.llmScore.tags.includes("off-topic");
    if (isOffTopic) {
      logger.debug(`Filtering out off-topic item: ${item.title}`);
    }
    return !isOffTopic;
  });

  logger.info(
    `Ranked to ${nonOffTopicItems.length} valid items without recency (filtered ${rankedItems.length - nonOffTopicItems.length} off-topic items)`
  );

  return nonOffTopicItems;
}
