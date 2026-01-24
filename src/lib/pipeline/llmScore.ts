/**
 * LLM-based scoring pipeline using OpenAI GPT-4o
 * Evaluates relevance and usefulness of items
 */

import { FeedItem, LLMScoreResult, Category } from "../model";
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
 * Get category-specific system prompt for GPT-4o to evaluate item relevance
 */
function getSystemPrompt(category: Category): string {
  const baseTags = [
    "code-search", "semantic-search", "agent", "context", "devex", "devops",
    "enterprise", "research", "infra", "off-topic"
  ];

  switch (category) {
    case "newsletters":
    case "podcasts":
    case "tech_articles":
      return `You are an expert evaluator of technical content for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): Focus on: code search, coding agent capabilities, developer productivity with AI tools, context management for agents, information retrieval for agents, information retrieval in codebases.
2. **Usefulness** (0-10): How useful/valuable is this for a senior developer or tech lead working with AI coding tools?
3. **Tags**: Assign relevant domain tags from: ${baseTags.join(", ")}

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains domain keywords like "code". Without actual content to evaluate, you cannot determine true relevance.`;

    case "ai_news":
      return `You are an expert evaluator of AI news for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): Focus on the biggest general updates in AI including: acquisitions, new model releases, breakthroughs, and summarized updates from various sources. Be more lenient - include significant AI developments even if not directly coding-related.
2. **Usefulness** (0-10): How useful/valuable is this for a senior developer or tech lead tracking AI developments?
3. **Tags**: Assign relevant domain tags from: ${baseTags.join(", ")}

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains domain keywords like "code". Without actual content to evaluate, you cannot determine true relevance.`;

    case "product_news":
      return `You are an expert evaluator of product news for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): Focus on updates from competitors or potential partners: Augment Code, Windsurf, Cursor, Claude Code, Codex CLI, Gemini CLI/Antigravity, and any other products that add codebase context to coding agents.
2. **Usefulness** (0-10): How useful/valuable is this for a senior developer or tech lead tracking coding agent tools?
3. **Tags**: Assign relevant domain tags from: ${baseTags.join(", ")}

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains domain keywords like "code". Without actual content to evaluate, you cannot determine true relevance.`;

    case "community":
      return `You are an expert evaluator of community discussions for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): Focus on discussions around: coding agents, AI in developer workflows (track sentiment around how developers view utility of these tools), code search, and Sourcegraph.
2. **Usefulness** (0-10): How useful/valuable is this for understanding developer sentiment and community discussions?
3. **Tags**: Assign relevant domain tags from: ${baseTags.join(", ")}

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains domain keywords like "code". Without actual content to evaluate, you cannot determine true relevance.`;

    case "research":
      return `You are an expert evaluator of research papers for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): Focus on papers about: coding agents, coding agent benchmarks, information retrieval in codebases, information retrieval in developer workflows. Match keywords like "coding agent", "code search", "context" with "agents", etc.
2. **Usefulness** (0-10): How useful/valuable is this research for understanding coding agents and code intelligence?
3. **Tags**: Assign relevant domain tags from: ${baseTags.join(", ")}

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains domain keywords like "code". Without actual content to evaluate, you cannot determine true relevance.`;

    default:
      return `You are an expert evaluator of technical content for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): How relevant is it to: code tooling, code search, semantic search, agents, developer productivity, context management for LLMs, and complex enterprise codebases?
2. **Usefulness** (0-10): How useful/valuable is this for a senior developer or tech lead?
3. **Tags**: Assign relevant domain tags from: ${baseTags.join(", ")}

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains domain keywords like "code". Without actual content to evaluate, you cannot determine true relevance.`;
  }
}

/**
 * Create evaluation prompt for a batch of items
 * Includes contentSnippet and fullText when available for better context
 */
