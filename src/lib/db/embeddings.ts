/**
 * Item embeddings database operations
 * Cache and retrieve vector embeddings for items
 */

import { getSqlite } from "./index";
import { logger } from "../logger";

/**
 * Save embedding for an item
 */
export async function saveEmbedding(itemId: string, embedding: number[]): Promise<void> {
  try {
    const sqlite = getSqlite();

    sqlite
      .prepare(
        `
      INSERT OR REPLACE INTO item_embeddings 
      (item_id, embedding, generated_at)
      VALUES (?, ?, strftime('%s', 'now'))
    `
      )
      .run(itemId, JSON.stringify(embedding));

    logger.debug(`Saved embedding for item ${itemId}`);
  } catch (error) {
    logger.error(`Failed to save embedding for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Save embeddings for multiple items in batch
 */
export async function saveEmbeddingsBatch(
  embeddings: Array<{ itemId: string; embedding: number[] }>
): Promise<void> {
  try {
    const sqlite = getSqlite();

    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO item_embeddings 
      (item_id, embedding, generated_at)
      VALUES (?, ?, strftime('%s', 'now'))
    `);

    const insertMany = sqlite.transaction((items: Array<{ itemId: string; embedding: number[] }>) => {
      for (const item of items) {
        stmt.run(item.itemId, JSON.stringify(item.embedding));
      }
    });

    insertMany(embeddings);
    logger.info(`Saved ${embeddings.length} embeddings to database`);
  } catch (error) {
    logger.error("Failed to save embeddings batch", error);
    throw error;
  }
}

/**
 * Get embedding for a single item
 */
export async function getEmbedding(itemId: string): Promise<number[] | null> {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT embedding FROM item_embeddings WHERE item_id = ?`)
      .get(itemId) as { embedding: string } | undefined;

    if (!row) {
      return null;
    }

    return JSON.parse(row.embedding) as number[];
  } catch (error) {
    logger.error(`Failed to get embedding for item ${itemId}`, error);
    return null;
  }
}

/**
 * Get embeddings for multiple items
 */
export async function getEmbeddingsBatch(itemIds: string[]): Promise<Map<string, number[]>> {
  try {
    const sqlite = getSqlite();

    const placeholders = itemIds.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `SELECT item_id, embedding FROM item_embeddings WHERE item_id IN (${placeholders})`
      )
      .all(...itemIds) as Array<{ item_id: string; embedding: string }>;

    const result = new Map<string, number[]>();
    for (const row of rows) {
      result.set(row.item_id, JSON.parse(row.embedding) as number[]);
    }

    return result;
  } catch (error) {
    logger.error("Failed to get embeddings batch", error);
    return new Map();
  }
}

/**
 * Check if embedding exists for an item
 */
export async function hasEmbedding(itemId: string): Promise<boolean> {
  try {
    const sqlite = getSqlite();

    const row = sqlite
      .prepare(`SELECT 1 FROM item_embeddings WHERE item_id = ?`)
      .get(itemId);

    return !!row;
  } catch (error) {
    logger.error(`Failed to check embedding existence for item ${itemId}`, error);
    return false;
  }
}

/**
 * Get count of cached embeddings
 */
export async function getEmbeddingsCount(): Promise<number> {
  try {
    const sqlite = getSqlite();

    const result = sqlite
      .prepare(`SELECT COUNT(*) as count FROM item_embeddings`)
      .get() as { count: number } | undefined;

    return result?.count ?? 0;
  } catch (error) {
    logger.error("Failed to get embeddings count", error);
    return 0;
  }
}

/**
 * Delete embedding for an item (for invalidation)
 */
export async function deleteEmbedding(itemId: string): Promise<void> {
  try {
    const sqlite = getSqlite();

    sqlite.prepare(`DELETE FROM item_embeddings WHERE item_id = ?`).run(itemId);

    logger.debug(`Deleted embedding for item ${itemId}`);
  } catch (error) {
    logger.error(`Failed to delete embedding for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Clear all embeddings (for cache invalidation)
 */
export async function clearAllEmbeddings(): Promise<void> {
  try {
    const sqlite = getSqlite();

    sqlite.exec(`DELETE FROM item_embeddings`);

    logger.info("Cleared all embeddings from database");
  } catch (error) {
    logger.error("Failed to clear all embeddings", error);
    throw error;
  }
}
