/**
 * Selection pipeline
 * Apply diversity constraints and select top K items
 */

import { RankedItem, Category } from "../model";
import { getCategoryConfig } from "../../config/categories";
import { logger } from "../logger";

export interface SelectionResult {
  items: RankedItem[];
  reasons: Map<string, string>; // item.id -> diversity reason
}

/**
 * Deduplicate items by URL to avoid showing the same article from multiple sources
 * Returns a map of URL keys to the first (highest-ranked) item with that URL
 */
function deduplicateByUrl(rankedItems: RankedItem[]): RankedItem[] {
  const seenUrls = new Map<string, string>(); // URL key -> item ID (for tracking which was kept)
  const deduped: RankedItem[] = [];
  
  for (const item of rankedItems) {
    // Create a normalized URL key: hostname + path (without protocol/query params)
    try {
      const urlObj = new URL(item.url);
      const urlKey = urlObj.hostname + urlObj.pathname;
      
      if (!seenUrls.has(urlKey)) {
        seenUrls.set(urlKey, item.id);
        deduped.push(item);
      } else {
        logger.debug(
          `Deduplicating: "${item.title}" from ${item.sourceTitle} (same URL as item ${seenUrls.get(urlKey)})`
        );
      }
    } catch {
      // If URL parsing fails, include the item anyway
      deduped.push(item);
    }
  }
  
  logger.info(`Deduplicated ${rankedItems.length} items → ${deduped.length} unique URLs`);
  return deduped;
}

/**
 * Apply diversity constraints:
 * - Deduplication: max 1 item per unique URL
 * - Per-source cap: max N items per source per category
 * - Total cap: max CATEGORY_CONFIG[category].maxItems (or custom limit if provided)
 */
export function selectWithDiversity(
  rankedItems: RankedItem[],
  category: Category,
  maxPerSource: number = 2,
  maxItemsOverride?: number
): SelectionResult {
  const config = getCategoryConfig(category);
  const maxItems = maxItemsOverride ?? config.maxItems;
  
  // First, deduplicate by URL to handle same article from different sources
  const deduplicatedItems = deduplicateByUrl(rankedItems);
  
  const selected: RankedItem[] = [];
  const sourceCount = new Map<string, number>();
  const reasons = new Map<string, string>();

  for (const item of deduplicatedItems) {
    // Check source cap
    const currentSourceCount = sourceCount.get(item.sourceTitle) ?? 0;
    if (currentSourceCount >= maxPerSource) {
      const reason = `Source cap reached for ${item.sourceTitle} (${currentSourceCount}/${maxPerSource})`;
      logger.debug(
        `Skipping item from ${item.sourceTitle} (source cap reached): ${item.title}`
      );
      reasons.set(item.id, reason);
      continue;
    }

    // Check total cap
    if (selected.length >= maxItems) {
      const reason = `Total category limit reached (${selected.length}/${maxItems})`;
      logger.debug(
        `Reached max items limit (${maxItems}) for category ${category}`
      );
      reasons.set(item.id, reason);
      break;
    }

    // Accept item
    selected.push(item);
    sourceCount.set(item.sourceTitle, currentSourceCount + 1);
    reasons.set(item.id, `Selected at rank ${selected.length}`);
  }

  logger.info(`Selected ${selected.length} items with diversity constraints`);

  return { items: selected, reasons };
}
