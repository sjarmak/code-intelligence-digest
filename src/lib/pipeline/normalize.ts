/**
 * Normalization pipeline
 * Converts raw Inoreader articles to FeedItem format
 */

import { FeedItem } from "../model";
import { InoreaderArticle } from "../inoreader/types";
import { getFeedConfig } from "../../config/feeds";

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

  return {
    id: raw.id,
    streamId: streamId || "",
    sourceTitle: feedConfig?.canonicalName ?? raw.origin?.title ?? "Unknown",
    title: raw.title ?? "",
    url,
    author: raw.author,
    publishedAt: new Date(raw.published * 1000),
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
