/**
 * Provider-agnostic web search for agent retrieval.
 * Uses Parallel as default provider, with Tavily fallback.
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
const PARALLEL_SEARCH_URL = "https://api.parallel.ai/v1beta/search";

// Agents silently lose all web context when no search provider is
// configured — warn loudly, but once per process rather than per query.
let warnedNoProvider = false;
function warnNoWebSearchProviderOnce(): void {
  if (warnedNoProvider) return;
  warnedNoProvider = true;
  logger.warn(
    "WEB SEARCH DEGRADED: neither PARALLEL_API_KEY nor TAVILY_API_KEY is set — agent jobs will run without web context."
  );
}

function parseLikelyDate(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  return undefined;
}

function inferDateFromTextOrUrl(input: string): string | undefined {
  const patterns = [
    /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/,
    /\b(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+([0-2]?\d|3[01]),?\s+(20\d{2})\b/i,
  ];
  for (const pattern of patterns) {
    const match = input.match(pattern);
    if (!match) continue;
    const iso = parseLikelyDate(match[0]);
    if (iso) return iso;
  }
  return undefined;
}

function inferPublishedDate(url: string, title?: string, excerpt?: string): string | undefined {
  return inferDateFromTextOrUrl(url) ?? inferDateFromTextOrUrl(title ?? "") ?? inferDateFromTextOrUrl(excerpt ?? "");
}

function objectiveWithTimeRange(
  query: string,
  timeRange?: "day" | "week" | "month" | "year",
): string {
  if (!timeRange) return query;
  const suffix =
    timeRange === "day"
      ? "published in the last 24 hours"
      : timeRange === "week"
        ? "published in the last 7 days"
        : timeRange === "month"
          ? "published in the last 30 days"
          : "published in the last 12 months";
  return `${query} (${suffix})`;
}

function matchesIncludedDomains(url: string, domains?: string[]): boolean {
  if (!domains || domains.length === 0) return true;
  try {
    const host = new URL(url).hostname.toLowerCase().replace(/^www\./, "");
    return domains.some((d) => {
      const domain = d.toLowerCase().replace(/^www\./, "");
      return host === domain || host.endsWith(`.${domain}`);
    });
  } catch {
    return false;
  }
}

async function searchParallel(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebResult[]> {
  const apiKey = process.env.PARALLEL_API_KEY;
  if (!apiKey?.trim()) {
    return [];
  }

  try {
    const response = await fetch(PARALLEL_SEARCH_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        objective: objectiveWithTimeRange(query, options.timeRange),
        search_queries: options.domains?.slice(0, 5).map((d) => `site:${d}`),
        processor: "base",
        max_results: Math.min(options.numResults ?? 10, 20),
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn("Parallel search failed", {
        status: response.status,
        body: text.slice(0, 200),
      });
      return [];
    }

    const data = (await response.json()) as {
      results?: Array<{
        title?: string;
        url?: string;
        excerpts?: string[];
      }>;
    };

    const results = (data.results ?? [])
      .map((r) => ({
        title: r.title ?? "",
        url: r.url ?? "",
        content: r.excerpts?.[0],
        score: 0.55,
        publishedDate: inferPublishedDate(r.url ?? "", r.title, r.excerpts?.[0]),
      }))
      .filter((r) => r.url && r.title && matchesIncludedDomains(r.url, options.domains));

    logger.info("Parallel web search completed", {
      query: query.slice(0, 60),
      resultCount: results.length,
    });
    return results;
  } catch (error) {
    logger.error("Parallel web search error", { error, query: query.slice(0, 60) });
    return [];
  }
}

/**
 * Search the web. Uses Tavily API when TAVILY_API_KEY is set.
 * Returns empty array when no API key is configured.
 */
export async function searchWeb(
  query: string,
  options: WebSearchOptions = {}
): Promise<WebResult[]> {
  const parallelResults = await searchParallel(query, options);
  if (parallelResults.length > 0) {
    return parallelResults;
  }

  const tavilyApiKey = process.env.TAVILY_API_KEY;
  if (!tavilyApiKey?.trim()) {
    if (!process.env.PARALLEL_API_KEY?.trim()) {
      warnNoWebSearchProviderOnce();
    } else {
      logger.warn("Web search degraded: Parallel returned no results and TAVILY_API_KEY not set", {
        query: query.slice(0, 60),
      });
    }
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
        Authorization: `Bearer ${tavilyApiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(15000),
    });

    if (!response.ok) {
      const text = await response.text();
      logger.warn("Tavily fallback search failed", {
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
    logger.info("Tavily fallback web search completed", {
      query: query.slice(0, 60),
      resultCount: results.length,
    });
    return results;
  } catch (error) {
    logger.error("Tavily fallback web search error", {
      error,
      query: query.slice(0, 60),
    });
    return [];
  }
}
