/**
 * LLM-based scoring pipeline using OpenAI GPT-4o
 * Evaluates relevance and usefulness of items
 */

import { FeedItem, LLMScoreResult } from "../model";
import { logger } from "../logger";
import OpenAI from "openai";

/**
 * Lazy-initialized OpenAI client
 */
let client: OpenAI | null = null;

function getOpenAIClient(): OpenAI {
  if (!client) {
    client = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }
  return client;
}

/**
 * System prompt for GPT-4o to evaluate item relevance
 */
const SYSTEM_PROMPT = `You are an expert evaluator of technical content for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): How relevant is it to: code tooling, code search, semantic search, agents, developer productivity, context management for LLMs, and complex enterprise codebases?
2. **Usefulness** (0-10): How useful/valuable is this for a senior developer or tech lead?
3. **Tags**: Assign relevant domain tags from this list:
   - "code-search" (code indexing, navigation, cross-references)
   - "semantic-search" (embeddings, RAG, vector search)
   - "agent" (agentic workflows, tool use, orchestration)
   - "context" (context windows, token budgets, compression)
   - "devex" (developer experience, tools, IDEs)
   - "devops" (CI/CD, testing, deployment)
   - "enterprise" (monorepos, scale, modularization)
   - "research" (academic papers, empirical studies)
   - "infra" (infrastructure, LLM infrastructure)
   - "off-topic" (if genuinely off-topic for our audience)

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.`;

/**
 * Create evaluation prompt for a batch of items
 */
function createBatchPrompt(items: FeedItem[]): string {
  const itemTexts = items
    .map(
      (item, idx) =>
        `[${idx}] Title: ${item.title}
Source: ${item.sourceTitle}
Summary: ${item.summary || "N/A"}
URL: ${item.url}`
    )
    .join("\n\n---\n\n");

  return `Evaluate each item below. Return a JSON array with scores and tags for each item in order.

${itemTexts}

Return JSON array like: [{"relevance": 8, "usefulness": 7, "tags": ["code-search"]}, ...]`;
}

/**
 * Parse LLM response into structured results
 */
function parseGPTResponse(
  response: string,
  items: FeedItem[]
): Record<string, LLMScoreResult> {
  const results: Record<string, LLMScoreResult> = {};

  try {
    // Try to extract JSON from response (GPT might wrap it in markdown)
    const jsonMatch = response.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      throw new Error("No JSON array found in response");
    }

    const parsed = JSON.parse(jsonMatch[0]) as Array<{
      relevance: number;
      usefulness: number;
      tags: string[];
    }>;

    if (!Array.isArray(parsed) || parsed.length !== items.length) {
      throw new Error(
        `Expected ${items.length} results, got ${parsed.length}`
      );
    }

    // Map results back to item IDs
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      const score = parsed[i];

      results[item.id] = {
        id: item.id,
        relevance: Math.min(10, Math.max(0, score.relevance || 5)),
        usefulness: Math.min(10, Math.max(0, score.usefulness || 5)),
        tags: Array.isArray(score.tags) ? score.tags : [],
      };
    }

    return results;
  } catch (error) {
    logger.error("Failed to parse GPT response", { error, response });
    // Fallback: return neutral scores
    return items.reduce(
      (acc, item) => {
        acc[item.id] = {
          id: item.id,
          relevance: 5,
          usefulness: 5,
          tags: [],
        };
        return acc;
      },
      {} as Record<string, LLMScoreResult>
    );
  }
}

/**
 * Score a batch of items using OpenAI GPT-4o
 */
async function scoreItemsBatch(items: FeedItem[]): Promise<Record<string, LLMScoreResult>> {
  if (items.length === 0) {
    return {};
  }

  try {
    const prompt = createBatchPrompt(items);

    logger.info(`Scoring ${items.length} items with GPT-4o`, {
      batchSize: items.length,
    });

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o",
      max_completion_tokens: 4000,
      messages: [
        {
          role: "system",
          content: SYSTEM_PROMPT,
        },
        {
          role: "user",
          content: prompt,
        },
      ],
    });

    const responseText = response.choices[0].message.content || "";

    logger.info(`GPT-4o responded for batch of ${items.length}`, {
      usage: response.usage,
    });

    return parseGPTResponse(responseText, items);
  } catch (error) {
    logger.error("GPT-4o API error", { error, itemCount: items.length });

    // Fallback: return neutral scores
    return items.reduce(
      (acc, item) => {
        acc[item.id] = {
          id: item.id,
          relevance: 5,
          usefulness: 5,
          tags: [],
        };
        return acc;
      },
      {} as Record<string, LLMScoreResult>
    );
  }
}

