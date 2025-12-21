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
  const minItems = Math.max(10, Math.ceil(maxItems * 0.67)); // Enforce minimum of 10 items
  
  // First, deduplicate by URL to handle same article from different sources
  const deduplicatedItems = deduplicateByUrl(rankedItems);
  
  const selected: RankedItem[] = [];
  const sourceCount = new Map<string, number>();
  const reasons = new Map<string, string>();
  const seenSources = new Set<string>();

  // First pass: enforce minimum diversity (at least 1 item per source up to maxPerSource)
  const sourcePriority = new Map<string, number>();
  for (const item of deduplicatedItems) {
    if (!sourcePriority.has(item.sourceTitle)) {
      sourcePriority.set(item.sourceTitle, deduplicatedItems.findIndex(i => i.sourceTitle === item.sourceTitle));
    }
  }

  for (const item of deduplicatedItems) {
    // Check source cap
    const currentSourceCount = sourceCount.get(item.sourceTitle) ?? 0;
    if (currentSourceCount >= maxPerSource) {
      continue;
    }

    // Check total cap (but allow exceeding if below minimum threshold)
    if (selected.length >= maxItems && seenSources.size >= 5) {
      // Stop if we've hit max items AND have good source diversity
      reasons.set(item.id, `Total category limit reached (${selected.length}/${maxItems})`);
      break;
    }

    // Accept item
    selected.push(item);
    sourceCount.set(item.sourceTitle, currentSourceCount + 1);
    seenSources.add(item.sourceTitle);
    reasons.set(item.id, `Selected at rank ${selected.length}`);

    // Stop after hitting max items OR minimum items with diversity
    if (selected.length >= maxItems) {
      break;
    }
  }

  // If we fell below minimum, add more items (relaxing source caps)
  if (selected.length < minItems && selected.length < deduplicatedItems.length) {
    logger.warn(
      `Below minimum items (${selected.length}/${minItems}), relaxing diversity constraints`
    );
    
    for (const item of deduplicatedItems) {
      if (!selected.find(s => s.id === item.id) && selected.length < minItems) {
        selected.push(item);
        const count = (sourceCount.get(item.sourceTitle) ?? 0) + 1;
        sourceCount.set(item.sourceTitle, count);
        reasons.set(item.id, `Selected (minimum threshold enforcement)`);
      }
    }
  }

  const sourceCount_value = new Map(sourceCount);
  const uniqueSources = sourceCount_value.size;
  logger.info(
    `Selected ${selected.length} items from ${uniqueSources} sources ` +
    `(min: ${minItems}, max: ${maxItems}, per-source cap: ${maxPerSource})`
  );

  return { items: selected, reasons };
}
