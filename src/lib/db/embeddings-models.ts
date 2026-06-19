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

/**
 * Stored source hashes for the given items under a model — the resume key for
 * the encoder job (dv0.5.2). Rows with embedding_normalized = false are
 * DELIBERATELY excluded: those are poisoned (a prior bad encoder run) and must
 * be re-embedded, so their absence from this map causes the job to redo them.
 *
 * Errors propagate — a swallowed read returning an empty map would make the job
 * conclude "nothing embedded yet" and re-embed the entire corpus.
 */
export async function getModelSourceHashes(
  modelName: string,
  itemIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (itemIds.length === 0) {
    return out;
  }
  const client = await getDbClient();
  const result = await client.query(
    `SELECT item_id, source_hash FROM item_model_embeddings
     WHERE model_name = $1 AND embedding_normalized = TRUE
       AND item_id = ANY($2)`,
    [modelName, itemIds],
  );
  for (const row of result.rows) {
    out.set(row.item_id as string, row.source_hash as string);
  }
  return out;
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

export interface ModelCoveragePeriod {
  label: string;
  items: number;
  embedded: number;
}

export interface ModelEmbeddingCoverage {
  modelName: string;
  totalItems: number;
  /**
   * Items that CAN be embedded (non-blank text). The completeness denominator —
   * empty-text items are skipped by the job, so `embedded == totalItems` is
   * unreachable; the gate is `embedded >= expected`.
   */
  expected: number;
  /** Items with a usable (normalized) vector for this model. */
  embedded: number;
  /** Stored rows that failed the norm check — a transient signal, should be 0 at convergence. */
  notNormalized: number;
  periods: ModelCoveragePeriod[];
}

const COVERAGE_PERIODS: ReadonlyArray<{ label: string; days: number }> = [
  { label: "last_7d", days: 7 },
  { label: "last_30d", days: 30 },
];

const SECONDS_PER_DAY = 86_400;

/**
 * Coverage of a model's embeddings over the corpus — the backfill health/gate
 * report. Errors propagate: coverage gates the serve flip, so a failed query
 * must not be reported as a best-effort number.
 */
export async function getModelEmbeddingCoverage(
  modelName: string,
): Promise<ModelEmbeddingCoverage> {
  const client = await getDbClient();

  const totals = await client.query(
    `SELECT
       (SELECT COUNT(*) FROM items) AS total_items,
       -- full_text is intentionally excluded: concatenating TOASTed full_text
       -- over all rows is a multi-hundred-MB scan that can hit statement_timeout.
       -- title/summary/snippet decide blankness for ~all items; the rare
       -- full_text-only item just makes expected a slight undercount (the gate
       -- stays lenient, never falsely red).
       (SELECT COUNT(*) FROM items
          WHERE btrim(coalesce(title,'') || ' ' || coalesce(summary,'') || ' ' ||
                      coalesce(content_snippet,'')) <> '') AS expected,
       (SELECT COUNT(*) FROM item_model_embeddings
          WHERE model_name = $1 AND embedding_normalized = TRUE) AS embedded,
       (SELECT COUNT(*) FROM item_model_embeddings
          WHERE model_name = $1 AND embedding_normalized = FALSE) AS not_normalized`,
    [modelName],
  );
  const t = totals.rows[0];

  const nowSec = Math.floor(Date.now() / 1000);
  // Periods are independent — run them concurrently.
  const periods: ModelCoveragePeriod[] = await Promise.all(
    COVERAGE_PERIODS.map(async (period) => {
      const cutoff = nowSec - period.days * SECONDS_PER_DAY;
      const res = await client.query(
        `SELECT COUNT(*) AS items,
                COUNT(ime.item_id) FILTER (WHERE ime.embedding_normalized) AS embedded
         FROM items i
         LEFT JOIN item_model_embeddings ime
           ON ime.item_id = i.id AND ime.model_name = $1
         WHERE i.published_at >= $2`,
        [modelName, cutoff],
      );
      const r = res.rows[0];
      return { label: period.label, items: Number(r.items), embedded: Number(r.embedded) };
    }),
  );

  return {
    modelName,
    totalItems: Number(t.total_items),
    expected: Number(t.expected),
    embedded: Number(t.embedded),
    notNormalized: Number(t.not_normalized),
    periods,
  };
}
