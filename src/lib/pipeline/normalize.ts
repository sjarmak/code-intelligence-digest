/**
 * Normalization pipeline
 * Converts raw Inoreader articles to FeedItem format
 */

import { FeedItem, Category } from "../model";
import { InoreaderArticle } from "../inoreader/types";
import { getFeedConfig } from "../../config/feeds";
import { logger } from "../logger";
import { decodeHtmlEntities } from "../utils/html-entities";

const INOREADER_LABEL_ALIASES: Record<string, string> = {
  // Inoreader label renamed from "Elevate" -> "Newsletter Misc"
  elevate: "Newsletter Misc",
};

export function normalizeInoreaderLabelName(label: string): string {
  const trimmed = (label ?? "").trim();
  if (!trimmed) return "";

  // Inoreader can include URL-encoded label names (spaces => %20) or '+'.
  const plusAsSpace = trimmed.replace(/\+/g, " ");
  let decoded = plusAsSpace;
  try {
    decoded = decodeURIComponent(plusAsSpace);
  } catch {
    // If label contains malformed percent-encoding, fall back to raw.
  }

  const collapsed = decoded.replace(/\s+/g, " ").trim();
  const alias = INOREADER_LABEL_ALIASES[collapsed.toLowerCase()];
  return alias ?? collapsed;
}

export function extractInoreaderCategoryLabel(categoryId: string): string {
  // Common formats:
  // - user/1234/label/MyLabel
  // - user/1234/label/Newsletter%20Misc
  // - user/1234/state/com.google/starred (not a label, but we still return last segment)
  const raw = categoryId ?? "";
  const parts = raw.split("/");
  const last = parts[parts.length - 1] ?? raw;
  return normalizeInoreaderLabelName(last);
}

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

  // Extract createdAt from crawlTimeMsec or timestampUsec (when Inoreader received the item)
  let createdAt = publishedAt; // Default to publishedAt
  if (raw.crawlTimeMsec) {
    const crawlTime = parseInt(raw.crawlTimeMsec, 10);
    if (!isNaN(crawlTime)) {
      createdAt = new Date(crawlTime);
    }
  } else if (raw.timestampUsec) {
    const timestampUsec = parseInt(raw.timestampUsec, 10);
    if (!isNaN(timestampUsec)) {
      createdAt = new Date(timestampUsec / 1000); // Convert microseconds to milliseconds
    }
  }

  // Determine category: check URL first to catch misconfigured feeds
  let category: Category = feedConfig?.defaultCategory ?? "tech_articles";

  // If this feed isn't in our feeds cache yet, fall back to Inoreader labels when available.
  // This helps newly-added feeds get categorized correctly before the feeds cache refreshes.
  if (!feedConfig) {
    const labelNames = (raw.categories ?? [])
      .map(extractInoreaderCategoryLabel)
      .filter(Boolean)
      .map((c) => c.toLowerCase());

    if (
      labelNames.some((l) => l === "newsletter misc") ||
      labelNames.some((l) => l.includes("newsletter"))
    ) {
      category = "newsletters";
    }
  }

  // Override category based on URL patterns (catches misconfigured feeds)
  if (url) {
    // Reddit URLs should always be community, regardless of feed config
    if (/reddit\.com\/(r|u|user)\//i.test(url)) {
      category = "community";
      logger.debug(`Detected Reddit URL, overriding category to community: ${url}`);
    }
    // Twitter/X feeds should be community, but avoid reclassifying normal newsletter articles that merely link to Twitter
    // Check if this is a dedicated Twitter feed by:
    // 1. URL points to twitter.com/x.com AND source title contains "twitter" or "@handle"
    // 2. OR the feed stream comes from Twitter RSS proxy services (xcancel, xgo.ing, rss.app for Twitter)
    else if (
      (url.includes("twitter.com/") || url.includes("x.com/")) &&
      (
        (feedConfig?.canonicalName ?? "").toLowerCase().includes("twitter") ||
        (raw.origin?.title ?? "").toLowerCase().includes("twitter") ||
        // Check for @handle pattern in source title (indicates dedicated Twitter feed)
        // Matches both "(@handle)" and "/ @handle" patterns
        /(\(@|\/\s*@)\w+/.test(feedConfig?.canonicalName ?? "") ||
        /(\(@|\/\s*@)\w+/.test(raw.origin?.title ?? "") ||
        // Check if feed stream is from Twitter RSS proxy services
        (streamId && (
          streamId.includes("xcancel.com") ||
          streamId.includes("xgo.ing") ||
          (streamId.includes("rss.app") && (
            (feedConfig?.canonicalName ?? "").toLowerCase().includes("twitter") ||
            (feedConfig?.vendor ?? "").toLowerCase() === "x.com"
          ))
        ))
      )
    ) {
      category = "community";
      logger.debug(`Detected Twitter/X feed item, overriding category to community: ${url}`);
    }
    // arXiv URLs should always be research
    else if (url.includes("arxiv.org")) {
      category = "research";
      logger.debug(`Detected arXiv URL, overriding category to research: ${url}`);
    }
  }

  // Decode HTML entities from title (e.g., &#9889; becomes ⚡)
  const decodedTitle = decodeHtmlEntities(raw.title ?? "");

  return {
    id: raw.id,
    streamId: streamId || "",
    sourceTitle: feedConfig?.canonicalName ?? raw.origin?.title ?? "Unknown",
    title: decodedTitle,
    url,
    author: raw.author,
    publishedAt,
    createdAt, // When Inoreader received/crawled the item
    summary: fullSummary,
    contentSnippet: snippet,
    categories: (raw.categories ?? []).map(extractInoreaderCategoryLabel),
    category,
    raw,
  };
}

/**
 * Normalize a batch of raw Inoreader articles
 */
export async function normalizeItems(articles: InoreaderArticle[]): Promise<FeedItem[]> {
  return Promise.all(articles.map(normalizeItem));
}
