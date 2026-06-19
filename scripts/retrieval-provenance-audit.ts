#!/usr/bin/env tsx
/**
 * M0 — Embedding provenance + metric-space sanity audit (READ-ONLY).
 *
 * Decides go/no-go for the vector lane and the cross-corpus "related papers"
 * feature BEFORE any fusion code is written (PRD M0, premortem risk #1 Theme A).
 *
 * What it answers empirically (not by trusting the `embedding_model` column,
 * which records intent, not reality — `generateEmbedding` silently stores
 * hash-based pseudo-embeddings and zero vectors under the same default label):
 *
 *   1. pgvector extversion (asserted at startup later; reported here).
 *   2. item_embeddings: count, model labels, dims, and the L2-NORM distribution.
 *      Real OpenAI text-embedding-3-small vectors are unit-normalized (‖v‖≈1);
 *      zero vectors ‖v‖=0; padded pseudo-embeddings ‖v‖≈18. Norm is the only
 *      trustworthy provenance signal until the M0 columns are backfilled.
 *   3. paper_sections: same, plus how many sections actually carry a vector.
 *   4. Cross-corpus metric-space sanity: nearest paper-section per sampled item
 *      vs a random item×paper baseline. If nearest ≈ random, the shared space is
 *      uninformative and "related papers" is NOT viable regardless of code intent.
 *   5. Serve-path self-similarity: re-embed a few items through the live
 *      generator and cosine against the stored vector. Expect ≈1.0 for real rows.
 *
 * Norm profiling uses a deterministic md5-modulo ROW SAMPLE (not a full-table
 * scan): computing ‖v‖ over all 116K×1536-dim vectors in a seq scan exceeds the
 * statement timeout. md5(id) sampling is unbiased w.r.t. insertion order, which
 * matters because pseudo-embeddings cluster in API-key-outage time windows.
 *
 * Usage: npx tsx scripts/retrieval-provenance-audit.ts
 * Output: human-readable report to stdout + JSON artifact in .data/.
 */

import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load env BEFORE importing the driver (driver reads process.env eagerly).
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getDbClient } from "../src/lib/db/driver";
import { loadItem } from "../src/lib/db/items";
import { generateEmbedding } from "../src/lib/embeddings/generate";

// ‖v‖ via pgvector: (v <#> v) = -‖v‖²  →  ‖v‖ = sqrt(-(v <#> v)).
const NORM = "sqrt(GREATEST(-(embedding <#> embedding), 0))";

// Deterministic ~1/divisor row sample keyed on a column's md5 — unbiased w.r.t.
// physical/insertion order, no full sort of vectors. Mask to positive int.
const md5Sample = (idCol: string, divisor: number) =>
  `abs(('x' || substr(md5(${idCol}), 1, 8))::bit(32)::int8) % ${divisor} = 0`;

// Bucket a precomputed norm `n`. Order-prefixed so SQL ORDER BY reads naturally.
const bucketCase = `CASE
    WHEN n < 0.01              THEN '1_zero (<0.01)'
    WHEN n BETWEEN 0.9 AND 1.1 THEN '2_normalized ~1 (real OpenAI)'
    WHEN n < 0.9               THEN '3_low (0.01-0.9)'
    WHEN n <= 2.0              THEN '4_high (1.1-2.0)'
    ELSE                            '5_pseudo/large (>2)'
  END`;

interface NormRow {
  bucket: string;
  cnt: number;
  min_n: string;
  max_n: string;
  avg_n: string;
}

interface Report {
  generatedAt: string;
  databaseHost: string;
  pgvectorVersion: string | null;
  itemEmbeddings: Record<string, unknown>;
  paperSections: Record<string, unknown>;
  crossCorpus: Record<string, unknown>;
  selfSimilarity: Record<string, unknown>;
  verdict: Record<string, unknown>;
}

