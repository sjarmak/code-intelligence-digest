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
  const ageDays = ageMs / (1000 * 60 * 60 * 24);

  // Exponential decay with floor: score ranges from 0.2 to 1.0
  // At age=0, score=1.0; at age=halfLife, score≈0.6; approaches 0.2 as age→∞
  return 0.2 + 0.8 * Math.pow(2, -ageDays / halfLifeDays);
}
