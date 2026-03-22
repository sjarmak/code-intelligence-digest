/**
 * Embedding database operations
 * Store and retrieve embeddings from PostgreSQL (pgvector)
 */

import { getDbClient } from "./driver";
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

    

      // PostgreSQL: use vector type
      const client = await getDbClient();

      for (const item of itemsToSave) {
        // Validate and normalize dimensions
        let embedding = item.embedding;
        if (embedding.length !== 1536) {
          if (embedding.length === 768) {
            // Pad 768-dim embeddings to 1536
            logger.warn(`Padding 768-dim embedding to 1536 for item ${item.itemId}`);
            embedding = new Array(1536);
            for (let i = 0; i < 1536; i++) {
              embedding[i] = item.embedding[i % 768] * (i < 768 ? 1 : 0.5);
            }
          } else {
            logger.error(`Invalid embedding dimension (${embedding.length}) for item ${item.itemId}, skipping`);
            continue;
          }
        }

        // Format vector as string for Postgres: "[0.1,0.2,...]"
        const vectorStr = `[${embedding.join(',')}]`;
        await client.run(
          `INSERT INTO item_embeddings (item_id, embedding, generated_at)
           VALUES ($1, $2::vector, EXTRACT(EPOCH FROM NOW())::INTEGER)
           ON CONFLICT (item_id) DO UPDATE SET
             embedding = $2::vector,
             generated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
          [item.itemId, vectorStr]
        );
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
    const embeddings = new Map<string, number[]>();

    

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
    const client = await getDbClient();
    const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(',');
    const result = await client.query(
      `SELECT DISTINCT item_id FROM item_embeddings WHERE item_id IN (${placeholders})`,
      itemIds
    );
    const existingIds = new Set(result.rows.map((r) => r.item_id as string));


    const out = new Map<string, boolean>();
    for (const itemId of itemIds) {
      out.set(itemId, existingIds.has(itemId));
    }

    return out;
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

    const client = await getDbClient();
    const placeholders = itemIds.map((_, i) => `$${i + 1}`).join(",");
    await client.run(`DELETE FROM item_embeddings WHERE item_id IN (${placeholders})`, itemIds);

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

    

      const client = await getDbClient();
      const result = await client.query('SELECT COUNT(*) as count FROM item_embeddings');
      return parseInt(result.rows[0]?.count as string) || 0;
    

  } catch (error) {
    // Return 0 on error (table doesn't exist or query failed)
    return 0;
  }
}
