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

    const id = `relevance_${itemId}_${Date.now()}`;

    sqlite.prepare(`
      INSERT OR REPLACE INTO item_relevance
      (id, item_id, relevance_rating, notes, rated_at, updated_at)
      VALUES (?, ?, ?, ?, strftime('%s', 'now'), strftime('%s', 'now'))
    `).run(id, itemId, rating, notes || null);

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
