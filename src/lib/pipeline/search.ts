/**
 * Hybrid search pipeline
 * Combines BM25 keyword matching + semantic search (embeddings)
 *
 * Hybrid approach:
 * 1. BM25: Fast, keyword-based, good for exact term matches
 * 2. Semantic: Slow (embeddings), good for conceptual matches
 * 3. Combined: Weighted average of both scores
 *
 * Embeddings are 1536-dimensional (OpenAI text-embedding-3-small) with fallback to pseudo-embeddings
 * In production, replace with OpenAI/Anthropic embeddings
 */

import { FeedItem, RankedItem } from "../model";
import { generateEmbedding, generateEmbeddingsBatch, topKSimilar, cosineSimilarity } from "../embeddings";
import { getEmbeddingsBatch, saveEmbeddingsBatch } from "../db/embeddings";
import { logger } from "../logger";
import { decodeHtmlEntities } from "../utils/html-entities";
import { extractBibcodeFromUrl } from "../ads/client";

export interface SearchResult {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  publishedAt: string;
  createdAt?: string | null;
  summary?: string;
  contentSnippet?: string;
  category: string;
  similarity: number; // 0-1 final score (hybrid)
  bm25Score?: number; // Raw BM25 score
  semanticScore?: number; // Raw semantic similarity
  bibcode?: string; // For research papers (extracted from URL)
}

/**
 * Hybrid search: BM25 + semantic (embeddings)
 * Combines keyword relevance with conceptual similarity
 * Default approach - balances speed and relevance
 */
export async function hybridSearch(
  query: string,
  items: FeedItem[],
  limit: number = 10,
  semanticWeight: number = 0.6, // 60% semantic, 40% BM25
  maxSemanticItems: number = 100 // Only compute embeddings for top 100 BM25 results
): Promise<SearchResult[]> {
  if (items.length === 0) {
    return [];
  }

  logger.info(`Performing hybrid search for: "${query}" (semantic weight: ${semanticWeight})`);

  try {
    // Step 1: Quick BM25 pass to filter to top candidates
    const bm25Results = await keywordSearch(query, items, maxSemanticItems);
    logger.info(`BM25 filtered to ${bm25Results.length} candidates`);

    if (bm25Results.length === 0) {
      logger.warn("BM25 search returned no results");
      return [];
    }

    // Step 2: Get semantic scores for top BM25 results
    const topItems = items.filter((item) => bm25Results.some((r) => r.id === item.id));
    const semanticScores = await computeSemanticScores(query, topItems);

    // Step 3: Hybrid ranking: combine BM25 + semantic
    const hybridResults = bm25Results.map((bm25Result) => {
      const semanticScore = semanticScores.get(bm25Result.id) ?? 0;
      const item = items.find((i) => i.id === bm25Result.id);
      if (!item) return null;

      // Normalize scores to [0, 1]
      const normalizedBm25 = Math.min(1, bm25Result.similarity); // BM25 similarity already 0-1
      const normalizedSemantic = semanticScore; // Already 0-1

      // Weighted combination
      const hybridScore = normalizedSemantic * semanticWeight + normalizedBm25 * (1 - semanticWeight);

      return {
        ...bm25Result,
        similarity: hybridScore,
        semanticScore: normalizedSemantic,
        bm25Score: normalizedBm25,
      };
    }).filter((x) => x !== null) as SearchResult[];

    // Step 4: Re-sort by hybrid score and return top K
    return hybridResults
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, limit);
  } catch (error) {
    logger.error(`Hybrid search failed for query: "${query}"`, error);
    throw error;
  }
}

/**
 * Compute semantic scores (embeddings + cosine similarity) for items
 * Reuses cached embeddings when available
 */
