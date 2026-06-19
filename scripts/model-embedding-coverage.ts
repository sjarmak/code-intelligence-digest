#!/usr/bin/env tsx
/**
 * Coverage report for the local nomic blue-green embeddings (dv0.5.3, READ-ONLY).
 *
 * Reports nomic vector coverage over the corpus: total items, expected (items
 * with non-blank text — the real denominator, since empty-text items never
 * embed), embedded (normalized vectors), notNormalized (should be 0 at
 * convergence), and per-period coverage.
 *
 * Exits NON-ZERO when embedded < expected, so it gates dv0.5.4 (serve flip) and
 * tells the dv0.5.8 backfill operator to re-run to convergence. Writes a JSON
 * artifact to .data/ (fixed filename, overwritten each run).
 *
 * Usage: npx tsx scripts/model-embedding-coverage.ts
 */
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load env BEFORE importing the driver (driver reads process.env eagerly).
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

import { getModelEmbeddingCoverage } from "../src/lib/db/embeddings-models";
import { NOMIC_EMBED } from "../src/lib/embeddings/provenance";

function pct(n: number, d: number): string {
  return d === 0 ? "n/a" : `${((100 * n) / d).toFixed(1)}%`;
}

async function main(): Promise<void> {
  const cov = await getModelEmbeddingCoverage(NOMIC_EMBED.model);

  const lines = [
    `Model embedding coverage — ${cov.modelName}`,
    `  total items:     ${cov.totalItems}`,
    `  expected (text): ${cov.expected}`,
    `  embedded:        ${cov.embedded}  (${pct(cov.embedded, cov.expected)} of expected)`,
    `  notNormalized:   ${cov.notNormalized}  (expect 0 at convergence)`,
    `  per-period coverage:`,
    ...cov.periods.map(
      (p) => `    ${p.label}: ${p.embedded}/${p.items}  (${pct(p.embedded, p.items)})`,
    ),
  ];
  console.log(lines.join("\n"));

  const outDir = path.resolve(process.cwd(), ".data");
  fs.mkdirSync(outDir, { recursive: true });
  const outPath = path.join(outDir, "model-embedding-coverage.json");
  fs.writeFileSync(outPath, JSON.stringify(cov, null, 2));
  console.log(`\nWrote ${outPath}`);

  if (cov.embedded < cov.expected) {
    console.error(
      `\nINCOMPLETE: embedded ${cov.embedded} < expected ${cov.expected} — re-run the backfill to convergence.`,
    );
    process.exit(1);
  }
  if (cov.notNormalized > 0) {
    console.error(
      `\nWARNING: ${cov.notNormalized} non-normalized rows — re-run the backfill to redo them.`,
    );
    process.exit(1);
  }
}

main().catch((error) => {
  console.error("model-embedding-coverage failed", error);
  process.exit(1);
});
