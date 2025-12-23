/**
 * Embedding database operations
 * Store and retrieve embeddings from SQLite (dev) or PostgreSQL (prod)
 */

import { getSqlite } from "./index";
import { detectDriver, getDbClient } from "./driver";
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
    if (itemsToSave.length === 0) {
      return;
    }

    const driver = detectDriver();

    if (driver === 'postgres') {
      // PostgreSQL: use vector type
      const client = await getDbClient();

      for (const item of itemsToSave) {
        // Format vector as string for Postgres: "[0.1,0.2,...]"
        const vectorStr = `[${item.embedding.join(',')}]`;
        await client.run(
          `INSERT INTO item_embeddings (item_id, embedding, generated_at)
           VALUES ($1, $2::vector, EXTRACT(EPOCH FROM NOW())::INTEGER)
           ON CONFLICT (item_id) DO UPDATE SET
             embedding = $2::vector,
             generated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
          [item.itemId, vectorStr]
        );
      }
    } else {
      // SQLite: use BLOB
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
    }

    logger.info(`Saved ${itemsToSave.length} embeddings to database`);
  } catch (error) {
    logger.error("Failed to save embeddings to database", error);
    // Don't throw - allow search to continue without embeddings
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

    const driver = detectDriver();
    const embeddings = new Map<string, number[]>();

    if (driver === 'postgres') {
      // PostgreSQL: use vector type
      const client = await getDbClient();
      const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
      const sql = `
        SELECT item_id, embedding::text
        FROM item_embeddings
        WHERE item_id IN (${placeholders})
      `;

      const result = await client.query(sql, itemIds);
      for (const row of result.rows) {
        try {
          // Postgres returns vector as string like "[0.1,0.2,...]"
          const vectorStr = row.embedding as string;
          const vector = JSON.parse(vectorStr) as number[];
          embeddings.set(row.item_id as string, vector);
        } catch (e) {
          const errorMsg = e instanceof Error ? e.message : String(e);
          logger.warn(`Failed to parse embedding for item ${row.item_id}`, { error: errorMsg });
        }
      }
    } else {
      // SQLite: use BLOB
      const sqlite = getSqlite();
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

      for (const row of rows) {
        embeddings.set(row.item_id, decodeEmbedding(row.embedding));
      }
    }

    logger.info(`Retrieved ${embeddings.size}/${itemIds.length} embeddings from database`);
    return embeddings;
  } catch (error) {
    // Handle gracefully: if table doesn't exist or query fails, return empty map
    // This allows search to continue with BM25 only
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('no such table') || errorMsg.includes('does not exist')) {
      logger.warn("Embeddings table not found, semantic search will be disabled. Search will use BM25 only.");
    } else {
      logger.warn("Failed to load embeddings from database, falling back to BM25-only search", { error: errorMsg });
    }
    return new Map();
  }
}

/**
 * Get embedding for a single item
 */
export async function getEmbedding(itemId: string): Promise<number[] | null> {
  try {
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query(
        'SELECT embedding::text FROM item_embeddings WHERE item_id = $1',
        [itemId]
      );
      if (result.rows.length === 0) {
        return null;
      }
      const vectorStr = result.rows[0].embedding as string;
      return JSON.parse(vectorStr) as number[];
    } else {
      const sqlite = getSqlite();
      const row = sqlite
        .prepare("SELECT embedding FROM item_embeddings WHERE item_id = ?")
        .get(itemId) as { embedding: Buffer } | undefined;

      if (!row) {
        return null;
      }

      return decodeEmbedding(row.embedding);
    }
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    if (errorMsg.includes('no such table') || errorMsg.includes('does not exist')) {
      return null;
    }
    logger.warn(`Failed to load embedding for item ${itemId}`, { error: errorMsg });
    return null;
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

    const driver = detectDriver();
    let existingIds: Set<string>;

    if (driver === 'postgres') {
      const client = await getDbClient();
      const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
      const result = await client.query(
        `SELECT DISTINCT item_id FROM item_embeddings WHERE item_id IN (${placeholders})`,
        itemIds
      );
      existingIds = new Set(result.rows.map((r) => r.item_id as string));
    } else {
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
      existingIds = new Set(rows.map((r) => r.item_id));
    }

    const result = new Map<string, boolean>();
    for (const itemId of itemIds) {
      result.set(itemId, existingIds.has(itemId));
    }

    return result;
  } catch (error) {
    // Return all false on error (assume no embeddings exist)
    const result = new Map<string, boolean>();
    for (const itemId of itemIds) {
      result.set(itemId, false);
    }
    return result;
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
    const driver = detectDriver();

    if (driver === 'postgres') {
      const client = await getDbClient();
      const result = await client.query('SELECT COUNT(*) as count FROM item_embeddings');
      return parseInt(result.rows[0]?.count as string) || 0;
    } else {
      const sqlite = getSqlite();
      const result = sqlite
        .prepare("SELECT COUNT(*) as count FROM item_embeddings")
        .get() as { count: number } | undefined;
      return result?.count ?? 0;
    }
  } catch (error) {
    // Return 0 on error (table doesn't exist or query failed)
    return 0;
  }
}
