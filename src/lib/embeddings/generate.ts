/**
 * Embedding generation (OpenAI text-embedding-3-small, 1536d).
 *
 * dv0.5.5: there is NO pseudo/zero fallback. When a real vector cannot be
 * produced (no client, API failure, empty text), `generateEmbedding` throws
 * `EmbeddingUnavailableError` and `generateEmbeddingsBatch` omits the item from
 * its result map. A fabricated vector used to pass every caller's
 * `length === 1536` guard and get persisted, poisoning cosine results; omitting
 * the item instead leaves it un-embedded so it is retried on a later run.
 */

import { logger } from "../logger";
import { getOpenAICompatibleClient } from "../llm/client";
import { recordDegradation } from "../observability/degradation";
import { assertQueryEmbeddingProvenance, EmbeddingUnavailableError } from "./provenance";

const OPENAI_EMBEDDING_MODEL = "text-embedding-3-small";
const MAX_INPUT_CHARS = 8000; // OpenAI caps at ~8192 tokens; truncate to be safe.

/**
 * Generate a genuine OpenAI embedding for `text`, or throw.
 *
 * Throws `EmbeddingUnavailableError` for empty text, a missing client, or an
 * API failure — it never returns a non-semantic vector. Each unavailable call
 * is recorded as a degradation so degraded runs stay queryable.
 */
export async function generateEmbedding(text: string): Promise<number[]> {
  if (!text || text.trim().length === 0) {
    throw new EmbeddingUnavailableError("Cannot embed empty text");
  }

  const client = getOpenAICompatibleClient();
  if (!client) {
    recordDegradation("pseudo_embedding");
    throw new EmbeddingUnavailableError("No OpenAI client configured (OPENAI_API_KEY missing)");
  }

  try {
    const response = await client.embeddings.create({
      model: OPENAI_EMBEDDING_MODEL,
      input: text.substring(0, MAX_INPUT_CHARS),
    });
    const embedding = response.data[0]?.embedding;
    if (embedding && embedding.length > 0) {
      return embedding;
    }
    recordDegradation("pseudo_embedding");
    throw new EmbeddingUnavailableError("OpenAI returned an empty embedding");
  } catch (error) {
    if (error instanceof EmbeddingUnavailableError) {
      throw error;
    }
    recordDegradation("pseudo_embedding");
    const message = error instanceof Error ? error.message : String(error);
    throw new EmbeddingUnavailableError(`OpenAI embedding generation failed: ${message}`, {
      cause: error,
    });
  }
}

/**
 * Generate a query embedding, asserting it shares the corpus metric space.
 * Throws `EmbeddingUnavailableError` (unavailable) or `EmbeddingProvenanceError`
 * (wrong space) so a caller can fall back to keyword search rather than cosine
 * into garbage (PRD M0, premortem Theme C).
 */
export async function generateQueryEmbedding(text: string): Promise<number[]> {
  const vec = await generateEmbedding(text);
  assertQueryEmbeddingProvenance(vec);
  return vec;
}

/**
 * Generate embeddings for many items. The returned map contains an entry ONLY
 * for items that got a genuine vector; items that could not be embedded are
 * omitted (and counted as degradations), never stored as a fabricated vector.
 * Callers persist whatever the map contains, so omission == "retry next run".
 */
export async function generateEmbeddingsBatch(
  items: Array<{ id: string; text: string }>,
): Promise<Map<string, number[]>> {
  const embeddings = new Map<string, number[]>();
  if (items.length === 0) {
    return embeddings;
  }

  const client = getOpenAICompatibleClient();
  if (!client) {
    // No client → nothing can be embedded. Record one degradation per item and
    // return empty so the whole corpus is retried once a key is configured.
    recordDegradation("pseudo_embedding", items.length);
    logger.warn(
      `No OpenAI client — skipping ${items.length} embeddings (will retry once OPENAI_API_KEY is set)`,
    );
    return embeddings;
  }

  const BATCH_SIZE = 100; // Conservative; OpenAI allows up to 2048 inputs/request.
  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, Math.min(i + BATCH_SIZE, items.length));
    try {
      const response = await client.embeddings.create({
        model: OPENAI_EMBEDDING_MODEL,
        input: batch.map((item) => item.text.substring(0, MAX_INPUT_CHARS)),
      });
      for (let j = 0; j < batch.length; j++) {
        const embedding = response.data[j]?.embedding;
        if (embedding && embedding.length > 0) {
          embeddings.set(batch[j].id, embedding);
        } else {
          recordDegradation("pseudo_embedding");
          logger.warn(`Empty embedding for item ${batch[j].id}, skipping`);
        }
      }
      logger.info(
        `Generated OpenAI embeddings: ${Math.min(i + BATCH_SIZE, items.length)}/${items.length}`,
      );
    } catch (error) {
      // Batch request failed — retry each item individually so one bad input
      // doesn't drop the whole batch. Items that still fail are omitted.
      logger.warn("Batch embedding failed, retrying items individually", {
        error: error instanceof Error ? error.message : String(error),
      });
      for (const item of batch) {
        try {
          embeddings.set(item.id, await generateEmbedding(item.text));
        } catch {
          // generateEmbedding already recorded the degradation; just skip.
          logger.warn(`Skipping un-embeddable item ${item.id}`);
        }
      }
    }
  }

  return embeddings;
}
