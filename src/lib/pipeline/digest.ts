/**
 * Digest generation pipeline
 * Extracts themes, generates summaries, and highlights for digest pages
 */

import OpenAI from "openai";
import { RankedItem } from "../model";
import { logger } from "../logger";
import { getOpenAICompatibleClient, type LLMClientOptions } from "../llm/client";

/**
 * Extract common themes from items, respecting user prompt focus topics
 */
export function extractThemes(items: RankedItem[], userPromptTopics?: string[]): Map<string, number> {
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

  // If user prompt topics provided, boost their weights significantly
  // This ensures extracted themes reflect user's explicit guidance
  if (userPromptTopics && userPromptTopics.length > 0) {
    const lowerPromptTopics = userPromptTopics.map(t => t.toLowerCase());
    for (const [theme, score] of themes.entries()) {
      const themeLower = theme.toLowerCase();
      // Check if theme matches any user prompt topic (substring match for robustness)
      const isPromptTopic = lowerPromptTopics.some(
        topic => themeLower.includes(topic) || topic.includes(themeLower)
      );
      if (isPromptTopic) {
        // Boost by 2.5x to prioritize user-specified themes
        themes.set(theme, score * 2.5);
      }
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
 * @param dateRangeLabel - Optional human-readable period (e.g. "Feb 10–17, 2025") so the model uses the actual date instead of inventing one
 */
export async function generateDigestSummary(
  themes: string[],
  itemCount: number,
  periodLabel: string,
  llmOptions?: LLMClientOptions,
  dateRangeLabel?: string
): Promise<string> {
  try {
    logger.info(`Generating digest summary for ${periodLabel} period with ${itemCount} items`);

    // Use template if no API key
    const client = getOpenAICompatibleClient(llmOptions);
    if (!client) {
      logger.info("OPENAI_API_KEY not set, using template summary");
      return generateTemplateSummary(themes, itemCount, periodLabel, dateRangeLabel);
    }

    const periodLine = dateRangeLabel
      ? `Period: ${periodLabel} (${dateRangeLabel})`
      : `Period: ${periodLabel}`;
    const instruction = dateRangeLabel
      ? `Write a 150-200 word executive summary of the code intelligence digest for ${dateRangeLabel}. Use this exact period in your summary; do not substitute another date.`
      : `Write a 150-200 word executive summary of this ${periodLabel.toLowerCase()} code intelligence digest.`;

    const response = await client.chat.completions.create({
      model: "gpt-4o-mini",
      max_completion_tokens: 500,
      messages: [
        {
          role: "user",
          content: `${instruction}

${periodLine}
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
    return generateTemplateSummary(themes, itemCount, periodLabel, dateRangeLabel);
  }
}

/**
 * Generate a template-based summary when LLM is unavailable
 */
function generateTemplateSummary(
  themes: string[],
  itemCount: number,
  periodLabel: string,
  dateRangeLabel?: string
): string {
  const periodText = dateRangeLabel
    ? `for ${dateRangeLabel}`
    : `this ${periodLabel.toLowerCase()}`;
  return `This code intelligence digest ${periodText} covers ${itemCount} items focused on key themes including ${themes.slice(0, 3).join(", ")}. The community continues to prioritize developer productivity, advanced context management, and agentic workflow patterns. Review the highlights below for the most impactful insights.`;
}
