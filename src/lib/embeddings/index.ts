/**
 * Embedding utilities and vector operations
 * Re-exports generate function and provides vector math utilities
 */

export { generateEmbedding, generateEmbeddingsBatch } from "./generate";

/**
 * Compute cosine similarity between two vectors
 * Returns a value between -1 and 1, typically 0-1 for unit vectors
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
  if (vecA.length !== vecB.length) {
    throw new Error(`Vector dimensions must match: ${vecA.length} vs ${vecB.length}`);
  }

  let dotProduct = 0;
  let magnitudeA = 0;
  let magnitudeB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    magnitudeA += vecA[i] * vecA[i];
    magnitudeB += vecB[i] * vecB[i];
  }

  magnitudeA = Math.sqrt(magnitudeA);
  magnitudeB = Math.sqrt(magnitudeB);

  if (magnitudeA === 0 || magnitudeB === 0) {
    return 0; // Undefined similarity if either vector is zero
  }

  return dotProduct / (magnitudeA * magnitudeB);
}

/**
 * Find top-K most similar vectors by cosine similarity
 */
export interface SimilarityMatch {
  id: string;
  score: number; // Cosine similarity score
}

export function topKSimilar(
  queryVector: number[],
  candidates: Array<{ id: string; vector: number[] }>,
  k: number
): SimilarityMatch[] {
  if (candidates.length === 0) {
    return [];
  }

  // Compute similarities for all candidates
  const similarities = candidates.map((candidate) => ({
    id: candidate.id,
    score: cosineSimilarity(queryVector, candidate.vector),
  }));

  // Sort by score descending and take top K
  return similarities.sort((a, b) => b.score - a.score).slice(0, k);
}

/**
 * Encode embedding vector to binary format for storage
 * Uses Float32Array for compact binary representation
 */
export function encodeEmbedding(embedding: number[]): Buffer {
  const float32Array = new Float32Array(embedding);
  return Buffer.from(float32Array.buffer);
}

/**
 * Decode embedding vector from binary format
 */
export function decodeEmbedding(buffer: Buffer): number[] {
  if (!buffer || buffer.length === 0) {
    // Return zero vector if buffer is empty (1536 dimensions for OpenAI embeddings)
    return Array(1536).fill(0);
  }
  const float32Array = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
  return Array.from(float32Array);
}

/**
 * Normalize embedding vector to unit length
 */
export function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(embedding.reduce((sum, x) => sum + x * x, 0));
  if (magnitude === 0) {
    return embedding;
  }
  return embedding.map((x) => x / magnitude);
}
