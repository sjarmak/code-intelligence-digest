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
    const candidateVectors = items
      .map((item) => {
        const vector = cachedEmbeddings.get(item.id);
        if (!vector || vector.length === 0) {
          logger.warn(`Invalid embedding for item ${item.id}: length=${vector?.length ?? 0}`);
          return null;
        }
        return { id: item.id, vector };
      })
      .filter((x) => x !== null) as Array<{ id: string; vector: number[] }>;

    if (candidateVectors.length === 0) {
      logger.warn(
        `No valid embeddings found for search (${items.length} items had invalid embeddings), falling back to term-based search`
      );
      return termBasedSearch(query, items, limit);
    }

    const similarItems = topKSimilar(queryEmbedding, candidateVectors, limit);

    // If semantic search returns few results, fall back to term-based search
    if (similarItems.length < Math.max(5, limit / 2)) {
      logger.info(
        `Semantic search returned only ${similarItems.length} results, falling back to term-based search`
      );
      return termBasedSearch(query, items, limit);
    }

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
 * Fallback: simple term-based search for when semantic search is insufficient
 * Matches query terms in title, summary, and snippet
 */
function termBasedSearch(
  query: string,
  items: FeedItem[],
  limit: number
): SearchResult[] {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 2);

  logger.info(`Term-based search for query: "${query}", terms: [${queryTerms.join(", ")}], items: ${items.length}`);

  if (queryTerms.length === 0) {
    logger.warn("No query terms found (all < 3 characters)");
    return [];
  }

  // Score items by term matches
  const scored = items
    .map((item) => {
      const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""}`.toLowerCase();

      // Count term occurrences
      let score = 0;
      for (const term of queryTerms) {
        // Boost title matches
        const titleMatches = (item.title.toLowerCase().match(new RegExp(term, "g")) || []).length;
        score += titleMatches * 3;

        // Standard matches in summary/snippet
        const textMatches = (text.match(new RegExp(term, "g")) || []).length;
        score += Math.min(textMatches, 5); // Cap to avoid over-weighting long documents
      }

      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  logger.info(`Term-based search returned ${scored.length} results with query: "${query}" from ${items.length} items`);

  return scored.map((x) => ({
    id: x.item.id,
    title: x.item.title,
    url: x.item.url,
    sourceTitle: x.item.sourceTitle,
    publishedAt: x.item.publishedAt.toISOString(),
    summary: x.item.summary,
    contentSnippet: x.item.contentSnippet,
    category: x.item.category,
    similarity: Math.round((x.score / 100) * 1000) / 1000, // Normalize score
  }));
}

/**
 * Rerank items using hybrid approach: semantic + LLM scores
 * For items that already have scores (RankedItem), boost by semantic relevance
 * 
 * In search mode (high boostWeight), semantic similarity dominates.
 * In digest mode (low boostWeight), LLM+BM25 scores have more influence.
 */
export function rerankWithSemanticScore(
  rankedItems: RankedItem[],
  semanticScores: Map<string, number>,
  boostWeight: number = 0.5 // How much to weight semantic score (increased from 0.2 for search)
): RankedItem[] {
  const reranked = rankedItems.map((item) => {
    const semanticScore = semanticScores.get(item.id) ?? 0;
    
    // Blend semantic score into final score
    // With weight=0.5: equal balance between semantic and existing scores
    // Higher weight means semantic match becomes more important (better for user queries)
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
