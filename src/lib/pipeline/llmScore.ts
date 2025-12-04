/**
 * LLM-based scoring pipeline
 * Uses Claude API to evaluate relevance and usefulness of items
 */

import { FeedItem, LLMScoreResult } from "../model";
import { logger } from "../logger";

/**
 * Score items using LLM
 * This is a placeholder that scores items based on category description
 * and heuristic term matching. In production, this would call Claude API.
 */
export async function scoreWithLLM(
  items: FeedItem[]
): Promise<Record<string, LLMScoreResult>> {
  const results: Record<string, LLMScoreResult> = {};

  // Domain keywords for scoring
  const keywordsByDomain: Record<string, string[]> = {
    "code search": [
      "code search",
      "semantic search",
      "cross-reference",
      "codebase",
      "navigation",
    ],
    agents: [
      "agent",
      "agentic",
      "tool use",
      "planning",
      "orchestration",
      "multi-step",
    ],
    "context management": [
      "context window",
      "token budget",
      "compression",
      "summarization",
      "RAG",
    ],
    "developer tools": [
      "IDE",
      "debugger",
      "refactoring",
      "productivity",
      "CI/CD",
      "testing",
    ],
    "enterprise codebases": [
      "monorepo",
      "enterprise",
      "large codebase",
      "scale",
      "dependency",
      "modularization",
    ],
    "ai/llm": [
      "LLM",
      "model",
      "transformer",
      "reasoning",
      "fine-tuning",
      "inference",
    ],
  };

  for (const item of items) {
    const text = `${item.title} ${item.summary || ""}`.toLowerCase();

    // Heuristic scoring based on keyword matches
    let relevanceScore = 5; // Base score
    let usefulnessScore = 5;
    const tags: string[] = [];

    // Check for domain keyword matches
    for (const [domain, keywords] of Object.entries(keywordsByDomain)) {
      const matchCount = keywords.filter((kw) => text.includes(kw)).length;
      if (matchCount > 0) {
        // Boost scores based on matches
        const boost = Math.min(matchCount * 0.5, 3); // Max +3 per domain
        relevanceScore = Math.min(10, relevanceScore + boost);
        usefulnessScore = Math.min(10, usefulnessScore + boost * 0.8);
        tags.push(domain);
      }
    }

    // Check for off-topic indicators
    const offTopicKeywords = [
      "marketing",
      "sales",
      "hr",
      "management",
      "sports",
      "politics",
    ];
    if (offTopicKeywords.some((kw) => text.includes(kw))) {
      // Check if it's truly off-topic (not just mentioned incidentally)
      const allKeywords = Object.values(keywordsByDomain).flat();
      if (!allKeywords.some((kw) => text.includes(kw))) {
        tags.push("off-topic");
        relevanceScore = Math.max(0, relevanceScore - 3);
      }
    }

    results[item.id] = {
      id: item.id,
      relevance: Math.round(relevanceScore * 10) / 10,
      usefulness: Math.round(usefulnessScore * 10) / 10,
      tags,
    };

    logger.debug(`LLM score for ${item.title}`, {
      relevance: results[item.id].relevance,
      usefulness: results[item.id].usefulness,
      tags,
    });
  }

  return results;
}

/**
 * Call Claude API for scoring (stub for production)
 * This is where you'd integrate with Claude API for more sophisticated evaluation
 */
export async function scoreWithClaudeAPI(
  items: FeedItem[]
): Promise<Record<string, LLMScoreResult>> {
  // TODO: Implement Claude API integration
  // For now, fall back to heuristic scoring
  logger.warn("Claude API not implemented, using heuristic scoring");
  return scoreWithLLM(items);
}

/**
 * Determine LLM score for an item (0-10 scale normalized)
 */
export function computeLLMScore(
  result: LLMScoreResult
): number {
  // Weighted combination of relevance and usefulness
  const raw = 0.7 * result.relevance + 0.3 * result.usefulness;
  return Math.min(10, Math.max(0, raw));
}
