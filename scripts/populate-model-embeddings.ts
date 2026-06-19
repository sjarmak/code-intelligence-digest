#!/usr/bin/env tsx
/**
 * Batch job: generate local nomic-embed-text-v1.5 (768d) embeddings into the
 * blue-green item_model_embeddings table, alongside the live OpenAI corpus.
 *
 * Runs the real NomicEncoder (Transformers.js / ONNX), which downloads the model
 * from Hugging Face on first use — run this on the LARGER batch instance, NOT the
 * 512MB web container. Idempotent: re-runs resume via source_hash.
 *
 * Usage:
 *   npx tsx scripts/populate-model-embeddings.ts [--limit <n>] [--batch-size <n>]
 *
 * --limit is for small test runs; the full-corpus backfill (paginated, on the
 * larger instance) is dv0.5.3.
 */
import { initializeDatabase } from "../src/lib/db/index";
import { loadAllItems } from "../src/lib/db/items";
import { NomicEncoder } from "../src/lib/embeddings/nomic-encoder";
import { embedAndStoreItems } from "../src/lib/embeddings/model-embed-job";
import { logger } from "../src/lib/logger";

interface CliOptions {
  limit: number | null;
  batchSize: number;
}

function parseArgs(argv: string[]): CliOptions {
  const opts: CliOptions = { limit: null, batchSize: 32 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isNaN(n)) throw new Error("--limit must be a number");
      opts.limit = n;
    } else if (arg === "--batch-size" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isNaN(n) || n <= 0) throw new Error("--batch-size must be a positive number");
      opts.batchSize = n;
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  await initializeDatabase();

  const items = await loadAllItems();
  const selected = opts.limit !== null ? items.slice(0, opts.limit) : items;
  logger.info(`Embedding ${selected.length} items with nomic (batchSize=${opts.batchSize})`);

  const encoder = new NomicEncoder();
  const stats = await embedAndStoreItems(selected, encoder, { batchSize: opts.batchSize });
  logger.info(`Done: ${JSON.stringify(stats)}`);
}

main().catch((error) => {
  logger.error("populate-model-embeddings failed", error);
  process.exit(1);
});
