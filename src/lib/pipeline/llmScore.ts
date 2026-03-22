/**
 * LLM-based scoring pipeline using the configured quality model
 * Evaluates relevance and usefulness of items
 */

import { FeedItem, LLMScoreResult, Category } from "../model";
import { logger } from "../logger";
import { getCompetitorProducts } from "../../config/products";
import { createChatCompletion } from "../llm/completion";
import { getQualityModel, hasLLMConfigured } from "../llm/config";
import type { AgentGoal } from "../../config/agents";
import { getAgentGoalConfig } from "../../config/agents";

/**
 * Get category-specific system prompt to evaluate item relevance.
 * When goal is provided, adds guidance so usefulness is evaluated for that agent goal.
 */
function getSystemPrompt(category: Category, goal?: AgentGoal): string {
  const baseTags = [
    "code-search",
    "semantic-search",
    "agent",
    "context",
    "devex",
    "devops",
    "enterprise",
    "research",
    "infra",
    "off-topic",
  ];

  let basePrompt: string;
  switch (category) {
    case "newsletters":
    case "podcasts":
    case "tech_articles":
      basePrompt = `You are an expert evaluator of technical content for a "Code Intelligence Digest" service.

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
      break;
    case "ai_news":
      basePrompt = `You are an expert evaluator of AI news for a "Code Intelligence Digest" service.

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
      break;
    case "ai_dev":
      basePrompt = `You are an expert evaluator of AI-in-developer-workflow content for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): Focus on incorporating AI into developer workflows: tips, best practices, coding assistant usage (Cursor, Copilot, etc.), AI pair programming, prompt engineering for code, RAG for codebases, AI in devops/automation, developer productivity with AI. Include content from TLDR, newsletters, tech blogs, and community that helps developers use AI effectively.
2. **Usefulness** (0-10): How useful/valuable is this for a senior developer or tech lead wanting to integrate AI into their daily workflow?
3. **Tags**: Assign relevant domain tags from: ${baseTags.join(", ")}

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains domain keywords like "code". Without actual content to evaluate, you cannot determine true relevance.`;
      break;
    case "product_news": {
      const competitorNames = getCompetitorProducts()
        .map((p) => p.name)
        .slice(0, 25)
        .join(", ");
      basePrompt = `You are an expert evaluator of product news for a "Code Intelligence Digest" service.

Evaluate each item for:
1. **Relevance** (0-10): Focus on updates from coding agent products and competitors including: ${competitorNames}. Also relevant: any products that add codebase context to coding agents, code search tools, or AI coding assistants.
2. **Usefulness** (0-10): How useful/valuable is this for a senior developer or tech lead tracking coding agent tools and the competitive landscape?
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
      break;
    case "community":
      basePrompt = `You are an expert evaluator of community discussions for a "Code Intelligence Digest" service.

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
      break;
    case "research":
      basePrompt = `You are an expert evaluator of research papers for a "Code Intelligence Digest" service.

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
      break;
    case "marketing":
      basePrompt = `You are an expert evaluator of marketing content for a technology company targeting developers and technical leaders as its ideal customer profile (ICP).

Evaluate each item for:
1. **Relevance** (0-10): How relevant is this to marketing strategies for reaching developers, engineering leaders, and technical decision-makers?
   - 8-10: B2B developer marketing strategies, developer-as-buyer targeting, developer relations/advocacy, AI-powered marketing tools and approaches, pipeline/demand generation tactics, technical content marketing, developer experience as growth lever
   - 5-7: General B2B marketing strategy applicable to tech, brand positioning for technical audiences, SEO/SEM for developer products, pricing strategy, product-led growth
   - 1-4: Consumer marketing with no tech applicability, irrelevant verticals, generic social media tactics not applicable to developer audiences
2. **Usefulness** (0-10): How actionable are the insights for a marketing team at a developer tools company?
   - 8-10: Specific tactics, frameworks, or data-backed strategies directly applicable to developer marketing and pipeline generation
   - 5-7: General strategic insights that could be adapted for developer/technical audiences
   - 1-4: Too generic, too high-level, or not actionable for a dev tools marketing team
3. **Tags**: Assign relevant domain tags from: developer-marketing, devrel, content-marketing, demand-gen, pipeline, AI-marketing, product-led-growth, brand, SEO, pricing, go-to-market, developer-experience, thought-leadership, B2B-SaaS, off-topic

Return JSON with exactly this structure:
{
  "relevance": <number 0-10>,
  "usefulness": <number 0-10>,
  "tags": ["tag1", "tag2", ...]
}

Be objective. A score of 5-6 is average/neutral. 7+ is good/relevant. 8+ is very relevant. 9-10 is essential. Below 5 is weak relevance.

CRITICAL: Items with minimal content (only a title, no summary or content) should be scored VERY conservatively (3-5). Do not assume high relevance just because a title contains marketing keywords. Without actual content to evaluate, you cannot determine true relevance.`;
      break;
    default:
      basePrompt = `You are an expert evaluator of technical content for a "Code Intelligence Digest" service.

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
      break;
  }

  // Append agent goal context when scoring for a specific agent
  let prompt = basePrompt;
  if (goal) {
    const goalConfig = getAgentGoalConfig(goal);
    prompt += `\n\nAGENT GOAL CONTEXT: This scoring may be used for the "${goalConfig.name}" agent. When assigning usefulness, consider whether this item is particularly valuable for: ${goalConfig.description} Target audience: ${goalConfig.icpDescription}. An item can be highly relevant for one agent goal (e.g. competitor intel) and less so for another (e.g. content ideas)—score usefulness for the current goal.`;
  }
  return prompt;
}

/**
 * Create evaluation prompt for a batch of items
 * Includes contentSnippet and fullText when available for better context
 */
function createBatchPrompt(items: FeedItem[], category: Category): string {
  const itemTexts = items
    .map((item, idx) => {
      // Truncate summary/content to avoid token overflow (newsletter HTML can be 100k+ chars)
      const summaryText = item.summary || "N/A";
      const summaryTruncated = summaryText.length > 1500 ? summaryText.substring(0, 1500) + "..." : summaryText;

      const parts = [
        `[${idx}] Title: ${item.title}`,
        `Source: ${item.sourceTitle}`,
        `Summary: ${summaryTruncated}`,
      ];

      // Include content snippet if available (truncate to 500 chars)
      if (item.contentSnippet && item.contentSnippet.length > 50) {
        parts.push(`Content: ${item.contentSnippet.substring(0, 500)}`);
      }

      // For research papers, include full text if available
      if (
        category === "research" &&
        item.fullText &&
        item.fullText.length > 100
      ) {
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
      const hasRealContent =
        (item.summary && item.summary.length > item.title.length + 20) ||
        (item.contentSnippet &&
          item.contentSnippet.length > item.title.length + 20) ||
        (item.fullText && item.fullText.length > 100);

      if (!hasRealContent) {
        parts.push(
          `⚠️ WARNING: This item has minimal or no content beyond the title. Be very conservative with scores - if you cannot determine relevance from the title alone, score it low (3-5).`,
        );
      }

      parts.push(`URL: ${item.url}`);
      return parts.join("\n");
    })
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
  items: FeedItem[],
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
        `LLM returned ${actualCount} results for ${expectedCount} items. Using available results and assigning neutral scores to missing items.`,
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
        logger.debug(
          `No LLM score for item ${i + 1}/${items.length}: "${item.title}". Using neutral scores.`,
        );
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
      logger.warn(
        `LLM returned ${actualCount - expectedCount} extra results (ignored)`,
      );
    }

    return results;
  } catch (error) {
    logger.error("Failed to parse GPT response", {
      error,
      response: response.substring(0, 500),
    });
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
      {} as Record<string, LLMScoreResult>,
    );
  }
}

