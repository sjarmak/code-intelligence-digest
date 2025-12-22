/**
 * URL finder for newsletter articles
 * When a newsletter article is extracted but has no valid URL,
 * search for the article and return the real URL
 */

import { logger } from "../logger";

/**
 * URL patterns that should be excluded from search results
 */
const BAD_SEARCH_URL_PATTERNS = [
  /reddit\.com\/r\//i,
  /reddit\.com\/u\//i,
  /reddit\.com\/user\//i,
  /news\.google\.com\/rss\//i,
  /inoreader\.com/i,
  /google\.com\/reader/i,
  /\/advertis(e|ing)/i,
  /\/sponsor/i,
  /\/unsubscribe/i,
  /\/subscribe(?![a-z])/i, // subscribe but not substack
  /\/privacy/i,
  /\/terms/i,
];

/**
 * Check if a URL should be excluded from search results
 */
function isExcludedSearchUrl(url: string): boolean {
  if (!url) return true;
  for (const pattern of BAD_SEARCH_URL_PATTERNS) {
    if (pattern.test(url)) {
      return true;
    }
  }
  return false;
}

/**
 * Call Parallel web search API (free/public)
 * Based on Amp's implementation: https://github.com/sourcegraph/amp/blob/main/server/src/routes/api/internal/web-search.ts
 */
async function parallelWebSearch(objective: string, searchQueries?: string[]): Promise<Array<{ url: string; title: string }> | null> {
  const apiKey = process.env.PARALLEL_API_KEY;
  
  if (!apiKey) {
    logger.debug("PARALLEL_API_KEY not set, skipping web search");
    return null;
  }
  
  try {
    const request = {
      objective,
      search_queries: searchQueries,
      processor: "base",
      max_results: 5,
    };
    
    const response = await fetch("https://api.parallel.ai/v1beta/search", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify(request),
    });
    
    if (!response.ok) {
      const errorText = await response.text();
      logger.debug("Parallel API error", { status: response.status, error: errorText });
      return null;
    }
    
    const data = await response.json() as {
      results?: Array<{ url: string; title?: string; excerpts?: string[] }>;
    };
    
    return (
      data.results?.map((item) => ({
        url: item.url,
        title: item.title || "Untitled",
      })) || null
    );
  } catch (e) {
    logger.debug("Parallel web search failed", {
      error: e instanceof Error ? e.message : String(e),
    });
    return null;
  }
}

/**
 * Search for an article URL given title and context
 * Uses Sourcegraph deep search or fallback web search
 */
