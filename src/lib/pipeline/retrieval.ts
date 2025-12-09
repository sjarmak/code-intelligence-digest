/**
 * Retrieval pipeline
 * Uses embeddings to find relevant items for questions
 */

import { FeedItem, RankedItem, Category } from "../model";
import { generateEmbedding } from "../embeddings/generate";
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

    // Generate missing embeddings
    if (itemsNeedingEmbeddings.length > 0) {
      logger.info(`Generating ${itemsNeedingEmbeddings.length} missing embeddings`);
      const newEmbeddings: Array<{ itemId: string; embedding: number[] }> = [];

      for (const item of itemsNeedingEmbeddings) {
        const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""}`.substring(
          0,
          1000
        );
        try {
          const embedding = await generateEmbedding(text);
          newEmbeddings.push({ itemId: item.id, embedding });
          cachedEmbeddings.set(item.id, embedding);
        } catch (error) {
          logger.warn(`Failed to generate embedding for item ${item.id}`, { error });
          // Use zero vector as fallback
          cachedEmbeddings.set(item.id, Array(768).fill(0));
        }
      }

      // Save newly generated embeddings
      if (newEmbeddings.length > 0) {
        await saveEmbeddingsBatch(newEmbeddings);
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
    const rankedItems = await rankCategory(retrievedItems, category, periodDays);

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