function createBatchPrompt(items: FeedItem[], category: Category): string {
  const itemTexts = items
    .map(
      (item, idx) => {
        const parts = [
          `[${idx}] Title: ${item.title}`,
          `Source: ${item.sourceTitle}`,
          `Summary: ${item.summary || "N/A"}`,
        ];

        // Include content snippet if available
        if (item.contentSnippet && item.contentSnippet.length > 50) {
          parts.push(`Content: ${item.contentSnippet.substring(0, 500)}`);
        }

        // For research papers, include full text if available
        if (category === "research" && item.fullText && item.fullText.length > 100) {
          // Include abstract and first part of full text
          const abstract = item.summary || "";
          const fullTextPreview = item.fullText.substring(0, 2000);
          parts.push(`Abstract: ${abstract}`);
          parts.push(`Full Text (preview): ${fullTextPreview}`);
        } else if (item.fullText && item.fullText.length > 100) {
          // For other categories, include full text preview if available
          parts.push(`Full Text (preview): ${item.fullText.substring(0, 1000)}`);
        }

        // Check if content is insufficient (only title, no real content)
        const hasRealContent = (item.summary && item.summary.length > item.title.length + 20) ||
                               (item.contentSnippet && item.contentSnippet.length > item.title.length + 20) ||
                               (item.fullText && item.fullText.length > 100);

        if (!hasRealContent) {
          parts.push(`⚠️ WARNING: This item has minimal or no content beyond the title. Be very conservative with scores - if you cannot determine relevance from the title alone, score it low (3-5).`);
        }

        parts.push(`URL: ${item.url}`);
        return parts.join("\n");
      }
    )
    .join("\n\n---\n\n");

  return `Evaluate each item below. Return a JSON array with scores and tags for each item in order.

IMPORTANT: Items with minimal content (only title, no summary/content) should be scored conservatively. If you cannot determine true relevance from the title alone, assign low scores (3-5). Do not assume high relevance just because a title contains domain keywords.

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

    if (!Array.isArray(parsed)) {
      throw new Error("Response is not a JSON array");
    }

    // Handle mismatched array lengths gracefully
    // LLM might return fewer or more results than requested
    const expectedCount = items.length;
    const actualCount = parsed.length;

    if (actualCount !== expectedCount) {
      logger.warn(
        `LLM returned ${actualCount} results for ${expectedCount} items. Using available results and assigning neutral scores to missing items.`
      );
    }

    // Map results back to item IDs
    for (let i = 0; i < items.length; i++) {
      const item = items[i];

      // Use result if available, otherwise use neutral scores
      if (i < parsed.length) {
        const score = parsed[i];
        results[item.id] = {
          id: item.id,
          relevance: Math.min(10, Math.max(0, score.relevance || 5)),
          usefulness: Math.min(10, Math.max(0, score.usefulness || 5)),
          tags: Array.isArray(score.tags) ? score.tags : [],
        };
      } else {
        // Missing result - assign neutral scores
        logger.debug(`No LLM score for item ${i + 1}/${items.length}: "${item.title}". Using neutral scores.`);
        results[item.id] = {
          id: item.id,
          relevance: 5,
          usefulness: 5,
          tags: [],
        };
      }
    }

    // If LLM returned extra results, log but ignore them
    if (actualCount > expectedCount) {
      logger.warn(`LLM returned ${actualCount - expectedCount} extra results (ignored)`);
    }

    return results;
  } catch (error) {
    logger.error("Failed to parse GPT response", { error, response: response.substring(0, 500) });
    // Fallback: return neutral scores for all items
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
async function scoreItemsBatch(items: FeedItem[], category: Category): Promise<Record<string, LLMScoreResult>> {
  if (items.length === 0) {
    return {};
  }

  try {
    const systemPrompt = getSystemPrompt(category);
    const prompt = createBatchPrompt(items, category);

    logger.info(`Scoring ${items.length} items with GPT-4o for category ${category}`, {
      batchSize: items.length,
      category,
    });

    const response = await getOpenAIClient().chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 4000,
      messages: [
        {
          role: "system",
          content: systemPrompt,
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
 * @param items Items to score
 * @param category Category for category-specific relevance evaluation
 * @param batchSize Number of items per batch
 */
export async function scoreWithLLM(
  items: FeedItem[],
  category: Category,
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
      `Scoring batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(items.length / batchSize)} for category ${category}`
    );

    const batchResults = await scoreItemsBatch(batch, category);
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