async function computeSemanticScores(
  query: string,
  items: FeedItem[]
): Promise<Map<string, number>> {
  try {
    // Generate query embedding
    const queryEmbedding = await generateEmbedding(query);

    // Get cached embeddings
    const itemIds = items.map((item) => item.id);
    const cachedEmbeddings = await getEmbeddingsBatch(itemIds);

    // Generate missing embeddings using batch API
    const itemsNeedingEmbeddings = items.filter((item) => !cachedEmbeddings.has(item.id));

    if (itemsNeedingEmbeddings.length > 0) {
      // Limit to prevent memory issues
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
        const fullText = (item as any).fullText ? (item as any).fullText.substring(0, 2000) : "";
        const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""} ${fullText}`.trim();
        return {
          id: item.id,
          text: text || item.title,
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
        logger.info(`Generated and cached ${newEmbeddings.length} new embeddings`);
      }

      // For remaining items (if we hit the limit), use zero vectors
      if (itemsNeedingEmbeddings.length > MAX_EMBEDDINGS_PER_REQUEST) {
        const remaining = itemsNeedingEmbeddings.slice(MAX_EMBEDDINGS_PER_REQUEST);
        for (const item of remaining) {
          cachedEmbeddings.set(item.id, Array(1536).fill(0));
        }
      }
    }

    // Compute cosine similarity for all items
    const scores = new Map<string, number>();
    for (const item of items) {
      const vector = cachedEmbeddings.get(item.id);
      if (vector && vector.length > 0) {
        const similarity = cosineSimilarity(queryEmbedding, vector);
        // Normalize to [0, 1] (cosine similarity is [-1, 1], but typically [0, 1] for unit vectors)
        const normalizedScore = Math.max(0, similarity);
        scores.set(item.id, normalizedScore);
      } else {
        scores.set(item.id, 0);
      }
    }

    return scores;
  } catch (error) {
    logger.error("Failed to compute semantic scores", error);
    // Return zero scores on error to allow BM25 to continue
    return new Map(items.map((item) => [item.id, 0]));
  }
}

/**
 * Pure semantic search: embeddings only
 * Slower but good for conceptual/abstract queries
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

    // Generate missing embeddings using batch API
    if (itemsNeedingEmbeddings.length > 0) {
      // Limit to prevent memory issues
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
        const fullText = (item as any).fullText ? (item as any).fullText.substring(0, 2000) : "";
        const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""} ${fullText}`.trim();
        return {
          id: item.id,
          text: text || item.title,
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
        logger.info(`Generated and cached ${newEmbeddings.length} new embeddings`);
      }

      // For remaining items (if we hit the limit), use zero vectors
      if (itemsNeedingEmbeddings.length > MAX_EMBEDDINGS_PER_REQUEST) {
        const remaining = itemsNeedingEmbeddings.slice(MAX_EMBEDDINGS_PER_REQUEST);
        for (const item of remaining) {
          cachedEmbeddings.set(item.id, Array(1536).fill(0));
        }
      }
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

      // Extract bibcode from URL if this is a research paper
      const bibcode = extractBibcodeFromUrl(item.url);

      return {
        id: item.id,
        title: decodeHtmlEntities(item.title), // Decode HTML entities in title
        url: item.url,
        sourceTitle: item.sourceTitle,
        publishedAt: item.publishedAt.toISOString(),
        createdAt: item.createdAt?.toISOString() || null,
        summary: item.summary,
        contentSnippet: item.contentSnippet,
        category: item.category,
        similarity: Math.round(match.score * 1000) / 1000, // Round to 3 decimals
        bibcode: bibcode || undefined,
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
 * Keyword search: BM25-style term matching with exact match boost
 * Used when user explicitly selects keyword search (e.g., for "sourcegraph")
 */
export async function keywordSearch(
  query: string,
  items: FeedItem[],
  limit: number
): Promise<SearchResult[]> {
  const queryTerms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((term) => term.length > 0);

  logger.info(`Keyword search for query: "${query}", terms: [${queryTerms.join(", ")}], items: ${items.length}`);

  if (queryTerms.length === 0) {
    logger.warn("No query terms found");
    return [];
  }

  // Score items by term matches with exact phrase boost
  const scored = items
    .map((item) => {
      const title = item.title.toLowerCase();
      // Include full text if available (first 5000 chars for better matching)
      const fullText = (item as any).fullText ? (item as any).fullText.substring(0, 5000).toLowerCase() : "";
      const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""} ${fullText}`.toLowerCase();

      let score = 0;

      // Exact phrase match in title (highest boost)
      if (title.includes(query.toLowerCase())) {
        score += 100;
      }

      // Individual term scoring
      for (const term of queryTerms) {
        // Exact matches in title (3x boost)
        const titleMatches = (title.match(new RegExp(`\\b${term}\\b`, "g")) || []).length;
        score += titleMatches * 30;

        // Partial matches in title (2x boost)
        const titlePartialMatches = (title.match(new RegExp(term, "g")) || []).length - titleMatches;
        score += titlePartialMatches * 10;

        // Exact matches in full text (1x boost)
        const exactMatches = (text.match(new RegExp(`\\b${term}\\b`, "g")) || []).length - titleMatches;
        score += exactMatches * 5;

        // Partial matches in full text (0.5x boost)
        const partialMatches = (text.match(new RegExp(term, "g")) || []).length - exactMatches - titleMatches - titlePartialMatches;
        score += Math.min(partialMatches, 10) * 2; // Increased cap from 5 to 10 for full text
      }

      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  logger.info(`Keyword search returned ${scored.length} results with query: "${query}" from ${items.length} items`);

  return scored.map((x) => {
    // Extract bibcode from URL if this is a research paper
    const bibcode = extractBibcodeFromUrl(x.item.url);

    return {
      id: x.item.id,
      title: decodeHtmlEntities(x.item.title), // Decode HTML entities in title
      url: x.item.url,
      sourceTitle: x.item.sourceTitle,
      publishedAt: x.item.publishedAt.toISOString(),
      createdAt: x.item.createdAt?.toISOString() || null,
      summary: x.item.summary,
      contentSnippet: x.item.contentSnippet,
      category: x.item.category,
      similarity: Math.min(1.0, Math.round((x.score / 100) * 1000) / 1000), // Normalize to [0, 1]
      bibcode: bibcode || undefined,
    };
  });
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
      // Include full text if available
      const fullText = (item as any).fullText ? (item as any).fullText.substring(0, 5000).toLowerCase() : "";
      const text = `${item.title} ${item.summary || ""} ${item.contentSnippet || ""} ${fullText}`.toLowerCase();

      // Count term occurrences
      let score = 0;
      for (const term of queryTerms) {
        // Boost title matches
        const titleMatches = (item.title.toLowerCase().match(new RegExp(term, "g")) || []).length;
        score += titleMatches * 3;

        // Standard matches in full text
        const textMatches = (text.match(new RegExp(term, "g")) || []).length;
        score += Math.min(textMatches, 10); // Increased cap from 5 to 10 for full text
      }

      return { item, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit);

  logger.info(`Term-based search returned ${scored.length} results with query: "${query}" from ${items.length} items`);

  return scored.map((x) => {
    // Extract bibcode from URL if this is a research paper
    const bibcode = extractBibcodeFromUrl(x.item.url);

    return {
      id: x.item.id,
      title: decodeHtmlEntities(x.item.title), // Decode HTML entities in title
      url: x.item.url,
      sourceTitle: x.item.sourceTitle,
      publishedAt: x.item.publishedAt.toISOString(),
      createdAt: x.item.createdAt?.toISOString() || null,
      summary: x.item.summary,
      contentSnippet: x.item.contentSnippet,
      category: x.item.category,
      similarity: Math.round((x.score / 100) * 1000) / 1000, // Normalize score
      bibcode: bibcode || undefined,
    };
  });
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
