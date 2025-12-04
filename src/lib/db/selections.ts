/**
 * Digest selections database operations
 * Track which items were selected for final digests and why
 */

import { getSqlite } from "./index";
import { logger } from "../logger";

export interface DigestSelection {
  id: string;
  itemId: string;
  category: string;
  period: string; // "week" or "month"
  rank: number; // Position in final digest
  diversityReason?: string; // Why it was selected or excluded
  selectedAt: number;
}

/**
 * Save digest selections (items that made it to final digest)
 */
export async function saveDigestSelections(
  selections: Array<{
    itemId: string;
    category: string;
    period: string;
    rank: number;
    diversityReason?: string;
  }>
): Promise<void> {
  try {
    const sqlite = getSqlite();

    const stmt = sqlite.prepare(`
      INSERT INTO digest_selections 
      (id, item_id, category, period, rank, diversity_reason)
      VALUES (?, ?, ?, ?, ?, ?)
    `);

    const insertMany = sqlite.transaction(
      (
        items: Array<{
          itemId: string;
          category: string;
          period: string;
          rank: number;
          diversityReason?: string;
        }>
      ) => {
        for (let i = 0; i < items.length; i++) {
          const item = items[i];
          const id = `${item.category}_${item.period}_${item.rank}_${Date.now()}_${i}`;
          stmt.run(
            id,
            item.itemId,
            item.category,
            item.period,
            item.rank,
            item.diversityReason || null
          );
        }
      }
    );

    insertMany(selections);
    logger.info(`Saved ${selections.length} digest selections to database`);
  } catch (error) {
    logger.error("Failed to save digest selections", error);
    throw error;
  }
}

/**
 * Get all selections for a category and period
 */
export async function getDigestSelections(
  category: string,
  period: string
): Promise<DigestSelection[]> {
  try {
    const sqlite = getSqlite();

    const rows = sqlite
      .prepare(
        `
      SELECT * FROM digest_selections 
      WHERE category = ? AND period = ?
      ORDER BY rank ASC
    `
      )
      .all(category, period) as Array<{
      id: string;
      item_id: string;
      category: string;
      period: string;
      rank: number;
      diversity_reason: string | null;
      selected_at: number;
    }>;

    return rows.map((row) => ({
      id: row.id,
      itemId: row.item_id,
      category: row.category,
      period: row.period,
      rank: row.rank,
      diversityReason: row.diversity_reason || undefined,
      selectedAt: row.selected_at,
    }));
  } catch (error) {
    logger.error(
      `Failed to get digest selections for ${category}/${period}`,
      error
    );
    return [];
  }
}

/**
 * Get selection statistics for a period
 */
export async function getSelectionStats(period: string): Promise<{
  totalSelected: number;
  byCategory: Record<string, number>;
}> {
  try {
    const sqlite = getSqlite();

    const totalRow = sqlite
      .prepare(`SELECT COUNT(*) as count FROM digest_selections WHERE period = ?`)
      .get(period) as { count: number } | undefined;

    const byCategory = sqlite
      .prepare(
        `
      SELECT category, COUNT(*) as count 
      FROM digest_selections 
      WHERE period = ? 
      GROUP BY category
    `
      )
      .all(period) as Array<{ category: string; count: number }>;

    return {
      totalSelected: totalRow?.count ?? 0,
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r.count])),
    };
  } catch (error) {
    logger.error(`Failed to get selection stats for period ${period}`, error);
    return { totalSelected: 0, byCategory: {} };
  }
}
