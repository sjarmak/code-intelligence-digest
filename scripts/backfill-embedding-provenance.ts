#!/usr/bin/env tsx
/**
 * M0 — backfill embedding provenance from the MEASURED L2 norm.
 *
 * The `embedding_model` column defaults to 'text-embedding-3-small' for every
 * row, including the ~1.5% that are non-semantic hash pseudo-embeddings written
 * when OPENAI_API_KEY was unavailable. This job rewrites the provenance columns
 * from each vector's true norm so the cosine guard and the vector lane can trust
 * and exclude them:
 *
 *   - norm ∈ [0.9, 1.1] at 1536 dims → text-embedding-3-small, normalized = true
 *   - otherwise                       → pseudo-fallback, normalized = false
 *     (version 'zero-vector' if norm < 0.9, else 'hash-pseudo')
 *
 * Bounded + incremental (premortem M12): keyset-chunked over the PK, norm
 * computed set-based in SQL (never in Node heap), each statement under
 * statement_timeout. Idempotent — re-running converges to the same labels.
 *
 * Usage:
 *   npx tsx scripts/backfill-embedding-provenance.ts            # apply
 *   npx tsx scripts/backfill-embedding-provenance.ts --dry-run  # report only
 */

import * as dotenv from "dotenv";
import * as path from "path";

dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getDbClient } from "../src/lib/db/driver";
import { NORM_MIN, NORM_MAX, CURRENT_EMBEDDING } from "../src/lib/embeddings/provenance";

const CHUNK = 3000;
const DIM = CURRENT_EMBEDDING.dimensions;
// Provenance classification expressed once, in SQL, matching provenance.ts.
const IS_REAL = `(n BETWEEN ${NORM_MIN} AND ${NORM_MAX} AND d = ${DIM})`;

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const client = await getDbClient();
  await client.query("SET statement_timeout = '40000'");

  const totalRes = await client.query(
    "SELECT COUNT(*)::int AS c FROM item_embeddings"
  );
  const total = totalRes.rows[0].c as number;
  console.log(`item_embeddings rows: ${total}  mode: ${dryRun ? "DRY-RUN" : "APPLY"}`);

  if (dryRun) {
    // Single grouped pass over an md5 sample (full-table norm scan times out).
    const r = await client.query(`
      SELECT CASE WHEN ${IS_REAL} THEN 'real' WHEN n < ${NORM_MIN} THEN 'zero' ELSE 'pseudo' END AS klass,
             COUNT(*)::int AS cnt
      FROM (
        SELECT sqrt(GREATEST(-(embedding <#> embedding), 0)) AS n, vector_dims(embedding) AS d
        FROM item_embeddings
        WHERE abs(('x' || substr(md5(item_id), 1, 8))::bit(32)::int8) % 23 = 0
      ) s GROUP BY 1 ORDER BY 1`);
    console.log("Sampled classification (≈1/23):");
    for (const row of r.rows) console.log(`  ${row.klass}: ${row.cnt}`);
    process.exit(0);
  }

  let cursor = "";
  let processed = 0;
  let real = 0;
  let pseudo = 0;
  for (;;) {
    const res = await client.query(
      `WITH chunk AS (
         SELECT item_id,
                sqrt(GREATEST(-(embedding <#> embedding), 0)) AS n,
                vector_dims(embedding) AS d
         FROM item_embeddings
         WHERE item_id > $1
         ORDER BY item_id
         LIMIT ${CHUNK}
       )
       UPDATE item_embeddings e
       SET embedding_dimensions = c.d,
           embedding_normalized = ${IS_REAL},
           embedding_model = CASE WHEN ${IS_REAL} THEN '${CURRENT_EMBEDDING.model}' ELSE 'pseudo-fallback' END,
           embedding_version = CASE WHEN ${IS_REAL} THEN '${CURRENT_EMBEDDING.version}'
                                    WHEN c.n < ${NORM_MIN} THEN 'zero-vector' ELSE 'hash-pseudo' END
       FROM chunk c
       WHERE e.item_id = c.item_id
       RETURNING e.item_id, c.n, e.embedding_normalized AS norm_ok`,
      [cursor]
    );
    if (res.rows.length === 0) break;

    for (const row of res.rows) {
      if (row.norm_ok) real++;
      else pseudo++;
      if ((row.item_id as string) > cursor) cursor = row.item_id as string;
    }
    processed += res.rows.length;
    console.log(`  …${processed}/${total}  (real ${real}, pseudo/zero ${pseudo})`);
  }

  console.log(
    `\nDone. ${processed} rows labeled — ${real} real (${((real / processed) * 100).toFixed(1)}%), ` +
      `${pseudo} pseudo/zero (${((pseudo / processed) * 100).toFixed(1)}%).`
  );
  console.log("Pseudo/zero rows are now embedding_normalized = FALSE and excluded from the vector lane.");
  process.exit(0);
}

main().catch((e) => {
  console.error("Backfill failed:", e);
  process.exit(1);
});
