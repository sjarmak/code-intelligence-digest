/**
 * Semantic search pipeline
 * Searches over cached items using vector similarity
 */

import { FeedItem, RankedItem } from "../model";
import { generateEmbedding, topKSimilar } from "../embeddings";
import { getEmbeddingsBatch, saveEmbeddingsBatch } from "../db/embeddings";
import { logger } from "../logger";

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  publishedAt: string;
  summary?: string;
  contentSnippet?: string;
  category: string;
  similarity: number; // 0-1 cosine similarity score
}

/**
 * Search items by semantic similarity to query
 * Generates embeddings on first search, then caches them
 */
export async function semanticSearch(
  query: string,
  items: FeedItem[],
  limit: number = 10
): Promise<SearchResult[]> {
  if (items.length === 0) {
    return [];
  }

  logger.info(`Performing semantic search for: "${query}" over ${items.length} items`);

  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Get cached embeddings or generate new ones
    const itemIds = items.map((item) => item.id);
    const cachedEmbeddings = await getEmbeddingsBatch(itemIds);

    // Determine which items need new embeddings
    const itemsNeedingEmbeddings = items.filter((item) => !cachedEmbeddings.has(item.id));

    // Generate missing embeddings
    const newEmbeddings: Array<{ itemId: string; embedding: number[] }> = [];
    for (const item of itemsNeedingEmbeddings) {
      const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""}`;
      const embedding = await generateEmbedding(text);
      newEmbeddings.push({ itemId: item.id, embedding });
      cachedEmbeddings.set(item.id, embedding);
    }

    // Save newly generated embeddings
    if (newEmbeddings.length > 0) {
      await saveEmbeddingsBatch(newEmbeddings);
      logger.info(`Generated and cached ${newEmbeddings.length} new embeddings`);
    }

    // Compute similarity scores
    const candidateVectors = items.map((item) => {
      const vector = cachedEmbeddings.get(item.id);
      if (!vector) {
        throw new Error(`Missing embedding for item ${item.id}`);
      }
      return { id: item.id, vector };
    });

    const similarItems = topKSimilar(queryEmbedding, candidateVectors, limit);

    // Convert to result objects
    const results = similarItems.map((match) => {
      const item = items.find((i) => i.id === match.id);
      if (!item) {
        throw new Error(`Item ${match.id} not found`);
      }

      return {
        id: item.id,
        title: item.title,
        url: item.url,
        sourceTitle: item.sourceTitle,
        publishedAt: item.publishedAt.toISOString(),
        summary: item.summary,
        contentSnippet: item.contentSnippet,
        category: item.category,
        similarity: Math.round(match.score * 1000) / 1000, // Round to 3 decimals
      };
    });

    logger.info(`Semantic search returned ${results.length} results`);
    return results;
  } catch (error) {
    logger.error(`Semantic search failed for query: "${query}"`, error);
    throw error;
  }
}

/**
 * Rerank items using hybrid approach: semantic + LLM scores
 * For items that already have scores (RankedItem), boost by semantic relevance
 */
export function rerankWithSemanticScore(
  rankedItems: RankedItem[],
  semanticScores: Map<string, number>,
  boostWeight: number = 0.2 // How much to weight semantic score
): RankedItem[] {
  const reranked = rankedItems.map((item) => {
    const semanticScore = semanticScores.get(item.id) ?? 0;
    
    // Blend semantic score into final score
    const blendedScore = 
      item.finalScore * (1 - boostWeight) + 
      semanticScore * boostWeight;

    return {
      ...item,
      finalScore: blendedScore,
      reasoning: `${item.reasoning} | Semantic=${semanticScore.toFixed(2)} (blended with weight=${boostWeight})`,
    };
  });

  // Re-sort by blended score
  reranked.sort((a, b) => b.finalScore - a.finalScore);
  
  return reranked;
}
