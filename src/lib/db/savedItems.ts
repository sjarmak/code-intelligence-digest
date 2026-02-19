/**
 * Saved items library management
 * General bookmark/save library for any item type
 */

import { getSqlite } from "./index";
import { getDbClient, detectDriver } from "./driver";
import { FeedItem } from "../model";
import { logger } from "../logger";
import { ensureItemExists } from "./items";
import { LEGACY_USER_ID } from "./constants";

export { LEGACY_USER_ID };

/**
 * Add item to saved items library
 */
export async function addToSavedItems(itemId: string, userId: string = LEGACY_USER_ID): Promise<void> {
  try {
    await ensureItemExists(itemId);
    const driver = detectDriver();
    const now = Math.floor(Date.now() / 1000);
    const id = `saved-${userId}-${itemId}`;

    if (driver === 'postgres') {
      const client = await getDbClient();
      await client.run(`
        INSERT INTO saved_items (id, user_id, item_id, saved_at, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $5)
        ON CONFLICT (user_id, item_id) DO UPDATE SET
          saved_at = EXCLUDED.saved_at,
          updated_at = EXCLUDED.updated_at
      `, [id, userId, itemId, now, now]);
    } else {
      const sqlite = getSqlite();
      sqlite.prepare(`
        INSERT INTO saved_items (id, user_id, item_id, saved_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT (user_id, item_id) DO UPDATE SET
          saved_at = excluded.saved_at,
          updated_at = excluded.updated_at
      `).run(id, userId, itemId, now, now, now);
    }

    logger.debug(`Added item ${itemId} to saved items library`);
  } catch (error) {
    logger.error(`Failed to add item ${itemId} to saved items library`, error);
    throw error;
  }
}

/**
 * Add multiple items to saved items library
 */
export async function addMultipleToSavedItems(itemIds: string[], userId: string = LEGACY_USER_ID): Promise<{ success: number; failed: number }> {
  let success = 0;
  let failed = 0;

  for (const itemId of itemIds) {
    try {
      await addToSavedItems(itemId, userId);
      success++;
    } catch (error) {
      logger.error(`Failed to add item ${itemId} to saved items library`, error);
      failed++;
    }
  }

  logger.debug(`Added ${success} items to saved items library (${failed} failed)`);
  return { success, failed };
}

/**
 * Remove item from saved items library
 */
export async function removeFromSavedItems(itemId: string, userId: string = LEGACY_USER_ID): Promise<void> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      await client.run(`
        DELETE FROM saved_items WHERE user_id = $1 AND item_id = $2
      `, [userId, itemId]);
    } else {
      const sqlite = getSqlite();
      sqlite.prepare(`
        DELETE FROM saved_items WHERE user_id = ? AND item_id = ?
      `).run(userId, itemId);
    }

    logger.debug(`Removed item ${itemId} from saved items library`);
  } catch (error) {
    logger.error(`Failed to remove item ${itemId} from saved items library`, error);
    throw error;
  }
}

/**
 * Remove multiple items from saved items library
 */
export async function removeMultipleFromSavedItems(itemIds: string[], userId: string = LEGACY_USER_ID): Promise<void> {
  if (itemIds.length === 0) return;

  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const placeholders = itemIds.map((_, i) => `$${i + 2}`).join(',');
      await client.run(`
        DELETE FROM saved_items WHERE user_id = $1 AND item_id IN (${placeholders})
      `, [userId, ...itemIds]);
    } else {
      const sqlite = getSqlite();
      const placeholders = itemIds.map(() => '?').join(',');
      sqlite.prepare(`
        DELETE FROM saved_items WHERE user_id = ? AND item_id IN (${placeholders})
      `).run(userId, ...itemIds);
    }

    logger.debug(`Removed ${itemIds.length} items from saved items library`);
  } catch (error) {
    logger.error(`Failed to remove items from saved items library`, error);
    throw error;
  }
}

/**
 * Remove all items from saved items library
 */
export async function removeAllFromSavedItems(userId: string = LEGACY_USER_ID): Promise<void> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      await client.run(`DELETE FROM saved_items WHERE user_id = $1`, [userId]);
    } else {
      const sqlite = getSqlite();
      sqlite.prepare(`DELETE FROM saved_items WHERE user_id = ?`).run(userId);
    }

    logger.debug(`Removed all items from saved items library`);
  } catch (error) {
    logger.error(`Failed to remove all items from saved items library`, error);
    throw error;
  }
}

/**
 * Check if item is in saved items library
 */
export async function isInSavedItems(itemId: string, userId: string = LEGACY_USER_ID): Promise<boolean> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(`
        SELECT 1 FROM saved_items WHERE user_id = $1 AND item_id = $2 LIMIT 1
      `, [userId, itemId]);
      return result.rows.length > 0;
    } else {
      const sqlite = getSqlite();
      const result = sqlite.prepare(`
        SELECT 1 FROM saved_items WHERE user_id = ? AND item_id = ? LIMIT 1
      `).get(userId, itemId) as { '1': number } | undefined;
      return !!result;
    }
  } catch (error) {
    logger.error(`Failed to check if item ${itemId} is in saved items library`, error);
    return false;
  }
}

/**
 * Get all saved items
 */
export async function getSavedItems(limit?: number, offset?: number, userId: string = LEGACY_USER_ID): Promise<FeedItem[]> {
  try {
    const driver = detectDriver();
    const { loadItem } = await import("./items");

    if (driver === 'postgres') {
      const client = await getDbClient();
      let sql = `
        SELECT item_id FROM saved_items WHERE user_id = $1
        ORDER BY saved_at DESC
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
    } else {
      const sqlite = getSqlite();
      let sql = `
        SELECT item_id FROM saved_items WHERE user_id = ?
        ORDER BY saved_at DESC
      `;
      const params: unknown[] = [userId];

      if (limit) {
        sql += ` LIMIT ?`;
        params.push(limit);
      }
      if (offset) {
        sql += ` OFFSET ?`;
        params.push(offset);
      }

      const rows = sqlite.prepare(sql).all(...params) as Array<{ item_id: string }>;
      const items: FeedItem[] = [];

      for (const row of rows) {
        const item = await loadItem(row.item_id);
        if (item) {
          items.push(item);
        }
      }

      return items;
    }
  } catch (error) {
    logger.error('Failed to get saved items', error);
    return [];
  }
}
