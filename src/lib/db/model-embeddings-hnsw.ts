/**
 * Post-backfill HNSW index for the blue-green nomic store (dv0.5.8).
 *
 * The vector index is deliberately NOT created at schema init: building HNSW on
 * an empty table and then bulk-loading pays per-row graph maintenance (see
 * schema-postgres.ts). It is created here, ONCE, after the dv0.5.8 backfill
 * converges.
 *
 * Build constraints (architect C2/C3):
 *  - CONCURRENTLY, so the live cron's reads/writes are not blocked by an
 *    ACCESS EXCLUSIVE lock for the duration of the build.
 *  - statement_timeout=0 on this session, because the driver's 120s pool
 *    timeout would kill a multi-minute index build.
 *  - vector_cosine_ops, matching the serve query (mirror-context.ts uses
 *    `embedding <=> $::vector`, i.e. cosine distance on the plain vector(768)
 *    column). halfvec is a separate change (dv0.5.7) and would require the
 *    serve path to cast — out of scope here.
 *  - A CONCURRENTLY build that fails leaves an INVALID index behind, and
 *    `CREATE INDEX ... IF NOT EXISTS` would then silently skip the rebuild.
 *    So we check pg_index.indisvalid and DROP+retry once on an invalid index.
 */

/** Minimal surface of a pg client — `pg.PoolClient` satisfies this. */
export interface SqlRunner {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export const HNSW_TABLE = "item_model_embeddings";
export const HNSW_COLUMN = "embedding";
export const HNSW_INDEX_NAME = "idx_item_model_embeddings_hnsw";

/** Default server-side build memory; raise via env for a larger Postgres. */
export const DEFAULT_MAINTENANCE_WORK_MEM = "256MB";

export function createIndexSql(): string {
  return (
    `CREATE INDEX CONCURRENTLY IF NOT EXISTS ${HNSW_INDEX_NAME} ` +
    `ON ${HNSW_TABLE} USING hnsw (${HNSW_COLUMN} vector_cosine_ops)`
  );
}

export function dropIndexSql(): string {
  return `DROP INDEX CONCURRENTLY IF EXISTS ${HNSW_INDEX_NAME}`;
}

/**
 * indisvalid for the HNSW index. Constrained to an index relation (relkind
 * 'i'/'I') in the current schema so a same-named relation in another schema
 * can't be mistaken for it — the result drives a DROP, so it must be precise.
 */
export const indexValiditySql =
  `SELECT i.indisvalid AS valid ` +
  `FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid ` +
  `WHERE c.relname = $1 ` +
  `AND c.relkind IN ('i', 'I') ` +
  `AND c.relnamespace = current_schema()::regnamespace`;

export interface EnsureHnswOptions {
  /** Server-side maintenance_work_mem for the build (default 256MB). */
  maintenanceWorkMem?: string;
}

export interface EnsureHnswResult {
  /** True if the index is valid at exit. */
  valid: boolean;
  /** True if an invalid index was dropped and rebuilt. */
  retried: boolean;
}

/** True iff the HNSW index relation exists and pg_index.indisvalid is set. */
async function isIndexValid(client: SqlRunner): Promise<boolean> {
  const res = await client.query(indexValiditySql, [HNSW_INDEX_NAME]);
  const row = res.rows[0];
  return typeof row === "object" && row !== null && Boolean((row as { valid: unknown }).valid);
}

/**
 * Create the HNSW index on {@link HNSW_TABLE} if absent, and guarantee it is
 * valid at exit. Idempotent: a second run over a valid index is a no-op.
 *
 * The caller owns the connection lifecycle (this must run on a dedicated client
 * — CREATE INDEX CONCURRENTLY cannot run inside a transaction block, and the
 * session GUCs set here would otherwise leak to pooled callers).
 *
 * Throws if the index is still invalid after one DROP+rebuild — a failure that
 * must surface, not be swallowed.
 */
export async function ensureModelEmbeddingsHnswIndex(
  client: SqlRunner,
  options: EnsureHnswOptions = {},
): Promise<EnsureHnswResult> {
  const workMem = options.maintenanceWorkMem ?? DEFAULT_MAINTENANCE_WORK_MEM;

  // set_config(text, text, is_local=false) is injection-safe and applies for
  // the rest of this session (no transaction — CONCURRENTLY forbids one).
  await client.query("SELECT set_config('statement_timeout', '0', false)");
  await client.query("SELECT set_config('maintenance_work_mem', $1, false)", [workMem]);

  await client.query(createIndexSql());

  if (await isIndexValid(client)) {
    return { valid: true, retried: false };
  }

  // Invalid (a prior CONCURRENTLY build failed) — IF NOT EXISTS skipped the
  // rebuild, so drop the corpse and build it again.
  await client.query(dropIndexSql());
  await client.query(createIndexSql());

  if (await isIndexValid(client)) {
    return { valid: true, retried: true };
  }

  throw new Error(
    `HNSW index ${HNSW_INDEX_NAME} is still invalid after DROP+rebuild — ` +
      `inspect the Postgres logs (build likely OOMed; raise maintenance_work_mem ` +
      `or the instance size).`,
  );
}
