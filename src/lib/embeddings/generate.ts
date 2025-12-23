/**
 * Embedding generation
 * Generates 1536-dimensional embeddings using OpenAI text-embedding-3-small
 * Falls back to pseudo-embeddings if API key is not available
 */

import OpenAI from "openai";
import { logger } from "../logger";

/**
 * Get or create OpenAI client for embeddings
 */
function getOpenAIClient(): OpenAI | null {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return null;
  }
  return new OpenAI({ apiKey });
}

/**
 * Generate embedding for text
 * Uses OpenAI text-embedding-3-small (1536 dimensions) if available
 * Falls back to pseudo-embeddings (768 dimensions) if API key is missing
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  try {
    if (!text || text.trim().length === 0) {
      logger.warn("Attempted to generate embedding for empty text");
      return Array(1536).fill(0); // Return zero vector for empty input
    }

    const client = getOpenAIClient();

    // Try OpenAI embeddings first
    if (client) {
      try {
        const response = await client.embeddings.create({
          model: "text-embedding-3-small",
          input: text.substring(0, 8000), // OpenAI has max 8192 tokens, truncate to be safe
        });

        const embedding = response.data[0].embedding;
        if (embedding && embedding.length > 0) {
          logger.debug(`Generated OpenAI embedding: ${embedding.length} dimensions`);
          return embedding;
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        logger.warn("OpenAI embedding generation failed, falling back to pseudo-embeddings", {
          error: errorMsg,
        });
        // Fall through to pseudo-embeddings
      }
    } else {
      logger.debug("OPENAI_API_KEY not set, using pseudo-embeddings");
    }

    // Fallback to pseudo-embeddings (pad to 1536 dimensions for consistency)
    const pseudoEmbedding = generatePseudoEmbedding(text);
    // Pad from 768 to 1536 dimensions by duplicating and scaling
    const paddedEmbedding = new Array(1536);
    for (let i = 0; i < 1536; i++) {
      paddedEmbedding[i] = pseudoEmbedding[i % 768] * (i < 768 ? 1 : 0.5);
    }
    return paddedEmbedding;
  } catch (error) {
    logger.error("Failed to generate embedding", { error, textLength: text.length });
    // Return zero vector on error
    return Array(1536).fill(0);
  }
}

/**
 * Generate a pseudo-embedding for fallback (hash-based, not semantic)
 * This ensures consistent vectors for the same text but no semantic meaning
 * Returns 768 dimensions (will be padded to 1536 by caller)
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
 * Uses OpenAI batch API when available (up to 2048 items per request)
 * Falls back to individual requests if batching fails
 */
export async function generateEmbeddingsBatch(
  items: Array<{ id: string; text: string }>
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();

  if (items.length === 0) {
    return embeddings;
  }

  const client = getOpenAIClient();

  // Use OpenAI batch API if available
  if (client) {
    try {
      // OpenAI supports up to 2048 inputs per batch, but we'll use smaller batches for reliability
      const batchSize = 100; // Conservative batch size

      for (let i = 0; i < items.length; i += batchSize) {
        const batch = items.slice(i, Math.min(i + batchSize, items.length));

        try {
          // Prepare inputs (truncate to 8000 chars each)
          const inputs = batch.map(item => item.text.substring(0, 8000));

          const response = await client.embeddings.create({
            model: "text-embedding-3-small",
            input: inputs,
          });

          // Map responses back to item IDs
          for (let j = 0; j < batch.length; j++) {
            const embedding = response.data[j]?.embedding;
            if (embedding && embedding.length > 0) {
              embeddings.set(batch[j].id, embedding);
            } else {
              logger.warn(`Empty embedding for item ${batch[j].id}, using fallback`);
              embeddings.set(batch[j].id, Array(1536).fill(0));
            }
          }

          logger.info(`Generated OpenAI embeddings: ${Math.min(i + batchSize, items.length)}/${items.length}`);
        } catch (error) {
          // If batch fails, fall back to individual requests
          logger.warn("Batch embedding failed, falling back to individual requests", {
            error: error instanceof Error ? error.message : String(error),
          });

          for (const item of batch) {
            try {
              const embedding = await generateEmbedding(item.text);
              embeddings.set(item.id, embedding);
            } catch (err) {
              logger.warn(`Failed to generate embedding for item ${item.id}`, { error: err });
              embeddings.set(item.id, Array(1536).fill(0));
            }
          }
        }
      }

      return embeddings;
    } catch (error) {
      logger.warn("OpenAI batch embedding failed, using individual requests", {
        error: error instanceof Error ? error.message : String(error),
      });
      // Fall through to individual requests
    }
  }

  // Fallback: individual requests (or if no API key)
  const batchSize = 5; // Smaller batch size for fallback
  logger.info(`Generating embeddings for ${items.length} items (batch size: ${batchSize})`);

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, Math.min(i + batchSize, items.length));

    const promises = batch.map(async (item) => {
      try {
        const embedding = await generateEmbedding(item.text);
        embeddings.set(item.id, embedding);
      } catch (error) {
        logger.warn(`Failed to generate embedding for item ${item.id}`, { error });
        embeddings.set(item.id, Array(1536).fill(0));
      }
    });

    await Promise.all(promises);

    // Log progress
    const processed = Math.min(i + batchSize, items.length);
    logger.info(`Generated embeddings: ${processed}/${items.length}`);
  }

  return embeddings;
}
