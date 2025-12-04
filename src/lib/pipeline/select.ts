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
 * Apply diversity constraints:
 * - Per-source cap: max N items per source per category
 * - Total cap: max CATEGORY_CONFIG[category].maxItems
 */
export function selectWithDiversity(
  rankedItems: RankedItem[],
  category: Category,
  maxPerSource: number = 2
): SelectionResult {
  const config = getCategoryConfig(category);
  const selected: RankedItem[] = [];
  const sourceCount = new Map<string, number>();
  const reasons = new Map<string, string>();

  for (const item of rankedItems) {
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
    if (selected.length >= config.maxItems) {
      const reason = `Total category limit reached (${selected.length}/${config.maxItems})`;
      logger.debug(
        `Reached max items limit (${config.maxItems}) for category ${category}`
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
