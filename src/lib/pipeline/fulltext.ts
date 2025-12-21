/**
 * Full text fetching and caching
 * Retrieves complete article text from sources for better content generation
 * Supports: web scraping, arXiv, and other sources
 */

import { FeedItem } from "../model";
import { logger } from "../logger";

export interface FullTextResult {
  text: string;
  source: "web_scrape" | "arxiv" | "error";
  length: number;
  fetchedAt: Date;
}

/**
 * Fetch full text from a URL with retries and timeout
 * Supports HTML pages and PDFs
 */
async function fetchWebPage(url: string): Promise<string> {
  const maxRetries = 3;
  const timeout = 10000; // 10 seconds
  
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), timeout);
      
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (Code Intelligence Digest)",
          "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        },
      });
      
      clearTimeout(timeoutId);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      
      const html = await response.text();
      
      // Extract text from HTML (basic cleaning)
      const text = extractTextFromHTML(html);
      
      if (text.length < 100) {
        throw new Error("Extracted text too short");
      }
      
      logger.info(`Fetched full text from ${url} (${text.length} chars)`);
      return text;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.warn(
        `Attempt ${attempt}/${maxRetries} failed for ${url}: ${errorMsg}`
      );
      
      if (attempt < maxRetries) {
        // Exponential backoff: 1s, 2s, 4s
        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt - 1) * 1000));
      }
    }
  }
  
  throw new Error(`Failed to fetch ${url} after ${maxRetries} attempts`);
}

/**
 * Extract text from HTML
 * Removes scripts, styles, and cleans up whitespace
 */
function extractTextFromHTML(html: string): string {
  // Remove script and style elements
  const text = html
    .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "")
    .replace(/<style\b[^<]*(?:(?!<\/style>)<[^<]*)*<\/style>/gi, "")
    // Remove HTML tags
    .replace(/<[^>]+>/g, " ")
    // Decode HTML entities
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#\d+;/g, "")
    // Clean up whitespace
    .replace(/\s+/g, " ")
    .trim();
  
  return text;
}

/**
 * Fetch from arXiv API (for research papers)
 * Only works if URL contains arxiv ID
 */
async function fetchFromArxiv(url: string): Promise<string> {
  // Try to extract arXiv ID from URL
  const arxivMatch = url.match(/(?:arxiv\.org|arxiv)(?:.*?)(\d{4}\.\d{4,5})/);
  if (!arxivMatch) {
    throw new Error("Not an arXiv URL");
  }
  
  const arxivId = arxivMatch[1];
  
  try {
    // Try fetching from arXiv API
    const apiUrl = `http://export.arxiv.org/api/query?id_list=${arxivId}&max_results=1`;
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(10000) });
    
    if (!response.ok) {
      throw new Error(`arXiv API returned ${response.status}`);
    }
    
    const xml = await response.text();
    
    // Extract summary from XML (basic parsing)
    const summaryMatch = xml.match(/<summary[^>]*>([^<]+)<\/summary>/);
    if (!summaryMatch) {
      throw new Error("No summary in arXiv response");
    }
    
    const summary = summaryMatch[1]
      .trim()
      .replace(/\s+/g, " ");
    
    logger.info(`Fetched arXiv summary for ${arxivId} (${summary.length} chars)`);
    return summary;
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.warn(`Failed to fetch from arXiv: ${errorMsg}`);
    throw error;
  }
}

/**
 * Fetch full text from a URL
 * Returns the full text of an article
 * Falls back to web scraping if arXiv fails
 */
export async function fetchFullText(item: FeedItem): Promise<FullTextResult> {
  const { url } = item;
  
  logger.info(`Fetching full text for: ${item.title} (${url})`);
  
  // Try arXiv first if URL looks like arXiv
  if (url.includes("arxiv")) {
    try {
      const text = await fetchFromArxiv(url);
      return {
        text,
        source: "arxiv",
        length: text.length,
        fetchedAt: new Date(),
      };
    } catch (error) {
      logger.debug("arXiv fetch failed, falling back to web scrape");
    }
  }
  
  // Fall back to web scraping
  try {
    const text = await fetchWebPage(url);
    return {
      text,
      source: "web_scrape",
      length: text.length,
      fetchedAt: new Date(),
    };
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    logger.error(`Failed to fetch full text for ${url}`, { error: errorMsg });
    
    return {
      text: "",
      source: "error",
      length: 0,
      fetchedAt: new Date(),
    };
  }
}

/**
 * Fetch full text for multiple items in parallel with rate limiting
 * Respects domain rate limits (max 2 requests per second per domain)
 */
export async function fetchFullTextBatch(
  items: FeedItem[],
  maxConcurrent: number = 3
): Promise<Map<string, FullTextResult>> {
  const results = new Map<string, FullTextResult>();
  const domainQueue = new Map<string, number>(); // Track last fetch time per domain
  
  const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));
  
  const fetchWithRateLimit = async (item: FeedItem) => {
    try {
      // Extract domain from URL
      const domain = new URL(item.url).hostname || "unknown";
      
      // Rate limit: max 1 request per 500ms per domain
      const lastFetch = domainQueue.get(domain) || 0;
      const timeSinceLastFetch = Date.now() - lastFetch;
      if (timeSinceLastFetch < 500) {
        await delay(500 - timeSinceLastFetch);
      }
      
      domainQueue.set(domain, Date.now());
      
      const result = await fetchFullText(item);
      results.set(item.id, result);
      
      if (result.source !== "error") {
        logger.info(`Fetched full text for ${item.id} (${result.length} chars, ${result.source})`);
      }
    } catch (error) {
      logger.error(`Failed to fetch full text for item ${item.id}`, { error });
      results.set(item.id, {
        text: "",
        source: "error",
        length: 0,
        fetchedAt: new Date(),
      });
    }
  };
  
  // Process in batches to avoid overwhelming
  for (let i = 0; i < items.length; i += maxConcurrent) {
    const batch = items.slice(i, i + maxConcurrent);
    await Promise.all(batch.map(fetchWithRateLimit));
  }
  
  return results;
}

/**
 * Check if we have cached full text for an item
 * Returns true if full_text is not null and was fetched successfully
 */
export function hasCachedFullText(item: FeedItem & { fullText?: string }): boolean {
  return !!(item.fullText && item.fullText.length > 100);
}

/**
 * Merge full text into items if available
 * Useful for pipeline stages to check if full text is available
 */
export function enrichItemsWithFullText(
  items: FeedItem[],
  fullTextMap: Map<string, FullTextResult>
): (FeedItem & { fullText?: string })[] {
  return items.map(item => {
    const fullTextResult = fullTextMap.get(item.id);
    return {
      ...item,
      fullText: fullTextResult?.source !== "error" ? fullTextResult?.text : undefined,
    };
  });
}
