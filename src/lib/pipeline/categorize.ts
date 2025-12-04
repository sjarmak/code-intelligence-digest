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
 * Adjust category assignment based on item metadata
 */
export function categorizeItem(item: FeedItem): FeedItem {
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