export async function findArticleUrl(
  title: string,
  source?: string,
  context?: string
): Promise<string | null> {
  if (!title || title.length < 5) {
    return null;
  }

  // Try to construct a search query
  const query = buildSearchQuery(title, source);
  
  logger.debug(`Searching for article URL: "${title}"`);

  // Try deep search via Sourcegraph if available
  if (process.env.SRC_ACCESS_TOKEN) {
    try {
      const url = await searchViaSourcegraph(query);
      if (url) {
        logger.info(`Found URL via Sourcegraph: ${url}`);
        return url;
      }
    } catch (e) {
      logger.debug("Sourcegraph search failed, trying web search");
    }
  }

  // Fallback: try web search
  try {
    const url = await searchViaWeb(title, source, context);
    if (url) {
      logger.info(`Found URL via web search: ${url}`);
      return url;
    }
  } catch (e) {
    logger.warn(`Failed to find URL for article: "${title}"`, {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return null;
}

/**
 * Build a search query from article title and optional source
 */
function buildSearchQuery(title: string, source?: string): string {
  const parts = [title];
  
  // Add source context for narrower search
  if (source) {
    if (source.includes("Substack")) {
      parts.push("substack");
    } else if (source.includes("Medium")) {
      parts.push("medium");
    } else if (source.includes("dev.to")) {
      parts.push("dev.to");
    }
  }
  
  // Clean up title for search
  const cleaned = title
    .substring(0, 80)
    .replace(/[^\w\s-]/g, "") // Remove special chars
    .trim();
  
  return cleaned || title;
}

/**
 * Search via Sourcegraph Deep Search (if token available)
 * Returns first matching URL from search results
 */
async function searchViaSourcegraph(query: string): Promise<string | null> {
  const token = process.env.SRC_ACCESS_TOKEN;
  if (!token) {
    return null;
  }

  try {
    const sgUrl = process.env.SOURCEGRAPH_URL || "https://sourcegraph.sourcegraph.com";
    
    const response = await fetch(`${sgUrl}/.api/graphql`, {
      method: "POST",
      headers: {
        "Authorization": `token ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        query: `
          query {
            search(query: "${query.replace(/"/g, '\\"')}") {
              results {
                results {
                  ... on FileMatch {
                    url
                  }
                }
              }
            }
          }
        `,
      }),
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const results = data?.data?.search?.results?.results || [];
    
    if (results.length > 0 && results[0].url) {
      return results[0].url;
    }
  } catch (e) {
    logger.debug("Sourcegraph API error", {
      error: e instanceof Error ? e.message : String(e),
    });
  }

  return null;
}

/**
 * Web search via Parallel API
 * Tries to find the actual article URL by searching for the title
 */
async function searchViaWeb(title: string, source?: string, _context?: string): Promise<string | null> {
  try {
    // Build search queries with source constraints
    const searchQueries: string[] = [];
    
    if (source?.includes("Substack")) {
      searchQueries.push("site:substack.com");
    } else if (source?.includes("Medium")) {
      searchQueries.push("site:medium.com");
    } else if (source?.includes("dev.to")) {
      searchQueries.push("site:dev.to");
    }
    
    const objective = title.substring(0, 100);
    logger.debug(`Searching via Parallel API: "${objective}"${searchQueries.length > 0 ? ` with filters: ${searchQueries.join(", ")}` : ""}`);
    
    // Try Parallel web search
    const results = await parallelWebSearch(objective, searchQueries.length > 0 ? searchQueries : undefined);
    if (results && results.length > 0) {
      // Filter out bad URLs and return first valid result
      const validResult = results.find(r => !isExcludedSearchUrl(r.url));
      if (validResult) {
        logger.info(`Found URL via Parallel web search: "${title.substring(0, 50)}..." -> ${validResult.url}`);
        return validResult.url;
      }
      logger.debug(`All ${results.length} web search results were excluded (bad URLs)`);
    }

    logger.debug(`No valid results from Parallel web search for: "${objective}"`);
    
  } catch (e) {
    logger.debug("Web search failed", {
      error: e instanceof Error ? e.message : String(e),
    });
  }
  
  return null;
}

/**
 * Extract URL from article text if present
 * Looks for URLs in content snippets or full text
 * Iterates through all URLs to find first valid one
 */
export function extractUrlFromContent(content: string | undefined): string | null {
  if (!content) {
    return null;
  }

  // Match ALL URL patterns in content
  const urlRegex = /https?:\/\/[^\s<>"'\)]+/g;
  const allUrls = content.match(urlRegex);

  if (!allUrls || allUrls.length === 0) {
    return null;
  }

  // Filter out common unwanted URLs
  const badUrlPatterns = [
    /inoreader\.com/i,
    /google\.com\/reader/i,
    /news\.google\.com\/rss\//i,
    /tracking\./i,
    /\/unsubscribe/i,
    /reddit\.com\/r\//i, // Reddit discussion threads
    /reddit\.com\/u\//i, // Reddit user profiles
    /reddit\.com\/user\//i,
    /\/advertise/i,
    /\/sponsor/i,
    /\/media-kit/i,
    /\/privacy/i,
    /\/terms/i,
    /substack\.com\/redirect\//i, // Unresolved redirects
    /substackcdn\.com/i, // CDN assets, not articles
  ];

  // Find first URL that isn't blacklisted
  for (const url of allUrls) {
    const isBlacklisted = badUrlPatterns.some(pattern => pattern.test(url));
    if (!isBlacklisted) {
      return url;
    }
  }

  logger.debug(`All ${allUrls.length} URLs in content were blacklisted`);
  return null;
}
