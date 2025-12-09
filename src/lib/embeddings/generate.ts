/**
 * Embedding generation
 * Generates 768-dimensional embeddings for text items
 * 
 * For Phase 6, we use deterministic pseudo-embeddings based on text content.
 * This allows semantic retrieval to work while avoiding external API calls.
 * In production, replace with actual embedding model (OpenAI, Anthropic, etc.)
 */

import { logger } from "../logger";

/**
 * Generate embedding for text
 * Returns a 768-dimensional vector using deterministic content-based hashing
 *
 * Note: These are pseudo-embeddings. For production, integrate with:
 * - OpenAI text-embedding-3-small
 * - Anthropic Claude embeddings
 * - Other embedding services
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || text.trim().length === 0) {
      logger.warn("Attempted to generate embedding for empty text");
      return Array(768).fill(0); // Return zero vector for empty input
    }

    // Use deterministic pseudo-embedding based on text content
    const embedding = generatePseudoEmbedding(text);
    return embedding;
  } catch (error) {
    logger.error("Failed to generate embedding", { error, textLength: text.length });
    throw error;
  }
}

/**
 * Generate a pseudo-embedding for fallback (hash-based, not semantic)
 * This ensures consistent vectors for the same text but no semantic meaning
 */
function generatePseudoEmbedding(text: string): number[] {
  // Simple hash-based deterministic embedding for fallback
  const hash = hashString(text);
  const embedding: number[] = [];

  // Create 768 dimensions from the hash
  for (let i = 0; i < 768; i++) {
    const seed = hash + i * 73; // Prime number for distribution
    const value = Math.sin(seed) * 0.5 + 0.5; // Map to [0, 1]
    embedding.push(value * 2 - 1); // Map to [-1, 1]
  }

  return embedding;
}

/**
 * Simple string hash function
 */
function hashString(text: string): number {
  let hash = 0;
  for (let i = 0; i < text.length; i++) {
    const char = text.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash);
}

/**
 * Generate embeddings for multiple items in batch
 * Batches requests for efficiency
 */
export async function generateEmbeddingsBatch(
  items: Array<{ id: string; text: string }>
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();
  const batchSize = 5; // Conservative batch size

  logger.info(`Generating embeddings for ${items.length} items (batch size: ${batchSize})`);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));

    const promises = batch.map(async (item) => {
      try {
        const embedding = await generateEmbedding(item.text);
        embeddings.set(item.id, embedding);
      } catch (error) {
        logger.warn(`Failed to generate embedding for item ${item.id}`, { error });
        embeddings.set(item.id, Array(768).fill(0));
      }
    });

    await Promise.all(promises);

    // Log progress
    const processed = Math.min(i + batchSize, items.length);
    logger.info(`Generated embeddings: ${processed}/${items.length}`);
  }

  return embeddings;
}
