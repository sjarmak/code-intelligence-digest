/**
 * Item relevance and admin settings database operations
 */

import { logger } from '../logger';
import { getDbClient } from './driver';

/**
 * Save item relevance rating
 */
export async function saveItemRelevance(
  itemId: string,
  rating: number | null,
  notes?: string
): Promise<void> {
  try {
    const client = await getDbClient();
    const now = Math.floor(Date.now() / 1000);

    await client.run(
      `
      INSERT INTO item_relevance (id, item_id, relevance_rating, notes, rated_at, updated_at)
      VALUES ($1, $2, $3, $4, $5, $5)
      ON CONFLICT (item_id) DO UPDATE SET
        relevance_rating = EXCLUDED.relevance_rating,
        notes = EXCLUDED.notes,
        rated_at = EXCLUDED.rated_at,
        updated_at = EXCLUDED.updated_at
    `,
      [itemId, itemId, rating, notes ?? null, now]
    );

    logger.debug(`Saved relevance rating for item ${itemId}: ${rating}`);
  } catch (error) {
    logger.error(`Failed to save item relevance for ${itemId}`, error);
    throw error;
  }
}

/**
 * Get item relevance rating
 */
export async function getItemRelevance(itemId: string): Promise<{
  rating: number | null;
  notes: string | null;
  ratedAt: number | null;
} | null> {
  try {
    const client = await getDbClient();

    const result = await client.query(
      `SELECT relevance_rating, notes, rated_at FROM item_relevance WHERE item_id = $1`,
      [itemId]
    );
    const row = result.rows[0] as
      | {
          relevance_rating: number | null;
          notes: string | null;
          rated_at: number | null;
        }
      | undefined;

    if (!row) {
      return null;
    }

    return {
      rating: row.relevance_rating,
      notes: row.notes,
      ratedAt: row.rated_at,
    };
  } catch (error) {
    logger.error(`Failed to get item relevance for ${itemId}`, error);
    return null;
  }
}

/**
 * Get admin setting
 */
export async function getAdminSetting(key: string): Promise<string | null> {
  try {
    const client = await getDbClient();

    const result = await client.query(`SELECT value FROM admin_settings WHERE key = $1`, [key]);
    const row = result.rows[0] as { value: string } | undefined;

    return row?.value || null;
  } catch (error) {
    logger.error(`Failed to get admin setting ${key}`, error);
    return null;
  }
}

/**
 * Set admin setting
 */
export async function setAdminSetting(key: string, value: string): Promise<void> {
  try {
    const client = await getDbClient();
    const now = Math.floor(Date.now() / 1000);

    await client.run(
      `
      INSERT INTO admin_settings (key, value, updated_at)
      VALUES ($1, $2, $3)
      ON CONFLICT (key) DO UPDATE SET
        value = EXCLUDED.value,
        updated_at = EXCLUDED.updated_at
    `,
      [key, value, now]
    );

    logger.info(`Updated admin setting ${key} = ${value}`);
  } catch (error) {
    logger.error(`Failed to set admin setting ${key}`, error);
  }
}

/**
 * Check if item relevance tuning is enabled
 */
export async function isItemRelevanceTuningEnabled(): Promise<boolean> {
  const setting = await getAdminSetting('enable_item_relevance_tuning');
  return setting === 'true';
}

/**
 * Enable/disable item relevance tuning
 */
export async function setItemRelevanceTuningEnabled(enabled: boolean): Promise<void> {
  await setAdminSetting('enable_item_relevance_tuning', enabled ? 'true' : 'false');
}

/**
 * Star or unstar an item
 */
export async function starItem(itemId: string, starred: boolean = true): Promise<void> {
  try {
    const client = await getDbClient();
    const now = Math.floor(Date.now() / 1000);

    if (starred) {
      await client.run(
        `
        INSERT INTO starred_items (
          id, item_id, inoreader_item_id, starred_at, created_at, updated_at
        ) VALUES ($1, $2, $3, $4, $4, $4)
        ON CONFLICT (item_id) DO NOTHING
      `,
        [`starred-${itemId}`, itemId, itemId, now]
      );

      logger.debug(`Starred item ${itemId}`);
    } else {
      await client.run(`DELETE FROM starred_items WHERE item_id = $1`, [itemId]);

      logger.debug(`Unstarred item ${itemId}`);
    }
  } catch (error) {
    logger.error(`Failed to update starred status for ${itemId}`, error);
    throw error;
  }
}

/**
 * Check if an item is starred
 */
export async function isItemStarred(itemId: string): Promise<boolean> {
  try {
    const client = await getDbClient();

    const result = await client.query(
      `SELECT id FROM starred_items WHERE item_id = $1 LIMIT 1`,
      [itemId]
    );

    return result.rows.length > 0;
  } catch (error) {
    logger.error(`Failed to check if item is starred ${itemId}`, error);
    return false;
  }
}
