/**
 * Vector embeddings infrastructure
 * Uses local embeddings (no external API dependency)
 * Caches computed embeddings in the database
 */

import { logger } from "../logger";

// Using a simple, lightweight approach: compute embeddings client-side
// For production, consider: Hugging Face API, OpenAI embeddings, or local models
// This is a placeholder that will use simple string similarity for MVP

export interface ItemEmbedding {
  itemId: string;
  vector: number[];
  generatedAt: number; // Unix timestamp
}

/**
 * Generate embedding for text using simple TF-IDF approach
 * Returns normalized vector in 384-dim space (matching standard embeddings)
 * 
 * In production, replace with:
 * - OpenAI: embed-3-small (1536 dims)
 * - Hugging Face: all-MiniLM-L6-v2 (384 dims)
 * - Local: @xenova/transformers
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  // Simple TF-IDF-inspired approach for MVP
  // Tokenize and create a basic semantic vector
  const tokens = tokenize(text.toLowerCase());
  const vector = computeTFIDFVector(tokens);
  
  logger.debug(`Generated embedding for text: "${text.substring(0, 50)}..."`);
  return vector;
}

/**
 * Generate embeddings for multiple texts in batch
 */
export async function generateEmbeddingsBatch(texts: string[]): Promise<number[][]> {
  logger.info(`Generating embeddings for batch of ${texts.length} items`);
  const embeddings = await Promise.all(
    texts.map((text) => generateEmbedding(text))
  );
  return embeddings;
}

/**
 * Compute cosine similarity between two vectors
 */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error("Vectors must have same length");
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < a.length; i++) {
    dotProduct += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }

  const denominator = Math.sqrt(normA) * Math.sqrt(normB);
  if (denominator === 0) return 0;
  
  return dotProduct / denominator;
}

/**
 * Find top K most similar items by cosine similarity
 */
export function topKSimilar(
  queryVector: number[],
  candidateVectors: Array<{ id: string; vector: number[] }>,
  k: number = 10
): Array<{ id: string; score: number }> {
  const scores = candidateVectors.map((candidate) => ({
    id: candidate.id,
    score: cosineSimilarity(queryVector, candidate.vector),
  }));

  return scores
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

/**
 * Simple tokenizer for text
 */
function tokenize(text: string): string[] {
  // Remove punctuation, split on whitespace and hyphens
  const cleaned = text
    .replace(/[^\w\s\-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  
  const tokens = cleaned.split(/[\s\-]+/);
  return tokens.filter((t) => t.length > 2); // Filter short tokens
}

/**
 * Compute simple TF-IDF vector (384-dimensional for compatibility)
 */
function computeTFIDFVector(tokens: string[]): number[] {
  const VECTOR_DIM = 384; // Standard embedding dimension
  const vector = new Array(VECTOR_DIM).fill(0);

  if (tokens.length === 0) return vector;

  // Simple hash-based approach: distribute tokens across dimensions
  const tokenSet = new Set(tokens);
  
  for (const token of tokenSet) {
    // Hash token to dimension
    const hashCode = hashString(token);
    const dim = Math.abs(hashCode) % VECTOR_DIM;
    vector[dim] += 1 / Math.sqrt(tokens.length);
  }

  // L2 normalize
  const magnitude = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
  if (magnitude > 0) {
    return vector.map((val) => val / magnitude);
  }

  return vector;
}

/**
 * Simple string hash function for consistent dimension mapping
 */
function hashString(str: string): number {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return hash;
}