function fmtPct(part: number, whole: number): string {
  if (!whole) return "0%";
  return `${((part / whole) * 100).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const client = await getDbClient();
  // Bound every query — a degenerate plan degrades that section, not the run.
  await client.query("SET statement_timeout = '40000'");

  const dbUrl = process.env.LOCAL_DATABASE_URL || process.env.DATABASE_URL || "";
  const dbHost = (() => {
    try {
      return new URL(dbUrl).host;
    } catch {
      return "(unparseable)";
    }
  })();

  const report: Report = {
    generatedAt: new Date().toISOString(),
    databaseHost: dbHost,
    pgvectorVersion: null,
    itemEmbeddings: {},
    paperSections: {},
    crossCorpus: {},
    selfSimilarity: {},
    verdict: {},
  };

  const out: string[] = [];
  const log = (s = "") => {
    out.push(s);
    console.log(s);
  };
  const section = async (name: string, fn: () => Promise<void>) => {
    try {
      await fn();
    } catch (e) {
      log(`    !! section "${name}" failed: ${(e as Error).message}`);
    }
  };

  log("═".repeat(72));
  log("M0 EMBEDDING PROVENANCE + METRIC-SPACE AUDIT (read-only)");
  log(`db host: ${dbHost}   at: ${report.generatedAt}`);
  log("═".repeat(72));

  // ── 1. pgvector version ───────────────────────────────────────────────
  await section("pgvector version", async () => {
    const ext = await client.query(
      "SELECT extversion FROM pg_extension WHERE extname = 'vector'"
    );
    report.pgvectorVersion = (ext.rows[0]?.extversion as string | undefined) ?? null;
    log(`\n[1] pgvector extversion: ${report.pgvectorVersion ?? "NOT INSTALLED"}`);
  });

  // ── 2. item_embeddings ────────────────────────────────────────────────
  let itTotal = 0;
  let realItemPct = 0;
  const realItemIds: string[] = [];
  await section("item_embeddings", async () => {
    log("\n[2] item_embeddings");
    const totalRes = await client.query(
      "SELECT COUNT(*)::int AS total, MIN(generated_at) AS gen_min, MAX(generated_at) AS gen_max FROM item_embeddings"
    );
    itTotal = totalRes.rows[0].total as number;
    log(`    total rows: ${itTotal}`);
    log(`    generated_at range: ${totalRes.rows[0].gen_min} → ${totalRes.rows[0].gen_max}`);

    const models = (
      await client.query(
        "SELECT COALESCE(embedding_model, '(null)') AS model, COUNT(*)::int AS cnt FROM item_embeddings GROUP BY 1 ORDER BY 2 DESC"
      )
    ).rows as Array<{ model: string; cnt: number }>;
    log("    embedding_model label (recorded intent, NOT verified):");
    for (const r of models)
      log(`      ${r.model}: ${r.cnt} (${fmtPct(r.cnt, itTotal)})`);

    const dims = (
      await client.query(
        "SELECT vector_dims(embedding) AS dims, COUNT(*)::int AS cnt FROM item_embeddings GROUP BY 1 ORDER BY 2 DESC"
      )
    ).rows as Array<{ dims: number; cnt: number }>;
    log("    vector_dims:");
    for (const r of dims) log(`      ${r.dims}-dim: ${r.cnt}`);

    // Norm profile over a deterministic md5 sample (≈ itTotal/23 rows).
    const SAMPLE_DIV = 23;
    const norms = (
      await client.query(`
      SELECT ${bucketCase} AS bucket, COUNT(*)::int AS cnt,
             ROUND(MIN(n)::numeric,4) AS min_n, ROUND(MAX(n)::numeric,4) AS max_n,
             ROUND(AVG(n)::numeric,4) AS avg_n
      FROM (SELECT ${NORM} AS n FROM item_embeddings WHERE ${md5Sample("item_id", SAMPLE_DIV)}) s
      GROUP BY bucket ORDER BY bucket`)
    ).rows as unknown as NormRow[];
    const sampleN = norms.reduce((s, r) => s + r.cnt, 0);
    log(`    L2-norm distribution over md5 sample (${sampleN} rows ≈ 1/${SAMPLE_DIV}) — TRUE provenance signal:`);
    for (const r of norms)
      log(`      ${r.bucket}: ${r.cnt} (${fmtPct(r.cnt, sampleN)})  [norm ${r.min_n}…${r.max_n}, avg ${r.avg_n}]`);
    const realRow = norms.find((r) => r.bucket.startsWith("2_"));
    realItemPct = sampleN ? (realRow?.cnt ?? 0) / sampleN : 0;

    // A few confirmed-real ids for sections 4/5 (cheap: small md5 sample + filter).
    const ids = await client.query(
      `SELECT item_id FROM (
         SELECT item_id, ${NORM} AS n FROM item_embeddings WHERE ${md5Sample("item_id", 97)}
       ) s WHERE n BETWEEN 0.9 AND 1.1 LIMIT 16`
    );
    realItemIds.push(...ids.rows.map((r) => r.item_id as string));

    report.itemEmbeddings = {
      total: itTotal,
      models,
      dims,
      normSample: { sampleSize: sampleN, divisor: SAMPLE_DIV, buckets: norms },
      realPctEstimate: realItemPct,
    };
  });

  // ── 3. paper_sections ─────────────────────────────────────────────────
  let paperEmbTotal = 0;
  await section("paper_sections", async () => {
    log("\n[3] paper_sections");
    const ps = await client.query(
      "SELECT COUNT(*)::int AS total, COUNT(embedding)::int AS with_emb FROM paper_sections"
    );
    const psTotal = ps.rows[0].total as number;
    paperEmbTotal = ps.rows[0].with_emb as number;
    log(`    total sections: ${psTotal}    with embedding: ${paperEmbTotal} (${fmtPct(paperEmbTotal, psTotal)})`);
    report.paperSections = { total: psTotal, withEmbedding: paperEmbTotal };
    if (paperEmbTotal > 0) {
      const SAMPLE_DIV = 7;
      const norms = (
        await client.query(`
        SELECT ${bucketCase} AS bucket, COUNT(*)::int AS cnt,
               ROUND(MIN(n)::numeric,4) AS min_n, ROUND(MAX(n)::numeric,4) AS max_n,
               ROUND(AVG(n)::numeric,4) AS avg_n
        FROM (SELECT ${NORM} AS n FROM paper_sections
              WHERE embedding IS NOT NULL AND ${md5Sample("id", SAMPLE_DIV)}) s
        GROUP BY bucket ORDER BY bucket`)
      ).rows as unknown as NormRow[];
      const sampleN = norms.reduce((s, r) => s + r.cnt, 0);
      log(`    L2-norm distribution over md5 sample (${sampleN} rows ≈ 1/${SAMPLE_DIV}):`);
      for (const r of norms)
        log(`      ${r.bucket}: ${r.cnt} (${fmtPct(r.cnt, sampleN)})  [norm ${r.min_n}…${r.max_n}, avg ${r.avg_n}]`);
      (report.paperSections as Record<string, unknown>).normSample = {
        sampleSize: sampleN,
        divisor: SAMPLE_DIV,
        buckets: norms,
      };
    }
  });

  // ── 4. Cross-corpus metric-space sanity ───────────────────────────────
  let crossSeparable = false;
  await section("cross-corpus", async () => {
    log("\n[4] cross-corpus metric-space sanity (item ↔ paper_section)");
    if (paperEmbTotal === 0) {
      log("    SKIPPED: no paper_section embeddings present. 'related papers' is blocked");
      log("    on a paper-embedding backfill, NOT on metric-space mismatch.");
      report.crossCorpus = { skipped: "no paper embeddings" };
      return;
    }
    const sampleIds = realItemIds.slice(0, 12);
    const nearestCosines: number[] = [];
    log("    nearest paper-section per sampled item (top-1 cosine, HNSW):");
    for (const itemId of sampleIds) {
      const nn = await client.query(
        `SELECT i.title, ps.bibcode, ps.section_title,
                1 - (ps.embedding <=> ie.embedding) AS cos
         FROM item_embeddings ie
         JOIN items i ON i.id = ie.item_id
         CROSS JOIN LATERAL (
           SELECT bibcode, section_title, embedding FROM paper_sections
           WHERE embedding IS NOT NULL
           ORDER BY embedding <=> ie.embedding LIMIT 1
         ) ps
         WHERE ie.item_id = $1`,
        [itemId]
      );
      const top = nn.rows[0];
      if (top) {
        const cos = Number(top.cos);
        nearestCosines.push(cos);
        log(`      cos=${cos.toFixed(3)}  "${String(top.title).slice(0, 46)}"  →  [${top.bibcode}] ${String(top.section_title).slice(0, 30)}`);
      }
    }

    // Random item×paper baseline: zip 300 of each by row number (md5 sample, no big sort).
    const baseline = await client.query(`
      WITH a AS (SELECT row_number() OVER () rn, embedding FROM
                   (SELECT embedding FROM item_embeddings WHERE ${md5Sample("item_id", 23)} LIMIT 300) x),
           b AS (SELECT row_number() OVER () rn, embedding FROM
                   (SELECT embedding FROM paper_sections WHERE embedding IS NOT NULL AND ${md5Sample("id", 7)} LIMIT 300) y)
      SELECT ROUND(AVG(1 - (a.embedding <=> b.embedding))::numeric,4) AS avg_cos,
             ROUND(MIN(1 - (a.embedding <=> b.embedding))::numeric,4) AS min_cos,
             ROUND(MAX(1 - (a.embedding <=> b.embedding))::numeric,4) AS max_cos,
             ROUND(percentile_cont(0.95) WITHIN GROUP (ORDER BY 1 - (a.embedding <=> b.embedding))::numeric,4) AS p95_cos
      FROM a JOIN b USING (rn)`);
    const base = baseline.rows[0];
    const meanNearest = nearestCosines.reduce((s, c) => s + c, 0) / Math.max(nearestCosines.length, 1);
    log("");
    log(`    random item×paper baseline:  avg=${base.avg_cos}  p95=${base.p95_cos}  [${base.min_cos}…${base.max_cos}]`);
    log(`    mean nearest-neighbour cosine: ${meanNearest.toFixed(4)}`);
    const lift = meanNearest - Number(base.avg_cos);
    crossSeparable = lift > 0.1;
    log(`    LIFT (nearest − random avg): ${lift.toFixed(4)}  ${crossSeparable ? "✓ informative" : "✗ NOT separable"}`);
    report.crossCorpus = {
      sampledItems: sampleIds.length,
      nearestCosines,
      meanNearest,
      randomBaseline: base,
      lift,
      separable: crossSeparable,
    };
  });

  // ── 5. Serve-path self-similarity ─────────────────────────────────────
  // CAVEAT: this test only validates the live generator if the OpenAI key is
  // valid. `generateEmbedding` silently falls back to a pseudo-embedding
  // (norm ≫ 1) on a 401/outage — which would read as "drift" if we did not
  // detect it. We norm-check each freshly generated vector and, if it is a
  // pseudo-fallback, report the test as BLOCKED (dead key), not as drift.
  let meanSelf = 0;
  let liveKeyOk = true;
  await section("self-similarity", async () => {
    log("\n[5] serve-path self-similarity (re-embed live, cosine vs stored)");
    const selfIds = realItemIds.slice(12, 17).length
      ? realItemIds.slice(12, 17)
      : realItemIds.slice(0, 5);
    const selfSims: Array<{ itemId: string; selfSim: number | null; freshNorm: number }> = [];
    for (const itemId of selfIds) {
      const item = await loadItem(itemId);
      if (!item) {
        selfSims.push({ itemId, selfSim: null, freshNorm: 0 });
        continue;
      }
      // Rebuild the canonical embedding text exactly as populate-embeddings.ts.
      const fullText = item.fullText ? item.fullText.substring(0, 2000) : "";
      const text =
        `${item.title} ${item.summary || ""} ${item.contentSnippet || ""} ${fullText}`.trim() ||
        item.title;
      const fresh = await generateEmbedding(text);
      const freshNorm = Math.sqrt(fresh.reduce((s, x) => s + x * x, 0));
      if (freshNorm > 2) liveKeyOk = false; // pseudo-fallback signature
      const vectorStr = `[${fresh.join(",")}]`;
      const sim = await client.query(
        "SELECT 1 - (embedding <=> $1::vector) AS cos FROM item_embeddings WHERE item_id = $2",
        [vectorStr, itemId]
      );
      const cos = sim.rows[0] ? Number(sim.rows[0].cos) : null;
      selfSims.push({ itemId, selfSim: cos, freshNorm });
      log(`    ${itemId.slice(0, 22)}…  self-sim=${cos === null ? "n/a" : cos.toFixed(4)}  (fresh‖v‖=${freshNorm.toFixed(2)})  "${item.title.slice(0, 34)}"`);
    }
    const valid = selfSims.filter((s) => s.selfSim !== null) as Array<{ selfSim: number }>;
    meanSelf = valid.reduce((s, x) => s + x.selfSim, 0) / Math.max(valid.length, 1);
    if (!liveKeyOk) {
      log(`    ⚠ live generator returned PSEUDO embeddings (‖v‖≫1) → OPENAI_API_KEY invalid in this env.`);
      log(`      self-similarity is INDETERMINATE here, not drift. Re-run with a valid key to confirm ≈1.0.`);
    } else {
      log(`    mean self-similarity: ${meanSelf.toFixed(4)} (expect ≈ 1.0 for real rows)`);
    }
    report.selfSimilarity = { samples: selfSims, meanSelfSim: meanSelf, liveKeyOk };
  });

  // ── Verdict ───────────────────────────────────────────────────────────
  const selfOk = liveKeyOk && meanSelf >= 0.98;
  log("\n" + "═".repeat(72));
  log("VERDICT");
  log("═".repeat(72));
  log(`  item-embedding provenance: ${(realItemPct * 100).toFixed(1)}% unit-norm (real OpenAI) [sampled]`);
  log(`    → ${realItemPct >= 0.95 ? "✓ clean (residual pseudo to re-embed)" : "✗ MIXED — pseudo/zero vectors present, must re-embed or filter"}`);
  log(
    `  serve-path self-similarity: ${
      !liveKeyOk
        ? "⊘ INDETERMINATE — OPENAI_API_KEY invalid in this env (pseudo fallback); re-run with valid key"
        : `${meanSelf.toFixed(3)} → ${selfOk ? "✓ generator matches stored space" : "✗ DRIFT — live generator ≠ stored vectors"}`
    }`
  );
  if (paperEmbTotal === 0) {
    log(`  related-papers viability: ✗ BLOCKED — no paper embeddings to join`);
  } else {
    log(`  related-papers viability: ${crossSeparable ? "✓ shared space is informative (nearest >> random)" : "✗ NOT viable — nearest paper indistinguishable from random"}`);
  }
  report.verdict = {
    itemProvenanceClean: realItemPct >= 0.95,
    realItemPctEstimate: realItemPct,
    selfSimilarityOk: selfOk,
    selfSimilarityIndeterminate: !liveKeyOk,
    meanSelfSim: meanSelf,
    relatedPapersViable: paperEmbTotal > 0 && crossSeparable,
    paperEmbeddingsPresent: paperEmbTotal,
  };

  // ── Persist artifact ──────────────────────────────────────────────────
  const dataDir = path.resolve(process.cwd(), ".data");
  fs.mkdirSync(dataDir, { recursive: true });
  const jsonPath = path.join(dataDir, "m0-provenance-audit.json");
  const txtPath = path.join(dataDir, "m0-provenance-audit.txt");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(txtPath, out.join("\n") + "\n");
  log(`\nArtifacts written:\n  ${jsonPath}\n  ${txtPath}`);

  process.exit(0);
}

main().catch((e) => {
  console.error("Audit failed:", e);
  process.exit(1);
});
