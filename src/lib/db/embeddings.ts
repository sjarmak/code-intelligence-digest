/**
 * Embedding database operations
 * Store and retrieve embeddings from SQLite
 */

import { getSqlite } from "./index";
import { encodeEmbedding, decodeEmbedding } from "../embeddings";
import { logger } from "../logger";

/**
 * Save embeddings to database
 */
export async function saveEmbeddingsBatch(
  itemsToSave: Array<{
    itemId: string;
    embedding: number[];
  }>
): Promise<void> {
  try {
    const sqlite = getSqlite();

    const stmt = sqlite.prepare(`
      INSERT OR REPLACE INTO item_embeddings 
      (item_id, embedding, generated_at)
      VALUES (?, ?, strftime('%s', 'now'))
    `);

    const insertMany = sqlite.transaction(
      (items: Array<{ itemId: string; embedding: number[] }>) => {
        for (const item of items) {
          const buffer = encodeEmbedding(item.embedding);
          stmt.run(item.itemId, buffer);
        }
      }
    );

    insertMany(itemsToSave);
    logger.info(`Saved ${itemsToSave.length} embeddings to database`);
  } catch (error) {
    logger.error("Failed to save embeddings to database", error);
    throw error;
  }
}

/**
 * Load embeddings for specific items
 */
export async function getEmbeddingsBatch(itemIds: string[]): Promise<Map<string, number[]>> {
  try {
    if (itemIds.length === 0) {
      return new Map();
    }

    const sqlite = getSqlite();

    // Get embeddings for requested items
    const placeholders = itemIds.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `
      SELECT item_id, embedding
      FROM item_embeddings
      WHERE item_id IN (${placeholders})
    `
      )
      .all(...itemIds) as Array<{
      item_id: string;
      embedding: Buffer;
    }>;

    const embeddings = new Map<string, number[]>();
    for (const row of rows) {
      embeddings.set(row.item_id, decodeEmbedding(row.embedding));
    }

    logger.info(`Retrieved ${embeddings.size}/${itemIds.length} embeddings from database`);
    return embeddings;
  } catch (error) {
    logger.error("Failed to load embeddings from database", error);
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
      .prepare("SELECT embedding FROM item_embeddings WHERE item_id = ?")
      .get(itemId) as { embedding: Buffer } | undefined;

    if (!row) {
      return null;
    }

    return decodeEmbedding(row.embedding);
  } catch (error) {
    logger.error(`Failed to load embedding for item ${itemId}`, error);
    throw error;
  }
}

/**
 * Check if embeddings exist for items
 */
export async function hasEmbeddings(itemIds: string[]): Promise<Map<string, boolean>> {
  try {
    if (itemIds.length === 0) {
      return new Map();
    }

    const sqlite = getSqlite();

    const placeholders = itemIds.map(() => "?").join(",");
    const rows = sqlite
      .prepare(
        `
      SELECT DISTINCT item_id
      FROM item_embeddings
      WHERE item_id IN (${placeholders})
    `
      )
      .all(...itemIds) as Array<{ item_id: string }>;

    const existingIds = new Set(rows.map((r) => r.item_id));

    const result = new Map<string, boolean>();
    for (const itemId of itemIds) {
      result.set(itemId, existingIds.has(itemId));
    }

    return result;
  } catch (error) {
    logger.error("Failed to check embeddings existence", error);
    throw error;
  }
}

/**
 * Delete embeddings for items
 */
export async function deleteEmbeddings(itemIds: string[]): Promise<void> {
  try {
    if (itemIds.length === 0) {
      return;
    }

    const sqlite = getSqlite();

    const placeholders = itemIds.map(() => "?").join(",");
    sqlite
      .prepare(
        `
      DELETE FROM item_embeddings
      WHERE item_id IN (${placeholders})
    `
      )
      .run(...itemIds);

    logger.info(`Deleted embeddings for ${itemIds.length} items`);
  } catch (error) {
    logger.error("Failed to delete embeddings", error);
    throw error;
  }
}

/**
 * Get count of embeddings in database
 */
export async function getEmbeddingsCount(): Promise<number> {
  try {
    const sqlite = getSqlite();

    const result = sqlite
      .prepare("SELECT COUNT(*) as count FROM item_embeddings")
      .get() as { count: number } | undefined;

    return result?.count ?? 0;
  } catch (error) {
    logger.error("Failed to get embeddings count", error);
    throw error;
  }
}
