/**
 * Normalization pipeline
 * Converts raw Inoreader articles to FeedItem format
 */

import { FeedItem } from "../model";
import { InoreaderArticle } from "../inoreader/types";
import { getFeedConfig } from "../../config/feeds";

/**
 * Normalize a raw Inoreader article to FeedItem
 */
export async function normalizeItem(raw: InoreaderArticle): Promise<FeedItem> {
  const streamId = raw.origin?.streamId;
  const feedConfig = await getFeedConfig(streamId);

  // Extract canonical URL
  let url = "";
  if (raw.canonical?.[0]?.href) {
    url = raw.canonical[0].href;
  } else if (raw.alternate?.[0]?.href) {
    url = raw.alternate[0].href;
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
