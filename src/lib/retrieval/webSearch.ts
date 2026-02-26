/**
 * Provider-agnostic web search for agent retrieval.
 * Uses Tavily when TAVILY_API_KEY is set; otherwise returns empty results.
 */

import { logger } from "../logger";

export interface WebResult {
  title: string;
  url: string;
  content?: string;
  score?: number;
  publishedDate?: string;
}

export interface WebSearchOptions {
  numResults?: number;
  domains?: string[];
  topic?: "general" | "news";
  timeRange?: "day" | "week" | "month" | "year";
}

const TAVILY_SEARCH_URL = "https://api.tavily.com/search";

/**
 * Search the web. Uses Tavily API when TAVILY_API_KEY is set.
 * Returns empty array when no API key is configured.
 */
export async function searchWeb(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebResult[]> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey?.trim()) {
    logger.debug("TAVILY_API_KEY not set, skipping web search");
    return [];
  }

  const numResults = Math.min(options.numResults ?? 10, 20);
  const body: Record<string, unknown> = {
    query,
    max_results: numResults,
    search_depth: "basic",
    topic: options.topic ?? "general",
  };
  if (options.domains?.length) {
    body.include_domains = options.domains.slice(0, 300);
  }
  if (options.timeRange) {
    body.time_range = options.timeRange;
  }

  try {
    const response = await fetch(TAVILY_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn("Tavily search failed", {
        status: response.status,
        body: text.slice(0, 200),
      });
      return [];
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        content?: string;
        score?: number;
        published_date?: string;
      }>;
    };

    const results = (data.results ?? []).map((r) => ({
      title: r.title ?? "",
      url: r.url ?? "",
      content: r.content,
      score: r.score,
      publishedDate: r.published_date,
    }));

    logger.info("Web search completed", {
      query: query.slice(0, 60),
      resultCount: results.length,
    });
    return results;
  } catch (error) {
    logger.error("Web search error", { error, query: query.slice(0, 60) });
    return [];
  }
}
