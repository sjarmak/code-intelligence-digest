/**
 * Digest items library management
 * Items specifically marked for digest generation
 */

import { getDbClient } from "./driver";
import { FeedItem } from "../model";
import { logger } from "../logger";
import { ensureItemExists } from "./items";
import { LEGACY_USER_ID } from "./constants";

export { LEGACY_USER_ID };

/**
 * Add item to digest items library
 */
export async function addToDigestItems(itemId: string, userId: string = LEGACY_USER_ID): Promise<void> {
  try {
    // Ensure item exists (creates synthetic item if needed)
    await ensureItemExists(itemId);
    const now = Math.floor(Date.now() / 1000);
    // Id must be unique per (user, item) so different users can add the same item
    const id = `digest-${userId}-${itemId}`.replace(/[^a-zA-Z0-9\-_.]/g, '_');

    

      const client = await getDbClient();
      await client.run(`
        INSERT INTO digest_items (id, user_id, item_id, added_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, item_id) DO UPDATE SET
          added_at = EXCLUDED.added_at,
          updated_at = EXCLUDED.updated_at
      `, [id, userId, itemId, now, now, now]);
    


    logger.debug(`Added item ${itemId} to digest items library`);
  } catch (error) {
    logger.error(`Failed to add item ${itemId} to digest items library`, error);
    throw error;
  }
}

/**
 * Add multiple items to digest items library
 */
export async function addMultipleToDigestItems(itemIds: string[], userId: string = LEGACY_USER_ID): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const itemId of itemIds) {
    try {
      await addToDigestItems(itemId, userId);
      success++;
    } catch (error) {
      logger.error(`Failed to add item ${itemId} to digest items library`, error);
      failed++;
    }
  }

  logger.debug(`Added ${success} items to digest items library (${failed} failed)`);
  return { success, failed };
}

/**
 * Remove item from digest items library
 */
export async function removeFromDigestItems(itemId: string, userId: string = LEGACY_USER_ID): Promise<void> {
  try {

    

      const client = await getDbClient();
      await client.run(`
        DELETE FROM digest_items WHERE user_id = $1 AND item_id = $2
      `, [userId, itemId]);
    


    logger.debug(`Removed item ${itemId} from digest items library`);
  } catch (error) {
    logger.error(`Failed to remove item ${itemId} from digest items library`, error);
    throw error;
  }
}

/**
 * Remove multiple items from digest items library
 */
export async function removeMultipleFromDigestItems(itemIds: string[], userId: string = LEGACY_USER_ID): Promise<void> {
  if (itemIds.length === 0) {
    return;
  }

  try {

    

      const client = await getDbClient();
      const placeholders = itemIds.map((_, i) => `$${i + 2}`).join(',');
      await client.run(`
        DELETE FROM digest_items WHERE user_id = $1 AND item_id IN (${placeholders})
      `, [userId, ...itemIds]);
    


    logger.debug(`Removed ${itemIds.length} items from digest items library`);
  } catch (error) {
    logger.error(`Failed to remove items from digest items library`, error);
    throw error;
  }
}

/**
 * Remove all items from digest items library
 */
export async function removeAllFromDigestItems(userId: string = LEGACY_USER_ID): Promise<void> {
  try {

    

      const client = await getDbClient();
      await client.run(`DELETE FROM digest_items WHERE user_id = $1`, [userId]);
    


    logger.debug(`Removed all items from digest items library`);
  } catch (error) {
    logger.error(`Failed to remove all items from digest items library`, error);
    throw error;
  }
}

/**
 * Get count of digest items for a user (lightweight, no item load).
 */
export async function getDigestItemsCount(userId: string = LEGACY_USER_ID): Promise<number> {
  try {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT COUNT(*) AS n FROM digest_items WHERE user_id = $1`,
        [userId]
      );
      const row = result.rows[0] as { n: string } | undefined;
      return row ? parseInt(String(row.n), 10) : 0;
  } catch (error) {
    logger.error("Failed to get digest items count", error);
    return 0;
  }
}

/**
 * Check if item is in digest items library
 */
export async function isInDigestItems(itemId: string, userId: string = LEGACY_USER_ID): Promise<boolean> {
  try {

    

      const client = await getDbClient();
      const result = await client.query(`
        SELECT 1 FROM digest_items WHERE user_id = $1 AND item_id = $2 LIMIT 1
      `, [userId, itemId]);
      return result.rows.length > 0;
    

  } catch (error) {
    logger.error(`Failed to check if item ${itemId} is in digest items library`, error);
    return false;
  }
}

/**
 * Get all digest items
 */
export async function getDigestItems(limit?: number, offset?: number, userId: string = LEGACY_USER_ID): Promise<FeedItem[]> {
  try {
    const { loadItem } = await import("./items");

    

      const client = await getDbClient();
      let sql = `
        SELECT item_id FROM digest_items
        WHERE user_id = $1
        ORDER BY added_at DESC
      `;
      const params: unknown[] = [userId];

      if (limit) {
        sql += ` LIMIT $${params.length + 1}`;
        params.push(limit);
      }
      if (offset) {
        sql += ` OFFSET $${params.length + 1}`;
        params.push(offset);
      }

      const result = await client.query(sql, params);
      const items: FeedItem[] = [];

      for (const row of result.rows) {
        const itemId = (row as { item_id: string }).item_id;
        const item = await loadItem(itemId);
        if (item) {
          items.push(item);
        }
      }

      return items;
    

  } catch (error) {
    logger.error('Failed to get digest items', error);
    return [];
  }
}
