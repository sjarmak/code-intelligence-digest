/**
 * Embedding provenance + metric-space guards (PRD M0).
 *
 * The stored `embedding_model` column records INTENT, not reality:
 * `generateEmbedding` silently falls back to a hash-based pseudo-embedding
 * (L2 norm ≈ 22) on a missing/expired key or an API outage, and to a zero
 * vector on empty text — both written under the default `text-embedding-3-small`
 * label. A pseudo query vector cosined against the real corpus returns ranked
 * garbage with no error. These guards make provenance trustworthy:
 *
 *  - `classifyEmbeddingProvenance(norm, dims)` derives true provenance from the
 *    measured L2 norm (used by the backfill — norm is the only honest signal).
 *  - `assertQueryEmbeddingProvenance(vec)` throws before a non-conformant query
 *    vector can poison a cosine search; callers fall back to FTS + record a
 *    distinct degradation event (M13: "aborted/fell back" ≠ "ran, found none").
 *
 * Real OpenAI text-embedding-3-small vectors are unit-normalized (audit measured
 * ‖v‖ ∈ [0.9993, 1.0007] over a 5,056-row sample). The tolerance below is wide
 * enough to admit them and reject zero (0) and pseudo (≈22) vectors cleanly.
 */

/** Provenance descriptor for a stored or freshly generated embedding. */
export interface EmbeddingProvenance {
  model: string;
  dimensions: number;
  version: string;
  normalized: boolean;
}

/**
 * The embedding model the live serve path currently produces and the corpus is
 * expected to match. A future local-model migration (blue-green) flips this in
 * one place; the cosine guard then rejects cross-model query vectors for free.
 */
export const CURRENT_EMBEDDING: EmbeddingProvenance = {
  model: "text-embedding-3-small",
  dimensions: 1536,
  version: "openai-v3-small",
  normalized: true,
};

/**
 * The local open-weight encoder the blue-green migration (dv0.5) backfills
 * ALONGSIDE the OpenAI corpus, into item_model_embeddings. nomic-embed-text-v1.5
 * is L2-normalized (unit norm) like OpenAI, so the same NORM_MIN/NORM_MAX band
 * classifies it; only the dimension (768) and labels differ. Additive only — the
 * live serve guards stay locked to CURRENT_EMBEDDING until dv0.5.4 flips them.
 */
export const NOMIC_EMBED: EmbeddingProvenance = {
  model: "nomic-embed-text-v1.5",
  dimensions: 768,
  version: "nomic-v1.5",
  normalized: true,
};

/** Label applied to vectors detected as non-semantic hash pseudo-embeddings. */
export const PSEUDO_FALLBACK_MODEL = "pseudo-fallback";

/** Unit-norm acceptance band. Real OpenAI vectors sit at 1.000 ± 0.001. */
export const NORM_MIN = 0.9;
export const NORM_MAX = 1.1;

/** Exact L2 norm of a vector. */
export function embeddingNorm(vec: readonly number[]): number {
  let sumSq = 0;
  for (const x of vec) sumSq += x * x;
  return Math.sqrt(sumSq);
}

/**
 * Derive true provenance from a vector's measured norm and dimension. Used by
 * the backfill to label what each stored row ACTUALLY is, not what its
 * `embedding_model` default claims.
 *
 *  - norm ≈ 1            → real, normalized model vector
 *  - norm ≈ 0            → zero vector (empty-text fallback) — unusable
 *  - norm clearly > 1    → hash pseudo-embedding — unusable
 */
export function classifyEmbeddingProvenance(
  norm: number,
  dimensions: number,
): EmbeddingProvenance {
  const normalized = norm >= NORM_MIN && norm <= NORM_MAX;
  if (normalized && dimensions === CURRENT_EMBEDDING.dimensions) {
    return { ...CURRENT_EMBEDDING };
  }
  // Anything not unit-norm at the expected dim is a non-semantic fallback.
  return {
    model: PSEUDO_FALLBACK_MODEL,
    dimensions,
    version: norm < NORM_MIN ? "zero-vector" : "hash-pseudo",
    normalized: false,
  };
}

/** Typed error so callers can distinguish a provenance abort from an empty result. */
export class EmbeddingProvenanceError extends Error {
  readonly norm: number;
  readonly dimensions: number;
  constructor(message: string, norm: number, dimensions: number) {
    super(message);
    this.name = "EmbeddingProvenanceError";
    this.norm = norm;
    this.dimensions = dimensions;
  }
}

/** True iff `vec` conforms to the current embedding space (right dim + unit norm). */
export function isQueryEmbeddingValid(vec: readonly number[]): boolean {
  if (vec.length !== CURRENT_EMBEDDING.dimensions) return false;
  const n = embeddingNorm(vec);
  return n >= NORM_MIN && n <= NORM_MAX;
}

/**
 * Assert a query vector shares the corpus metric space before it is used in a
 * cosine search. Throws `EmbeddingProvenanceError` on a wrong-dimension vector
 * or a non-unit-norm pseudo/zero fallback (i.e. the key is dead or text was
 * empty) — never let it silently cosine into garbage.
 */
export function assertQueryEmbeddingProvenance(vec: readonly number[]): void {
  if (vec.length !== CURRENT_EMBEDDING.dimensions) {
    throw new EmbeddingProvenanceError(
      `Query embedding has ${vec.length} dims, expected ${CURRENT_EMBEDDING.dimensions} ` +
        `(${CURRENT_EMBEDDING.model}). Refusing to cosine across metric spaces.`,
      0,
      vec.length,
    );
  }
  const n = embeddingNorm(vec);
  if (n < NORM_MIN || n > NORM_MAX) {
    throw new EmbeddingProvenanceError(
      `Query embedding norm ${n.toFixed(3)} is outside the unit band ` +
        `[${NORM_MIN}, ${NORM_MAX}] — it is a pseudo/zero fallback (dead OPENAI_API_KEY ` +
        `or empty text), not a real ${CURRENT_EMBEDDING.model} vector. Refusing semantic search.`,
      n,
      vec.length,
    );
  }
}