/**
 * Score items using GPT-4o with batching for efficiency
 * Batches items to stay under token limits
 */
export async function scoreWithLLM(
  items: FeedItem[],
  batchSize: number = 30
): Promise<Record<string, LLMScoreResult>> {
  const results: Record<string, LLMScoreResult> = {};

  // Check if API key is configured
  if (!process.env.OPENAI_API_KEY) {
    logger.warn("OPENAI_API_KEY not set, using fallback heuristic scoring");
    return scoreWithHeuristics(items);
  }

  // Process items in batches
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    logger.info(
      `Scoring batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(items.length / batchSize)}`
    );

    const batchResults = await scoreItemsBatch(batch);
    Object.assign(results, batchResults);

    // Small delay between batches to avoid rate limits
    if (i + batchSize < items.length) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  return results;
}

/**
 * Fallback heuristic scoring when API is not available
 * Based on domain keyword matching
 */
export function scoreWithHeuristics(
  items: FeedItem[]
): Record<string, LLMScoreResult> {
  const results: Record<string, LLMScoreResult> = {};

  const keywordsByDomain: Record<string, { keywords: string[]; tag: string }> =
    {
      "code search": {
        keywords: [
          "code search",
          "semantic search",
          "cross-reference",
          "codebase",
          "navigation",
          "indexing",
        ],
        tag: "code-search",
      },
      "semantic search": {
        keywords: [
          "semantic search",
          "embeddings",
          "rag",
          "vector",
          "retrieval",
        ],
        tag: "semantic-search",
      },
      agents: {
        keywords: [
          "agent",
          "agentic",
          "tool use",
          "planning",
          "orchestration",
          "multi-step",
        ],
        tag: "agent",
      },
      context: {
        keywords: [
          "context window",
          "token budget",
          "context length",
          "compression",
          "summarization",
        ],
        tag: "context",
      },
      devtools: {
        keywords: [
          "ide",
          "debugger",
          "refactoring",
          "productivity",
          "vscode",
          "intellij",
        ],
        tag: "devex",
      },
      devops: {
        keywords: [
          "ci/cd",
          "testing",
          "deployment",
          "pipeline",
          "github actions",
          "test",
        ],
        tag: "devops",
      },
      enterprise: {
        keywords: [
          "monorepo",
          "enterprise",
          "large codebase",
          "scale",
          "dependency",
          "modularization",
        ],
        tag: "enterprise",
      },
      research: {
        keywords: [
          "paper",
          "arxiv",
          "research",
          "study",
          "empirical",
          "academic",
        ],
        tag: "research",
      },
    };

  for (const item of items) {
    const text = `${item.title} ${item.summary || ""}`.toLowerCase();

    let relevanceScore = 5;
    let usefulnessScore = 5;
    const tags: string[] = [];

    // Check domain matches
    for (const [, config] of Object.entries(keywordsByDomain)) {
      const matchCount = config.keywords.filter((kw) => text.includes(kw))
        .length;
      if (matchCount > 0) {
        const boost = Math.min(matchCount * 0.5, 2);
        relevanceScore = Math.min(10, relevanceScore + boost);
        usefulnessScore = Math.min(10, usefulnessScore + boost * 0.8);
        tags.push(config.tag);
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
    const hasOffTopic = offTopicKeywords.some((kw) => text.includes(kw));
    const hasOnTopic = Object.values(keywordsByDomain).some((config) =>
      config.keywords.some((kw) => text.includes(kw))
    );

    if (hasOffTopic && !hasOnTopic) {
      tags.push("off-topic");
      relevanceScore = Math.max(0, relevanceScore - 3);
    }

    results[item.id] = {
      id: item.id,
      relevance: Math.round(relevanceScore * 10) / 10,
      usefulness: Math.round(usefulnessScore * 10) / 10,
      tags,
    };
  }

  return results;
}

/**
 * Determine LLM score for an item (0-10 scale normalized)
 */
export function computeLLMScore(result: LLMScoreResult): number {
  const raw = 0.7 * result.relevance + 0.3 * result.usefulness;
  return Math.min(10, Math.max(0, raw));
}
