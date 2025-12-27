/**
 * Categorization pipeline
 * Secondary pass to adjust category assignment based on Inoreader folders/tags
 */

import { FeedItem, Category } from "../model";
import { logger } from "../logger";

/**
 * Category override mappings based on folder/tag patterns
 */
const CATEGORY_OVERRIDES: Record<string, Category> = {
  // Add mappings like:
  // "podcasts": "podcasts",
  // "research": "research",
};

/**
 * Detect if an item is a podcast based on source title and title patterns
 */
function isPodcastItem(item: FeedItem): boolean {
  const title = item.title.toLowerCase();
  const sourceTitle = item.sourceTitle.toLowerCase();
  const summary = item.summary?.toLowerCase() || '';

  // First, check source title for podcast indicators
  // This catches podcast feeds even when episode titles don't match patterns
  if (sourceTitle.includes('podcast')) {
    return true;
  }

  // Strong podcast indicators in title
  const podcastPatterns = [
    /^podcast:/i,
    /\bpodcast\b.*episode/i,
    /episode \d+/i,
    /^ep\.\s*\d+/i,
  ];

  for (const pattern of podcastPatterns) {
    if (pattern.test(item.title)) {
      return true;
    }
  }

  // Check if InfoQ/similar tech sites with "Podcast:" prefix
  if (title.startsWith('podcast:') || title.includes('podcast:')) {
    return true;
  }

  return false;
}

/**
 * Adjust category assignment based on item metadata
 */
export function categorizeItem(item: FeedItem): FeedItem {
  // First, check if item looks like a podcast (title-based detection)
  if (isPodcastItem(item)) {
    if (item.category !== 'podcasts') {
      logger.debug(
        `Detected podcast item, recategorizing: ${item.title}: ${item.category} -> podcasts`
      );
      return {
        ...item,
        category: 'podcasts',
      };
    }
  }

  // Check if any of the item's categories match our override map
  for (const cat of item.categories) {
    const normalized = cat.toLowerCase().trim();
    if (CATEGORY_OVERRIDES[normalized]) {
      const newCategory = CATEGORY_OVERRIDES[normalized];
      if (newCategory !== item.category) {
        logger.debug(
          `Overriding category for ${item.title}: ${item.category} -> ${newCategory}`
        );
        return {
          ...item,
          category: newCategory,
        };
      }
    }
  }

  // No override, keep original category
  return item;
}

/**
 * Categorize a batch of items
 */
export function categorizeItems(items: FeedItem[]): FeedItem[] {
  return items.map(categorizeItem);
}
