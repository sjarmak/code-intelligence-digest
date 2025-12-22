/**
 * URL finder for newsletter articles
 * When a newsletter article is extracted but has no valid URL,
 * search for the article and return the real URL
 */

import { logger } from "../logger";

/**
 * Call Amp's web_search tool via direct fetch
 * Requires AMP_API_URL and AMP_API_TOKEN env vars
 */
async function callAmpWebSearch(objective: string): Promise<Array<{ url: string; title: string }> | null> {
  const ampUrl = process.env.AMP_API_URL;
  const ampToken = process.env.AMP_API_TOKEN;
  
  if (!ampUrl || !ampToken) {
    return null;
  }
  
  try {
    const response = await fetch(`${ampUrl}/api/web-search`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${ampToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        objective,
        max_results: 5,
      }),
    });
    
    if (!response.ok) {
      logger.debug("Amp web search failed", { status: response.status });
      return null;
    }
    
    const data = await response.json();
    return data.results || null;
  } catch (e) {
    logger.debug("Failed to call Amp web search", {
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
 * Web search via Amp's web_search tool
 * Tries to find the actual article URL by searching for the title
 */
async function searchViaWeb(title: string, source?: string, _context?: string): Promise<string | null> {
  try {
    // Build search query with source constraints
    const searchTerms = [title.substring(0, 80)];
    
    if (source?.includes("Substack")) {
      searchTerms.push("site:substack.com");
    } else if (source?.includes("Medium")) {
      searchTerms.push("site:medium.com");
    } else if (source?.includes("dev.to")) {
      searchTerms.push("site:dev.to");
    }
    
    const query = searchTerms.join(" ");
    logger.debug(`Searching via Amp web search: "${query}"`);
    
    // Try Amp web search first
    const results = await callAmpWebSearch(query);
    if (results && results.length > 0) {
      const firstResult = results[0];
      logger.info(`Found URL via Amp web search: ${firstResult.url}`);
      return firstResult.url;
    }
    
    logger.debug(`No results from Amp web search for: "${query}"`);
    
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
 */
export function extractUrlFromContent(content: string | undefined): string | null {
  if (!content) {
    return null;
  }

  // Match common URL patterns
  const urlMatch = content.match(/https?:\/\/[^\s<>"'\)]+/);
  if (urlMatch) {
    const url = urlMatch[0];
    
    // Filter out common unwanted URLs
    if (
      !url.includes("inoreader.com") &&
      !url.includes("google.com/reader") &&
      !url.includes("tracking.") &&
      !url.includes("/unsubscribe")
    ) {
      return url;
    }
  }

  return null;
}
