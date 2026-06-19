/**
 * Encoder-agnostic batch job (dv0.5.2): embed items with a local model and store
 * them in item_model_embeddings, alongside the live OpenAI corpus (blue-green).
 *
 * Idempotent resume: an item is re-embedded only if its current encoder input
 * hashes differently from the stored (normalized) row — so unchanged items are
 * skipped and poisoned rows (normalized=false, absent from the resume map) are
 * redone. Empty-text items are skipped, never stored as a zero vector.
 */
import type { FeedItem } from "../model";
import type { Encoder } from "./encoder";
import { buildItemText } from "./item-text";
import {
  computeSourceHash,
  getModelSourceHashes,
  saveModelEmbeddingsBatch,
  type ModelEmbeddingRow,
} from "../db/embeddings-models";
import { logger } from "../logger";

export interface EmbedJobStats {
  total: number;
  /** Skipped via resume (stored hash matched). */
  skipped: number;
  /** Skipped because the item had no usable text. */
  emptySkipped: number;
  embedded: number;
}

const DEFAULT_BATCH_SIZE = 32;

export async function embedAndStoreItems(
  items: FeedItem[],
  encoder: Encoder,
  opts: { batchSize?: number } = {},
): Promise<EmbedJobStats> {
  const batchSize = opts.batchSize ?? DEFAULT_BATCH_SIZE;
  const stats: EmbedJobStats = { total: items.length, skipped: 0, emptySkipped: 0, embedded: 0 };
  if (items.length === 0) {
    return stats;
  }

  // Build the exact encoder input + its hash for each non-empty item.
  const prepared: Array<{ item: FeedItem; input: string; hash: string }> = [];
  for (const item of items) {
    const text = buildItemText(item);
    if (!text) {
      stats.emptySkipped++;
      logger.warn(`No usable text for item ${item.id}; skipping (not storing a zero vector)`);
      continue;
    }
    const input = encoder.documentPrefix + text;
    prepared.push({ item, input, hash: computeSourceHash(encoder.modelName, input) });
  }

  // Resume: drop items whose stored (normalized) hash already matches.
  const stored = await getModelSourceHashes(
    encoder.modelName,
    prepared.map((p) => p.item.id),
  );
  const todo = prepared.filter((p) => stored.get(p.item.id) !== p.hash);
  stats.skipped = prepared.length - todo.length;

  for (let i = 0; i < todo.length; i += batchSize) {
    const chunk = todo.slice(i, i + batchSize);
    const vectors = await encoder.embedDocuments(chunk.map((c) => c.input));
    if (vectors.length !== chunk.length) {
      throw new Error(
        `Encoder returned ${vectors.length} vectors for ${chunk.length} inputs (model ${encoder.modelName})`,
      );
    }
    const rows: ModelEmbeddingRow[] = chunk.map((c, j) => ({
      itemId: c.item.id,
      modelName: encoder.modelName,
      embedding: vectors[j],
      version: encoder.version,
      sourceHash: c.hash,
    }));
    const { saved } = await saveModelEmbeddingsBatch(rows);
    stats.embedded += saved;
  }

  logger.info(
    `Model-embed job for ${encoder.modelName}: embedded ${stats.embedded}, resumed/skipped ${stats.skipped}, ` +
      `empty ${stats.emptySkipped}, total ${stats.total}`,
  );
  return stats;
}
