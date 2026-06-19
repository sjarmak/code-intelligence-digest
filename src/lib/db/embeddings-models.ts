/**
 * Multi-model (blue-green) embedding persistence — the storage substrate for the
 * dv0.5 migration off OpenAI to a local nomic encoder.
 *
 * Writes land in `item_model_embeddings`, keyed by (item_id, model_name), so the
 * local 768d corpus is backfilled ALONGSIDE the live OpenAI 1536d corpus in
 * `item_embeddings` without touching the serve path. The serve-path flip
 * (dv0.5.4) is a separate, eval-gated bead.
 */

import { createHash } from "node:crypto";
import { getDbClient } from "./driver";
import { embeddingNorm, NORM_MIN, NORM_MAX } from "../embeddings/provenance";
import { logger } from "../logger";

/** A vector ready to persist, with its model identity and resume hash. */
export interface ModelEmbeddingRow {
  itemId: string;
  modelName: string;
  embedding: number[];
  /** Provenance version label, e.g. NOMIC_EMBED.version. */
  version: string;
  /** Result of computeSourceHash(modelName, encoderInput) — drives idempotent resume. */
  sourceHash: string;
}

/**
 * Idempotent-resume key for a (model, input) pair: sha256 over
 * `${modelName}${encoderInput}`. The NUL separator scopes the hash by
 * model_name so the same text under two models does not collide, and cannot
 * appear in either field, so the boundary is unambiguous. The caller passes the
 * EXACT encoder input (prefix included) — e.g. `"search_document: " + text`.
 */
export function computeSourceHash(modelName: string, encoderInput: string): string {
  return createHash("sha256").update(`${modelName}\u0000${encoderInput}`).digest("hex");
}

/**
 * Upsert a batch of model embeddings on the composite PK (item_id, model_name).
 * `embedding_normalized` is derived from the measured L2 norm (dim-agnostic): a
 * value outside the unit band signals an encoder bug, since nomic is
 * L2-normalized by construction, so it is logged — not silently defaulted true.
 *
 * A wrong-dimension vector is rejected by the vector(768) column itself; combined
 * with error propagation (a write failure during backfill must not be swallowed
 * into silent data loss), every row either saves or throws — so the count is just
 * `saved`. The caller (encoder/backfill job) owns retry policy.
 */
export async function saveModelEmbeddingsBatch(
  rows: ModelEmbeddingRow[],
): Promise<{ saved: number }> {
  if (rows.length === 0) {
    return { saved: 0 };
  }

  const client = await getDbClient();
  let saved = 0;

  for (const row of rows) {
    const dimensions = row.embedding.length;
    const norm = embeddingNorm(row.embedding);
    const normalized = norm >= NORM_MIN && norm <= NORM_MAX;
    if (!normalized) {
      logger.warn(
        `Out-of-band norm ${norm.toFixed(3)} for ${row.modelName} embedding of item ${row.itemId} ` +
          `(expected unit norm in [${NORM_MIN}, ${NORM_MAX}]); storing embedding_normalized=false`,
        { itemId: row.itemId, modelName: row.modelName, norm, dimensions },
      );
    }

    const vectorStr = `[${row.embedding.join(",")}]`;
    await client.run(
      `INSERT INTO item_model_embeddings
         (item_id, model_name, embedding, source_hash, embedding_dimensions, embedding_version, embedding_normalized, generated_at)
       VALUES ($1, $2, $3::vector, $4, $5, $6, $7, EXTRACT(EPOCH FROM NOW())::INTEGER)
       ON CONFLICT (item_id, model_name) DO UPDATE SET
         embedding = $3::vector,
         source_hash = $4,
         embedding_dimensions = $5,
         embedding_version = $6,
         embedding_normalized = $7,
         generated_at = EXTRACT(EPOCH FROM NOW())::INTEGER`,
      [row.itemId, row.modelName, vectorStr, row.sourceHash, dimensions, row.version, normalized],
    );
    saved++;
  }

  logger.info(`Saved ${saved} model embeddings for ${rows[0].modelName}`);
  return { saved };
}

/** Count stored embeddings for a single model — used by the backfill coverage report. */
export async function getModelEmbeddingsCount(modelName: string): Promise<number> {
  const client = await getDbClient();
  const result = await client.query(
    `SELECT COUNT(*) as count FROM item_model_embeddings WHERE model_name = $1`,
    [modelName],
  );
  return parseInt(result.rows[0]?.count as string) || 0;
}
