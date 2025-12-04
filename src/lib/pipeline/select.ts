/**
 * Selection pipeline
 * Apply diversity constraints and select top K items
 */

import { RankedItem, Category } from "../model";
import { getCategoryConfig } from "../../config/categories";
import { logger } from "../logger";

/**
 * Apply diversity constraints:
 * - Per-source cap: max N items per source per category
 * - Total cap: max CATEGORY_CONFIG[category].maxItems
 */
export function selectWithDiversity(
  rankedItems: RankedItem[],
  category: Category,
  maxPerSource: number = 2
): RankedItem[] {
  const config = getCategoryConfig(category);
  const selected: RankedItem[] = [];
  const sourceCount = new Map<string, number>();

  for (const item of rankedItems) {
    // Check source cap
    const currentSourceCount = sourceCount.get(item.sourceTitle) ?? 0;
    if (currentSourceCount >= maxPerSource) {
      logger.debug(
        `Skipping item from ${item.sourceTitle} (source cap reached): ${item.title}`
      );
      continue;
    }

    // Check total cap
    if (selected.length >= config.maxItems) {
      logger.debug(
        `Reached max items limit (${config.maxItems}) for category ${category}`
      );
      break;
    }

    // Accept item
    selected.push(item);
    sourceCount.set(item.sourceTitle, currentSourceCount + 1);
  }

  logger.info(`Selected ${selected.length} items with diversity constraints`);

  return selected;
}
