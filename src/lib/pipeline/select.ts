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
  // Always return top 10 items minimum, regardless of diversity constraints
  const minItems = 10;

  // First, deduplicate by URL to handle same article from different sources
  const deduplicatedItems = deduplicateByUrl(rankedItems);

  // Filter out items with very low scores (likely not relevant)
  // Items with finalScore < 0.05 are probably not useful (lowered to ensure we have enough items)
  const qualityItems = deduplicatedItems.filter(item => item.finalScore >= 0.05);

  if (qualityItems.length < deduplicatedItems.length) {
    logger.info(
      `Filtered out ${deduplicatedItems.length - qualityItems.length} items with scores < 0.05`
    );
  }

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

  // Calculate max per source for minimum guarantee (ensure diversity in top 10)
  // For top 10, limit to max 4 items per source to ensure at least 3 sources
  // But if we don't have enough items, allow up to 5 per source to reach minimum
  const minGuaranteeMaxPerSource = qualityItems.length >= minItems
    ? Math.max(3, Math.floor(minItems / 3))  // Normal: max 3-4 per source
    : 5;  // If limited items, allow more per source to reach minimum

  for (const item of qualityItems) {
    const currentSourceCount = sourceCount.get(item.sourceTitle) ?? 0;

    // For minimum guarantee (first 10 items), enforce source diversity
    if (selected.length < minItems) {
      // Apply source cap even during minimum guarantee to ensure diversity
      if (currentSourceCount >= minGuaranteeMaxPerSource) {
        reasons.set(item.id, `Source cap reached for ${item.sourceTitle} during minimum guarantee (${minGuaranteeMaxPerSource} items)`);
        continue;
      }
      // Accept item
      selected.push(item);
      sourceCount.set(item.sourceTitle, currentSourceCount + 1);
      seenSources.add(item.sourceTitle);
      reasons.set(item.id, `Selected at rank ${selected.length} (minimum guarantee)`);
      continue;
    }

    // After minimum, apply normal source caps
    if (currentSourceCount >= maxPerSource) {
      reasons.set(item.id, `Source cap reached for ${item.sourceTitle} (${maxPerSource} items)`);
      continue;
    }

    // Check total cap
    if (selected.length >= maxItems) {
      reasons.set(item.id, `Total category limit reached (${selected.length}/${maxItems})`);
      break;
    }

    // Accept item
    selected.push(item);
    sourceCount.set(item.sourceTitle, currentSourceCount + 1);
    seenSources.add(item.sourceTitle);
    reasons.set(item.id, `Selected at rank ${selected.length}`);

    // Stop after hitting max items
    if (selected.length >= maxItems) {
      break;
    }
  }

  // If we fell below minimum, add more items (relaxing source caps but still enforcing some diversity)
  if (selected.length < minItems && selected.length < qualityItems.length) {
    logger.warn(
      `Below minimum items (${selected.length}/${minItems}), relaxing diversity constraints (allowing up to 5 per source)`
    );

    // When relaxing, still limit to 5 per source to maintain some diversity
    const relaxedMaxPerSource = 5;
    for (const item of qualityItems) {
      if (selected.length >= minItems) break;

      if (!selected.find(s => s.id === item.id)) {
        const currentSourceCount = sourceCount.get(item.sourceTitle) ?? 0;
        if (currentSourceCount >= relaxedMaxPerSource) {
          continue; // Still respect relaxed source cap
        }
        selected.push(item);
        sourceCount.set(item.sourceTitle, currentSourceCount + 1);
        reasons.set(item.id, `Selected (minimum threshold enforcement, relaxed diversity)`);
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
