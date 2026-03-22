/**
 * Digest selections database operations
 * Track which items were selected for final digests and why
 */

import { logger } from "../logger";
import { getDbClient } from "./driver";

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
    const client = await getDbClient();
    for (let i = 0; i < selections.length; i++) {
      const item = selections[i];
      const id = `${item.category}_${item.period}_${item.rank}_${Date.now()}_${i}`;
      await client.run(
        `
        INSERT INTO digest_selections
        (id, item_id, category, period, rank, diversity_reason)
        VALUES ($1, $2, $3, $4, $5, $6)
      `,
        [
          id,
          item.itemId,
          item.category,
          item.period,
          item.rank,
          item.diversityReason || null,
        ],
      );
    }
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
    const client = await getDbClient();
    const result = await client.query(
      `
      SELECT * FROM digest_selections
      WHERE category = $1 AND period = $2
      ORDER BY rank ASC
    `,
      [category, period],
    );

    const rows = result.rows as Array<{
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
    const client = await getDbClient();

    const totalRes = await client.query(
      `SELECT COUNT(*)::int as count FROM digest_selections WHERE period = $1`,
      [period],
    );
    const totalRow = totalRes.rows[0] as { count: number } | undefined;

    const byCategoryRes = await client.query(
      `
      SELECT category, COUNT(*)::int as count
      FROM digest_selections
      WHERE period = $1
      GROUP BY category
    `,
      [period],
    );
    const byCategory = byCategoryRes.rows as Array<{ category: string; count: number }>;

    return {
      totalSelected: totalRow?.count ?? 0,
      byCategory: Object.fromEntries(byCategory.map((r) => [r.category, r.count])),
    };
  } catch (error) {
    logger.error(`Failed to get selection stats for period ${period}`, error);
    return { totalSelected: 0, byCategory: {} };
  }
}
