/**
 * Digest generation pipeline
 * Extracts themes, generates summaries, and highlights for digest pages
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

/**
 * Extract common themes from items
 */
export function extractThemes(items: RankedItem[]): Map<string, number> {
  const themes = new Map<string, number>();

  // Domain term weights (from AGENTS.md)
  const domainTerms: Record<string, number> = {
    "code search": 1.6,
    "semantic search": 1.5,
    agents: 1.4,
    "context management": 1.5,
    embeddings: 1.5,
    devtools: 1.2,
    "code review": 1.0,
    testing: 1.0,
    refactoring: 1.0,
    monorepo: 1.3,
    llm: 1.2,
    ai: 1.2,
    infrastructure: 1.0,
    "information retrieval": 1.5,
    rag: 1.5,
    "vector database": 1.5,
    "agentic workflows": 1.4,
    "fine-tuning": 1.2,
    "function calling": 1.2,
    "enterprise codebase": 1.3,
  };

  // Count theme occurrences with weights
  for (const item of items) {
    const text = `${item.title} ${item.summary || ""}`.toLowerCase();

    for (const [term, weight] of Object.entries(domainTerms)) {
      if (text.includes(term)) {
        themes.set(term, (themes.get(term) || 0) + weight);
      }
    }

    // Also count from LLM tags
    for (const tag of item.llmScore.tags) {
      themes.set(tag, (themes.get(tag) || 0) + 1);
    }
  }

  return themes;
}

/**
 * Get top N themes from a map of themes and their scores
 */
export function getTopThemes(
  themeMap: Map<string, number>,
  count: number = 10
): string[] {
  return Array.from(themeMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, count)
    .map(([theme]) => theme);
}

/**
 * Generate digest summary using Claude
 */
export async function generateDigestSummary(
  themes: string[],
  itemCount: number,
  periodLabel: string
): Promise<string> {
  try {
    logger.info(`Generating digest summary for ${periodLabel} period with ${itemCount} items`);

    // Use template if no API key
    const client = getClient();
    if (!client) {
      logger.info("OPENAI_API_KEY not set, using template summary");
      return generateTemplateSummary(themes, itemCount, periodLabel);
    }

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 500,
      messages: [
        {
          role: "user",
          content: `Write a 150-200 word executive summary of this week's code intelligence digest. 

Period: ${periodLabel}
Total Items: ${itemCount}
Key Themes: ${themes.slice(0, 8).join(", ")}

Guidelines:
- Focus on trends and actionable insights for senior engineers
- Mention 2-3 key themes from the list
- Highlight what's new or emerging
- Be concise and professional
- No need to cite sources (this is a summary)`,
        },
      ],
    });

    return response.choices[0].message.content || "Failed to generate summary";
  } catch (error) {
    logger.warn("Failed to generate digest summary with LLM, falling back to template", { error });
    // Fallback to template if LLM fails
    return generateTemplateSummary(themes, itemCount, periodLabel);
  }
}

/**
 * Generate a template-based summary when LLM is unavailable
 */
function generateTemplateSummary(themes: string[], itemCount: number, periodLabel: string): string {
  return `This ${periodLabel}'s code intelligence digest covers ${itemCount} items focused on key themes including ${themes.slice(0, 3).join(", ")}. The community continues to prioritize developer productivity, advanced context management, and agentic workflow patterns. Review the highlights below for the most impactful insights.`;
}
