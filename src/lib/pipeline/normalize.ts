/**
 * Normalization pipeline
 * Converts raw Inoreader articles to FeedItem format
 */

import { FeedItem } from "../model";
import { InoreaderArticle } from "../inoreader/types";
import { getFeedConfig } from "../../config/feeds";
import { logger } from "../logger";

/**
 * Check if a URL is an Inoreader item URL (should be rejected)
 */
function isInoreaderUrl(url: string): boolean {
  return url.includes("inoreader.com") || url.includes("google.com/reader");
}

/**
 * Extract URL from HTML content (fallback for missing canonical/alternate)
 * For email newsletters with multiple links, pick the first valid article URL
 */
function extractUrlFromHtml(html: string): string {
  if (!html) return "";

  // Find ALL hrefs in the HTML
  const urlRegex = /href=["']([^"']+)["']/g;
  let match;

  while ((match = urlRegex.exec(html)) !== null) {
    const url = match[1];

    // Skip trackers, images, and Inoreader URLs
    if (
      isInoreaderUrl(url) ||
      url.startsWith("javascript:") ||
      url.startsWith("data:") ||
      url.includes("tracking") ||
      url.includes("pixel") ||
      url.includes(".gif") ||
      url.includes(".png")
    ) {
      continue;
    }

    // Return first valid http(s) URL
    if (url.startsWith("http://") || url.startsWith("https://")) {
      return url;
    }
  }

  return "";
}

/**
 * Extract arXiv ID from URL
 * Examples:
 * https://arxiv.org/abs/2512.12730 -> 2512.12730
 * https://arxiv.org/pdf/2512.12730.pdf -> 2512.12730
 * http://arxiv.org/abs/2512.12730v2 -> 2512.12730
 */
function extractArxivId(url: string): string | null {
  const match = url.match(/(?:arxiv\.org\/abs\/|arxiv\.org\/pdf\/)(\d{4}\.\d{4,5})(?:v\d+)?(?:\.pdf)?/);
  return match ? match[1] : null;
}

/**
 * Fetch publication date from arXiv API
 * Returns the actual publication/revision date from arXiv, not the feed update date
 */
async function fetchArxivPublicationDate(url: string): Promise<Date | null> {
  const arxivId = extractArxivId(url);
  if (!arxivId) {
    return null;
  }

  try {
    const apiUrl = `http://export.arxiv.org/api/query?id_list=${arxivId}&max_results=1`;
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(5000) });

    if (!response.ok) {
      return null;
    }

    const xml = await response.text();

    // Extract published date from XML
    // arXiv API returns dates in ISO 8601 format: 2024-12-20T18:00:00Z
    // <published> is the original submission date (what we want)
    // <updated> is the latest revision date
    const publishedMatch = xml.match(/<published[^>]*>([^<]+)<\/published>/);
    if (publishedMatch) {
      const dateStr = publishedMatch[1].trim();
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        logger.debug(`Extracted arXiv publication date: ${dateStr} for ${arxivId}`);
        return date;
      }
    }

    // Fallback: try <updated> tag if <published> not found
    // (though <published> should always be present)
    const updatedMatch = xml.match(/<updated[^>]*>([^<]+)<\/updated>/);
    if (updatedMatch) {
      const dateStr = updatedMatch[1].trim();
      const date = new Date(dateStr);
      if (!isNaN(date.getTime())) {
        logger.debug(`Extracted arXiv updated date (fallback): ${dateStr} for ${arxivId}`);
        return date;
      }
    }

    return null;
  } catch (error) {
    // Fail silently - we'll fall back to Inoreader's date
    logger.debug(`Failed to fetch arXiv date for ${arxivId}`, {
      error: error instanceof Error ? error.message : String(error)
    });
    return null;
  }
}

/**
 * Normalize a raw Inoreader article to FeedItem
 */
export async function normalizeItem(raw: InoreaderArticle): Promise<FeedItem> {
  const streamId = raw.origin?.streamId;
  const feedConfig = await getFeedConfig(streamId);

  // Extract canonical URL, with fallback to alternate, then HTML extraction
  // Never use Inoreader URLs
  let url = "";
  if (raw.canonical?.[0]?.href && !isInoreaderUrl(raw.canonical[0].href)) {
    url = raw.canonical[0].href;
  } else if (raw.alternate?.[0]?.href && !isInoreaderUrl(raw.alternate[0].href)) {
    url = raw.alternate[0].href;
  } else if (raw.summary?.content) {
    // Fallback: try to extract URL from HTML content
    url = extractUrlFromHtml(raw.summary.content);
  }

  // Get snippet from summary if available
  const fullSummary = raw.summary?.content || "";
  const snippet = fullSummary.length > 500 ? fullSummary.slice(0, 500) : fullSummary;

  // For arXiv papers, try to get the actual publication date from arXiv API
  // Inoreader's `published` field reflects when the feed was updated, not the paper's revision date
  let publishedAt = new Date(raw.published * 1000);
  if (url && url.includes("arxiv")) {
    const arxivDate = await fetchArxivPublicationDate(url);
    if (arxivDate) {
      publishedAt = arxivDate;
    }
  }

  return {
    id: raw.id,
    streamId: streamId || "",
    sourceTitle: feedConfig?.canonicalName ?? raw.origin?.title ?? "Unknown",
    title: raw.title ?? "",
    url,
    author: raw.author,
    publishedAt,
    summary: fullSummary,
    contentSnippet: snippet,
    categories: (raw.categories ?? []).map((c: string) => {
      // Extract label from category string like "user/1234/label/MyLabel"
      const parts = c.split("/");
      return parts[parts.length - 1] ?? c;
    }),
    category: feedConfig?.defaultCategory ?? "tech_articles",
    raw,
  };
}

/**
 * Normalize a batch of raw Inoreader articles
 */
export async function normalizeItems(articles: InoreaderArticle[]): Promise<FeedItem[]> {
  return Promise.all(articles.map(normalizeItem));
}
