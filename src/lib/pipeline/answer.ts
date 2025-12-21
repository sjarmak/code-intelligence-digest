/**
 * Answer generation pipeline
 * Uses Claude to synthesize answers from retrieved items
 */

import OpenAI from "openai";
import { RankedItem } from "../model";
import { logger } from "../logger";

/**
 * Lazy-load OpenAI client (only when API key is available)
 */
function getClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
}

export interface GeneratedAnswer {
  question: string;
  answer: string;
  sources: Array<{
    id: string;
    title: string;
    url: string;
    relevance: number;
  }>;
  reasoning: string;
  generatedAt: string;
}

/**
 * Generate an answer to a question based on retrieved items
 * Uses Claude 3.5 Haiku to synthesize a coherent, insightful response
 */
export async function generateAnswer(
  question: string,
  retrievedItems: RankedItem[]
): Promise<GeneratedAnswer> {
  try {
    logger.info(`Generating answer for question: "${question}" using ${retrievedItems.length} items`);

    if (retrievedItems.length === 0) {
      return {
        question,
        answer: "I found no relevant items to answer this question. Please try a different query.",
        sources: [],
        reasoning: "No items retrieved for the question",
        generatedAt: new Date().toISOString(),
      };
    }

    // Prepare source context for LLM
    const topItems = retrievedItems.slice(0, 5);
    const sourceContext = topItems
      .map(
        (item, idx) =>
          `[${idx + 1}] ${item.title} (${item.sourceTitle}, relevance: ${(item.finalScore * 100).toFixed(0)}%)\n${item.summary || item.contentSnippet || "No summary available"}`
      )
      .join("\n\n");

    let answer: string;

    // Call Claude to generate answer if API key is available
    const client = getClient();
    if (client) {
      try {
        const response = await client.chat.completions.create({
          model: "gpt-4o-mini",
          max_completion_tokens: 800,
          messages: [
            {
              role: "user",
              content: `Based on the following sources about code intelligence, devtools, and AI agents, provide a concise, insightful answer to this question:

Question: "${question}"

Sources:
${sourceContext}

Guidelines:
- Synthesize information from multiple sources where relevant
- Be specific and cite the sources by number (e.g., "As discussed in [1]")
- Focus on actionable insights for senior engineers and tech leads
- Keep the answer to 200-300 words
- Highlight any disagreements or varying perspectives between sources`,
            },
          ],
        });

        answer = response.choices[0].message.content || "Failed to generate answer";
      } catch (error) {
        logger.warn("Claude API call failed, falling back to template synthesis", { error });
        answer = generateTemplateSynthesis(topItems);
      }
    } else {
      logger.warn("OPENAI_API_KEY not set, using template synthesis");
      answer = generateTemplateSynthesis(topItems);
    }

    // Extract sources
    const sources = topItems.map((item) => ({
      id: item.id,
      title: item.title,
      url: item.url,
      relevance: Math.min(item.finalScore, 1.0),
    }));

    const reasoning = `Retrieved ${retrievedItems.length} items, used top ${topItems.length} for synthesis. Common themes: ${extractCommonThemes(topItems).join(", ")}. Generated with Claude 3.5 Haiku.`;

    return {
      question,
      answer,
      sources,
      reasoning,
      generatedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error(`Failed to generate answer for question: "${question}"`, { error });
    throw error;
  }
}

/**
 * Generate a template-based synthesis when LLM is unavailable
 */
function generateTemplateSynthesis(items: RankedItem[]): string {
  const themes = extractCommonThemes(items);
  const keyPoints = items
    .map(
      (item) =>
        `- ${item.title} from ${item.sourceTitle}: ${item.summary || item.contentSnippet || "No details"}`
    )
    .join("\n");

  return `Based on recent content about code intelligence, here are the key insights:

${keyPoints}

These items discuss aspects of ${themes.join(", ")}. For more details, please review the sources below.`;
}

/**
 * Extract common themes from items
 */
function extractCommonThemes(items: RankedItem[]): string[] {
  const themeFreq = new Map<string, number>();

  // Common domain terms
  const domainTerms = [
    "code search",
    "semantic search",
    "agents",
    "context management",
    "embeddings",
    "devtools",
    "code review",
    "testing",
    "refactoring",
    "monorepo",
    "llm",
    "ai",
    "infrastructure",
  ];

  // Count theme occurrences
  for (const item of items) {
    const text = `${item.title} ${item.summary || ""}`.toLowerCase();
    for (const term of domainTerms) {
      if (text.includes(term)) {
        themeFreq.set(term, (themeFreq.get(term) || 0) + 1);
      }
    }

    // Also count from LLM tags
    for (const tag of item.llmScore.tags) {
      themeFreq.set(tag, (themeFreq.get(tag) || 0) + 1);
    }
  }

  // Return top 3 themes
  return Array.from(themeFreq.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 3)
    .map(([theme]) => theme);
}
