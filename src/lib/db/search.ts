/**
 * Database-level search operations
 * 
 * Provides search functions backed by PostgreSQL:
 * - tsvector full-text search (+ optional ts_headline)
 * - pgvector similarity search
 * 
 * This module abstracts the database-specific search implementation.
 */

import { getDbClient } from './driver';
import { logger } from '../logger';
import { assertQueryEmbeddingProvenance } from '../embeddings/provenance';

export interface DbSearchResult {
  id: string;
  title: string;
  url: string;
  sourceTitle: string;
  publishedAt: number;
  summary: string | null;
  contentSnippet: string | null;
  category: string;
  score: number;
  headline?: string; // PostgreSQL ts_headline for search result snippet
}

/**
 * Full-text search using database-native capabilities
 * 
 * PostgreSQL: Uses tsvector with ts_rank and ts_headline
 */
export async function dbFullTextSearch(
  query: string,
  options: {
    category?: string;
    period?: 'day' | 'week' | 'month' | 'all';
    limit?: number;
  } = {}
): Promise<DbSearchResult[]> {
  const limit = options.limit ?? 50;
  return postgresFullTextSearch(query, options, limit);
}

/**
 * PostgreSQL full-text search with tsvector
 */
async function postgresFullTextSearch(
  query: string,
  options: { category?: string; period?: 'day' | 'week' | 'month' | 'all' },
  limit: number
): Promise<DbSearchResult[]> {
  const client = await getDbClient();

  // Convert query to tsquery format (handle phrases and operators)
  // Split into words and join with & (AND)
  const tsQuery = query
    .trim()
    .split(/\s+/)
    .filter(word => word.length > 0)
    .map(word => word.replace(/['"]/g, '')) // Remove quotes
    .join(' & ');

  // Build WHERE clause
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Add full-text search condition
  conditions.push(`search_vector @@ to_tsquery('english', $${paramIndex})`);
  params.push(tsQuery);
  paramIndex++;

  // Add category filter
  if (options.category) {
    conditions.push(`category = $${paramIndex}`);
    params.push(options.category);
    paramIndex++;
  }

  // Add period filter
  if (options.period && options.period !== 'all') {
    const now = Math.floor(Date.now() / 1000);
    const periodSeconds = {
      day: 86400,
      week: 604800,
      month: 2592000,
    };
    const cutoff = now - periodSeconds[options.period];
    conditions.push(`published_at >= $${paramIndex}`);
    params.push(cutoff);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // PostgreSQL-specific query with ts_rank and ts_headline
  const sql = `
    SELECT 
      id,
      title,
      url,
      source_title as "sourceTitle",
      published_at as "publishedAt",
      summary,
      content_snippet as "contentSnippet",
      category,
      ts_rank(search_vector, to_tsquery('english', $1)) as score,
      ts_headline('english', 
        coalesce(title, '') || ' ' || coalesce(summary, ''), 
        to_tsquery('english', $1),
        'MaxWords=50, MinWords=20, StartSel=<mark>, StopSel=</mark>'
      ) as headline
    FROM items
    ${whereClause}
    ORDER BY score DESC
    LIMIT ${limit}
  `;

  try {
    const result = await client.query(sql, params);
    logger.info(`PostgreSQL FTS returned ${result.rows.length} results for: "${query}"`);
    return result.rows as unknown as DbSearchResult[];
  } catch (error) {
    logger.error(`PostgreSQL FTS failed for query: "${query}"`, error);
    throw error;
  }
}

/**
 * Vector similarity search using pgvector
 */
export async function dbVectorSearch(
  queryEmbedding: number[],
  options: {
    category?: string;
    limit?: number;
  } = {}
): Promise<DbSearchResult[]> {
  // M0 guard: refuse to cosine a pseudo/zero/wrong-dim query vector into the
  // corpus (throws EmbeddingProvenanceError — caller falls back to FTS).
  assertQueryEmbeddingProvenance(queryEmbedding);
  const client = await getDbClient();
  const limit = options.limit ?? 20;

  // Build query
  const conditions: string[] = [];
  const params: unknown[] = [];
  let paramIndex = 1;

  // Vector as first parameter
  const vectorStr = `[${queryEmbedding.join(',')}]`;
  params.push(vectorStr);
  paramIndex++;

  if (options.category) {
    conditions.push(`i.category = $${paramIndex}`);
    params.push(options.category);
    paramIndex++;
  }

  const whereClause = conditions.length > 0 ? `AND ${conditions.join(' AND ')}` : '';

  const sql = `
    SELECT 
      i.id,
      i.title,
      i.url,
      i.source_title as "sourceTitle",
      i.published_at as "publishedAt",
      i.summary,
      i.content_snippet as "contentSnippet",
      i.category,
      1 - (e.embedding <=> $1::vector) as score
    FROM item_embeddings e
    JOIN items i ON e.item_id = i.id
    WHERE e.embedding IS NOT NULL
      AND e.embedding_normalized IS NOT FALSE  -- M0: exclude pseudo/zero-vector rows
    ${whereClause}
    ORDER BY e.embedding <=> $1::vector
    LIMIT ${limit}
  `;

  try {
    const result = await client.query(sql, params);
    logger.info(`pgvector search returned ${result.rows.length} results`);
    return result.rows as unknown as DbSearchResult[];
  } catch (error) {
    logger.error('pgvector search failed', error);
    return []; // Return empty on error, let fallback handle it
  }
}

/**
 * Hybrid search combining FTS and vector similarity
 */
export async function dbHybridSearch(
  query: string,
  queryEmbedding: number[] | null,
  options: {
    category?: string;
    period?: 'day' | 'week' | 'month' | 'all';
    limit?: number;
    semanticWeight?: number; // 0-1, weight for vector similarity
  } = {}
): Promise<DbSearchResult[]> {
  const limit = options.limit ?? 20;
  const semanticWeight = options.semanticWeight ?? 0.5;

  if (!queryEmbedding) {
    return dbFullTextSearch(query, options);
  }

  // PostgreSQL: Combine FTS and vector search
  try {
    // Get both result sets
    const [ftsResults, vectorResults] = await Promise.all([
      dbFullTextSearch(query, { ...options, limit: limit * 2 }),
      dbVectorSearch(queryEmbedding, { category: options.category, limit: limit * 2 }),
    ]);

    // Combine scores using RRF (Reciprocal Rank Fusion) or weighted average
    const scoreMap = new Map<string, { item: DbSearchResult; ftsScore: number; vectorScore: number }>();

    // Normalize FTS scores
    const maxFts = Math.max(...ftsResults.map(r => r.score), 1);
    for (const result of ftsResults) {
      scoreMap.set(result.id, {
        item: result,
        ftsScore: result.score / maxFts,
        vectorScore: 0,
      });
    }

    // Add vector scores
    for (const result of vectorResults) {
      const existing = scoreMap.get(result.id);
      if (existing) {
        existing.vectorScore = result.score; // Already 0-1
      } else {
        scoreMap.set(result.id, {
          item: result,
          ftsScore: 0,
          vectorScore: result.score,
        });
      }
    }

    // Calculate hybrid scores and sort
    const hybridResults = Array.from(scoreMap.values())
      .map(({ item, ftsScore, vectorScore }) => ({
        ...item,
        score: ftsScore * (1 - semanticWeight) + vectorScore * semanticWeight,
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);

    logger.info(`Hybrid search returned ${hybridResults.length} results (FTS: ${ftsResults.length}, Vector: ${vectorResults.length})`);
    return hybridResults;
  } catch (error) {
    logger.error('Hybrid search failed, falling back to FTS only', error);
    return dbFullTextSearch(query, options);
  }
}
