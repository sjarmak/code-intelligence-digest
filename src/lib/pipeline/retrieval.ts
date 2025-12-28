/**
 * Retrieval pipeline
 * Uses embeddings to find relevant items for questions
 */

import { FeedItem, RankedItem, Category } from "../model";
import { generateEmbedding, generateEmbeddingsBatch } from "../embeddings/generate";
import { getEmbeddingsBatch, saveEmbeddingsBatch } from "../db/embeddings";
import { topKSimilar } from "../embeddings";
import { rankCategory } from "./rank";
import { logger } from "../logger";

/**
 * Retrieve relevant items using semantic similarity
 * 1. Generate query embedding
 * 2. Get all item embeddings (generate if missing)
 * 3. Find top-K by cosine similarity
 * 4. Rank using hybrid scoring pipeline
 */
export async function retrieveRelevantItems(
  query: string,
  items: FeedItem[],
  category: Category,
  periodDays: number,
  limit: number = 5
): Promise<RankedItem[]> {
  if (items.length === 0) {
    logger.warn("No items to retrieve from");
    return [];
  }

  logger.info(
    `Retrieving relevant items for query: "${query}" (${items.length} items, category: ${category})`
  );

  try {
    // Step 1: Generate query embedding
    logger.info(`Generating embedding for query: "${query}"`);
    const queryEmbedding = await generateEmbedding(query);

    // Step 2: Get cached embeddings or generate new ones
    const itemIds = items.map((item) => item.id);
    logger.info(`Loading embeddings for ${itemIds.length} items`);
    const cachedEmbeddings = await getEmbeddingsBatch(itemIds);

    // Find items that need embeddings
    const itemsNeedingEmbeddings = items.filter((item) => !cachedEmbeddings.has(item.id));

    // Generate missing embeddings using batch API
    if (itemsNeedingEmbeddings.length > 0) {
      logger.info(`Generating ${itemsNeedingEmbeddings.length} missing embeddings`);

      // Limit to prevent memory issues - if too many, only process a subset
      const MAX_EMBEDDINGS_PER_REQUEST = 500;
      const itemsToProcess = itemsNeedingEmbeddings.slice(0, MAX_EMBEDDINGS_PER_REQUEST);

      if (itemsNeedingEmbeddings.length > MAX_EMBEDDINGS_PER_REQUEST) {
        logger.warn(
          `Too many missing embeddings (${itemsNeedingEmbeddings.length}). ` +
          `Processing first ${MAX_EMBEDDINGS_PER_REQUEST}. ` +
          `Consider running populate-embeddings script to pre-generate all embeddings.`
        );
      }

      // Prepare items for batch generation
      const itemsForBatch = itemsToProcess.map((item) => {
        const fullText = item.fullText ? item.fullText.substring(0, 2000) : '';
        const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""} ${fullText}`.trim();
        return {
          id: item.id,
          text: text || item.title, // Fallback to title if text is empty
        };
      });

      // Generate embeddings in batch
      const newEmbeddingsMap = await generateEmbeddingsBatch(itemsForBatch);

      // Convert to array format and validate dimensions
      const newEmbeddings: Array<{ itemId: string; embedding: number[] }> = [];
      for (const [itemId, embedding] of newEmbeddingsMap.entries()) {
        // Ensure embedding is 1536 dimensions (pad if needed)
        if (embedding.length === 1536) {
          newEmbeddings.push({ itemId, embedding });
          cachedEmbeddings.set(itemId, embedding);
        } else if (embedding.length === 768) {
          // Pad 768-dim embeddings to 1536
          logger.warn(`Padding 768-dim embedding to 1536 for item ${itemId}`);
          const padded = new Array(1536);
          for (let i = 0; i < 1536; i++) {
            padded[i] = embedding[i % 768] * (i < 768 ? 1 : 0.5);
          }
          newEmbeddings.push({ itemId, embedding: padded });
          cachedEmbeddings.set(itemId, padded);
        } else {
          logger.warn(`Invalid embedding dimension (${embedding.length}) for item ${itemId}, using zero vector`);
          const zeroVector = Array(1536).fill(0);
          cachedEmbeddings.set(itemId, zeroVector);
        }
      }

      // Save newly generated embeddings
      if (newEmbeddings.length > 0) {
        await saveEmbeddingsBatch(newEmbeddings);
        logger.info(`Generated and saved ${newEmbeddings.length} embeddings`);
      }

      // For remaining items (if we hit the limit), use zero vectors
      if (itemsNeedingEmbeddings.length > MAX_EMBEDDINGS_PER_REQUEST) {
        const remaining = itemsNeedingEmbeddings.slice(MAX_EMBEDDINGS_PER_REQUEST);
        logger.warn(`Using zero vectors for ${remaining.length} items (limit exceeded)`);
        for (const item of remaining) {
          cachedEmbeddings.set(item.id, Array(1536).fill(0));
        }
      }
    }

    // Step 3: Find top-K similar items
    logger.info(`Computing similarity scores for ${items.length} items`);
    const candidateVectors = items
      .map((item) => {
        const vector = cachedEmbeddings.get(item.id);
        if (!vector) {
          logger.warn(`Missing embedding for item ${item.id}`);
          return null;
        }
        return { id: item.id, vector };
      })
      .filter((x) => x !== null) as Array<{ id: string; vector: number[] }>;

    const similarItems = topKSimilar(queryEmbedding, candidateVectors, Math.max(limit * 2, 10));

    logger.info(`Found ${similarItems.length} semantically similar items`);

    // Step 4: Get the selected items and rank them
    const retrievedItems = items.filter((item) =>
      similarItems.some((sim) => sim.id === item.id)
    );

    if (retrievedItems.length === 0) {
      logger.warn("No items found for semantic similarity");
      return [];
    }

    // Rank using the standard ranking pipeline
    const rankedItems = await rankCategory(retrievedItems, category, periodDays, "day");

    // Re-rank by semantic similarity to boost relevant items
    const reranked = rankedItems.map((item) => {
      const similarityMatch = similarItems.find((sim) => sim.id === item.id);
      if (!similarityMatch) {
        return item;
      }

      // Boost finalScore based on semantic similarity (weight: 0.3)
      const semanticBoost = similarityMatch.score * 0.3;
      const boostedScore = item.finalScore * 0.7 + semanticBoost;

      return {
        ...item,
        finalScore: boostedScore,
        reasoning: `${item.reasoning} | Semantic similarity: ${similarityMatch.score.toFixed(2)} (boosted)`,
      };
    });

    // Sort by boosted score and return top K
    reranked.sort((a, b) => b.finalScore - a.finalScore);
    const topItems = reranked.slice(0, limit);

    logger.info(`Retrieved and ranked ${topItems.length} items for query`);
    return topItems;
  } catch (error) {
    logger.error(`Retrieval failed for query: "${query}"`, { error });
    throw error;
  }
}