/**
 * Score a batch of items using the configured quality model.
 */
async function scoreItemsBatch(
  items: FeedItem[],
  category: Category,
  goal?: AgentGoal
): Promise<Record<string, LLMScoreResult>> {
  if (items.length === 0) {
    return {};
  }

  try {
    const systemPrompt = getSystemPrompt(category, goal);
    const prompt = createBatchPrompt(items, category);
    const configuredModel = getQualityModel();

    logger.info(
      `Scoring ${items.length} items with configured quality model for category ${category}`,
      {
        batchSize: items.length,
        category,
        configuredModel,
      },
    );

    if (!hasLLMConfigured()) {
      return items.reduce(
        (acc, item) => {
          acc[item.id] = { id: item.id, relevance: 5, usefulness: 5, tags: [] };
          return acc;
        },
        {} as Record<string, LLMScoreResult>,
      );
    }

    const result = await createChatCompletion({
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ],
      max_tokens: 4000,
    });

    const responseText = result.content || "";

    logger.info(`LLM responded for batch of ${items.length}`, {
      itemCount: items.length,
      configuredModel,
      actualModel: result.model,
    });

    return parseGPTResponse(responseText, items);
  } catch (error) {
    logger.error("LLM scoring API error", { error, itemCount: items.length });

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
      {} as Record<string, LLMScoreResult>,
    );
  }
}

/**
 * Score items using the configured quality model with batching for efficiency.
 * Batches items to stay under token limits.
 * @param items Items to score
 * @param category Category for category-specific relevance evaluation
 * @param batchSize Number of items per batch
 * @param goal Optional agent goal for goal-aware usefulness scoring
 */
export async function scoreWithLLM(
  items: FeedItem[],
  category: Category,
  batchSize: number = 30,
  goal?: AgentGoal
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
      `Scoring batch ${Math.floor(i / batchSize) + 1} of ${Math.ceil(items.length / batchSize)} for category ${category}`,
    );

    const batchResults = await scoreItemsBatch(batch, category, goal);
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
  items: FeedItem[],
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
      const matchCount = config.keywords.filter((kw) =>
        text.includes(kw),
      ).length;
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
      config.keywords.some((kw) => text.includes(kw)),
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
