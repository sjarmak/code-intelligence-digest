/**
 * Inoreader starred items sync
 * Fetches items marked as starred/important in Inoreader
 */

import { createInoreaderClient } from "./client";
import { logger } from "../logger";

export interface StarredItemMetadata {
  id: string; // Inoreader item ID
  title: string;
  sourceTitle: string;
  url: string;
  publishedAt: Date;
  summary?: string;
  contentSnippet?: string;
  categories?: string[];
}

/**
 * Fetch starred items from Inoreader
 * Uses special streamId "user/-/state/com.google/starred"
 */
export async function fetchStarredItems(
  limit: number = 100,
  continuation?: string
): Promise<{
  items: StarredItemMetadata[];
  continuation?: string;
  count: number;
}> {
  try {
    const client = createInoreaderClient();
    
    const streamId = "user/-/state/com.google/starred";
    
    logger.info("Fetching starred items from Inoreader", {
      streamId,
      limit,
      hasContinuation: !!continuation,
    });

    const response = await client.getStreamContents(streamId, {
      n: limit,
      continuation,
    });

    if (!response.items) {
      logger.warn("No items in starred response");
      return { items: [], count: 0 };
    }

    const items: StarredItemMetadata[] = response.items.map((article: any) => ({
      id: article.id,
      title: article.title || "(Untitled)",
      sourceTitle: article.origin?.title || "Unknown Source",
      url: article.alternate?.[0]?.href || article.canonical?.[0]?.href || "#",
      publishedAt: new Date(
        (article.published || article.updated || Math.floor(Date.now() / 1000)) * 1000
      ),
      summary: article.summary?.content,
      contentSnippet: article.content?.content,
      categories: article.categories || [],
    }));

    logger.info("Fetched starred items", {
      count: items.length,
      hasContinuation: !!response.continuation,
    });

    return {
      items,
      continuation: response.continuation,
      count: items.length,
    };
  } catch (error) {
    logger.error("Failed to fetch starred items", error);
    throw error;
  }
}

/**
 * Fetch all starred items (paginate through all results)
 */
export async function fetchAllStarredItems(
  maxItems?: number
): Promise<StarredItemMetadata[]> {
  const items: StarredItemMetadata[] = [];
  let continuation: string | undefined;

  try {
    while (items.length < (maxItems ?? Infinity)) {
      const batch = await fetchStarredItems(100, continuation);
      items.push(...batch.items);

      if (!batch.continuation) {
        break;
      }

      continuation = batch.continuation;

      if (maxItems && items.length >= maxItems) {
        break;
      }
    }

    logger.info("Fetched all available starred items", { count: items.length });
    return items.slice(0, maxItems);
  } catch (error) {
    logger.error("Failed to fetch all starred items", error);
    throw error;
  }
}
