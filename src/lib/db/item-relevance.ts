/**
 * Item relevance and admin settings database operations
 */

import { getSqlite } from './index';
import { logger } from '../logger';

/**
 * Save item relevance rating
 */
export async function saveItemRelevance(
  itemId: string,
  rating: number | null,
  notes?: string
): Promise<void> {
  try {
    const sqlite = getSqlite();

    // Use item_id as the unique identifier for replacement
    // This ensures updates actually replace existing records
    sqlite.prepare(`
      INSERT OR REPLACE INTO item_relevance
      (id, item_id, relevance_rating, notes, rated_at, updated_at)
      VALUES (?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
    `).run(itemId, itemId, rating, notes || null);

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
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT relevance_rating, notes, rated_at FROM item_relevance WHERE item_id = ?`)
      .get(itemId) as {
        relevance_rating: number | null;
        notes: string | null;
        rated_at: number | null;
      } | undefined;

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
export function getAdminSetting(key: string): string | null {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT value FROM admin_settings WHERE key = ?`)
      .get(key) as { value: string } | undefined;

    return row?.value || null;
  } catch (error) {
    logger.error(`Failed to get admin setting ${key}`, error);
    return null;
  }
}

/**
 * Set admin setting
 */
export function setAdminSetting(key: string, value: string): void {
  try {
    const sqlite = getSqlite();

    sqlite.prepare(`
      INSERT OR REPLACE INTO admin_settings (key, value, updated_at)
      VALUES (?, ?, strftime('%s', 'now'))
    `).run(key, value);

    logger.info(`Updated admin setting ${key} = ${value}`);
  } catch (error) {
    logger.error(`Failed to set admin setting ${key}`, error);
  }
}

/**
 * Check if item relevance tuning is enabled
 */
export function isItemRelevanceTuningEnabled(): boolean {
  const setting = getAdminSetting('enable_item_relevance_tuning');
  return setting === 'true';
}

/**
 * Enable/disable item relevance tuning
 */
export function setItemRelevanceTuningEnabled(enabled: boolean): void {
  setAdminSetting('enable_item_relevance_tuning', enabled ? 'true' : 'false');
}

/**
 * Star or unstar an item
 */
export async function starItem(itemId: string, starred: boolean = true): Promise<void> {
  try {
    const sqlite = getSqlite();

    if (starred) {
      // Insert into starred_items table
      sqlite.prepare(`
        INSERT OR IGNORE INTO starred_items
        (id, item_id, inoreader_item_id, starred_at, created_at, updated_at)
        VALUES (?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'), strftime('%s', 'now'))
      `).run(itemId, itemId, itemId);

      logger.debug(`Starred item ${itemId}`);
    } else {
      // Remove from starred_items table
      sqlite.prepare(`
        DELETE FROM starred_items WHERE item_id = ?
      `).run(itemId);

      logger.debug(`Unstarred item ${itemId}`);
    }
  } catch (error) {
    logger.error(`Failed to update starred status for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Check if an item is starred
 */
export async function isItemStarred(itemId: string): Promise<boolean> {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT id FROM starred_items WHERE item_id = ? LIMIT 1`)
      .get(itemId) as { id: string } | undefined;

    return !!row;
  } catch (error) {
    logger.error(`Failed to check if item is starred ${itemId}`, error);
    return false;
  }
}
