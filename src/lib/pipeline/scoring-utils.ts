/**
 * Scoring utilities for the ranking pipeline
 *
 * This module contains shared scoring functions used across the ranking system
 * to ensure consistent calculation of scores like recency, boosts, etc.
 */

/**
 * Product names for coding assistants and AI-powered development tools.
 * These get a significant boost (3.0-4.0x) when matched in content.
 *
 * Products include:
 * - AI coding assistants (Claude Code, Cursor, Copilot, Cody)
 * - Autonomous coding agents (Aider, Augment Code, Codegen)
 * - IDE-integrated tools (Windsurf, Void, Trae, Roo)
 */
export const PRODUCT_NAMES = [
  'augment code',
  'claude code',
  'cursor',
  'copilot',
  'cody',
  'aider',
  'codegen',
  'windsurf',
  'void',
  'trae',
  'roo',
] as const;

/**
 * Core domain terms for code intelligence and developer productivity.
 * These receive moderate boosts (1.5-3.0x) based on match count.
 *
 * Categories:
 * - Code search/intelligence: deep search, code search, code intelligence
 * - AI agents: coding agent, codebase understanding
 * - Context handling: context management, context window
 * - Retrieval: information retrieval
 * - Development: software engineering, developer productivity, ai tooling
 * - Quality: benchmark, evaluation
 */
export const CORE_TERMS = [
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
] as const;

/**
 * Compute recency score with exponential decay.
 *
 * The formula uses exponential decay to favor fresh content while maintaining
 * a minimum floor score for older content.
 *
 * Formula: 0.2 + 0.8 * 2^(-ageDays / halfLifeDays)
 *
 * - At age=0: score = 1.0 (maximum freshness)
 * - At age=halfLifeDays: score ≈ 0.6 (half-way point)
 * - At age=∞: score approaches 0.2 (floor, never goes to zero)
 * - Future-dated (age<0): treated as age=0, so score is capped at 1.0
 *
 * @param publishedAt - The publication date of the content
 * @param halfLifeDays - The number of days until score decays to ~0.6
 * @returns A score between 0.2 and 1.0
 *
 * @example
 * // A fresh item (today) gets full score
 * computeRecencyScore(new Date(), 7) // => 1.0
 *
 * // An item from 7 days ago (with 7-day half-life) gets ~0.6
 * computeRecencyScore(new Date(Date.now() - 7 * 24 * 60 * 60 * 1000), 7) // => ~0.6
 */
export function computeRecencyScore(
  publishedAt: Date,
  halfLifeDays: number
): number {
  const ageMs = Date.now() - publishedAt.getTime();
  // Floor the age at 0 so a future-dated publishedAt (a common feed/RSS bug
  // where the source timestamp is ahead of now) is treated as maximally fresh
  // (score 1.0) rather than scoring ABOVE 1.0. Without this floor the exponent
  // goes positive, 2^positive > 1, and that unclamped value flows straight into
  // rank finalScore and agentRank goalScore (neither re-clamps recency), letting
  // mis-dated items out-rank genuinely fresh ones — a ranking inversion.
  const ageDays = Math.max(0, ageMs / (1000 * 60 * 60 * 24));

  // Exponential decay with floor: score ranges from 0.2 to 1.0
  // At age=0, score=1.0; at age=halfLife, score≈0.6; approaches 0.2 as age→∞
  return 0.2 + 0.8 * Math.pow(2, -ageDays / halfLifeDays);
}

/**
 * Result of boost multiplier calculation
 */
export interface BoostResult {
  /** The boost multiplier to apply to the final score */
  multiplier: number;
  /** Terms that matched and contributed to the boost */
  matchedTerms: string[];
}

/**
 * Compute boost multiplier based on content relevance to core domain terms.
 *
 * Boost tiers:
 * - 5.0x: Content contains "sourcegraph" (highest priority)
 * - 3.0-4.0x: Content matches a product name OR has 3+ core terms
 * - 2.0-2.5x: Content has 2 core terms OR agent + code context compound
 * - 1.5x: Content has 1 core term
 * - 1.0x: No relevant matches (baseline)
 *
 * @param content - The text content to search (title + summary + snippet)
 * @param category - The category being ranked (unused for now, but allows category-specific boosts in the future)
 * @returns BoostResult with multiplier and matched terms
 *
 * @example
 * // Sourcegraph content gets maximum boost
 * computeBoostMultiplier("Sourcegraph announces new code search", "tech_articles")
 * // => { multiplier: 5.0, matchedTerms: ["sourcegraph"] }
 *
 * @example
 * // Product name match
 * computeBoostMultiplier("How to use Cursor for coding", "tech_articles")
 * // => { multiplier: 3.5, matchedTerms: ["cursor"] }
 */
export function computeBoostMultiplier(
  content: string,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  category: string
): BoostResult {
  const contentLower = content.toLowerCase();
  const matchedTerms: string[] = [];

  // SOURCEGRAPH: Highest priority (5.0x)
  if (contentLower.includes('sourcegraph')) {
    return {
      multiplier: 5.0,
      matchedTerms: ['sourcegraph'],
    };
  }

  // Check for product name matches (3.5x)
  const matchedProducts = PRODUCT_NAMES.filter((product) =>
    contentLower.includes(product)
  );
  if (matchedProducts.length > 0) {
    return {
      multiplier: 3.5,
      matchedTerms: [...matchedProducts],
    };
  }

  // Count matching core terms
  const matchedCoreTerms = CORE_TERMS.filter((term) =>
    contentLower.includes(term)
  );
  const coreTermCount = matchedCoreTerms.length;
  matchedTerms.push(...matchedCoreTerms);

  // Check for compound terms (agent + code search/intelligence/context)
  const hasAgent =
    contentLower.includes('agent') ||
    contentLower.includes('agentic') ||
    contentLower.includes('coding agent');
  // Code context terms: code search, code intelligence, context management, context window
  const codeContextTerms = CORE_TERMS.slice(1, 8); // code search through context window
  const hasCodeContext = codeContextTerms.some((term) =>
    contentLower.includes(term)
  );

  if (coreTermCount >= 3) {
    // Multiple domain terms = strong signal (3.0x)
    return {
      multiplier: 3.0,
      matchedTerms,
    };
  } else if (coreTermCount === 2) {
    // Two core terms (2.0x)
    return {
      multiplier: 2.0,
      matchedTerms,
    };
  } else if (hasAgent && hasCodeContext) {
    // Agent + code context = sweet spot (2.5x)
    if (!matchedTerms.includes('agent')) {
      matchedTerms.push('agent');
    }
    return {
      multiplier: 2.5,
      matchedTerms,
    };
  } else if (coreTermCount === 1) {
    // Single core term (1.5x)
    return {
      multiplier: 1.5,
      matchedTerms,
    };
  }

  // No matches - baseline (1.0x)
  return {
    multiplier: 1.0,
    matchedTerms: [],
  };
}
