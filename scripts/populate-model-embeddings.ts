#!/usr/bin/env tsx
/**
 * Batch job: generate local nomic-embed-text-v1.5 (768d) embeddings into the
 * blue-green item_model_embeddings table, alongside the live OpenAI corpus.
 *
 * Keyset-paginated (bounded memory) so it can run the full ~116K-item corpus on
 * the LARGER batch instance — NOT the 512MB web container. Idempotent: re-runs
 * resume via source_hash, so this is meant to be RE-RUN TO CONVERGENCE (live
 * cron writes items concurrently; non-monotonic ids mean a single pass can miss
 * late arrivals — check scripts/model-embedding-coverage.ts).
 *
 * Reproducibility: set HF_HOME to a persistent disk and NOMIC_MODEL_REVISION to
 * a pinned commit SHA; after the cache is warm, TRANSFORMERS_OFFLINE=1.
 *
 * Usage:
 *   npx tsx scripts/populate-model-embeddings.ts [--limit <n>] [--batch-size <n>] [--page-size <n>]
 */
import { initializeDatabase } from "../src/lib/db/index";
import { loadItemsPage } from "../src/lib/db/items";
import { NomicEncoder } from "../src/lib/embeddings/nomic-encoder";
import { embedAndStoreItems, type EmbedJobStats } from "../src/lib/embeddings/model-embed-job";
import { logger } from "../src/lib/logger";

interface CliOptions {
  limit: number | null;
  batchSize: number;
  pageSize: number;
}

function parseArgs(argv: string[]): CliOptions {
  // Page is a small multiple of a batch (full_text is unbounded TEXT, so a huge
  // page can OOM — defeating the point of paginating).
  const opts: CliOptions = { limit: null, batchSize: 32, pageSize: 256 };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--limit" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isNaN(n) || n <= 0) throw new Error("--limit must be a positive number");
      opts.limit = n;
    } else if (arg === "--batch-size" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isNaN(n) || n <= 0) throw new Error("--batch-size must be a positive number");
      opts.batchSize = n;
    } else if (arg === "--page-size" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isNaN(n) || n <= 0) throw new Error("--page-size must be a positive number");
      opts.pageSize = n;
    }
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  await initializeDatabase();

  logger.info(
    `nomic backfill starting (batchSize=${opts.batchSize}, pageSize=${opts.pageSize}` +
      `${opts.limit !== null ? `, limit=${opts.limit}` : ""}); ` +
      `HF_HOME=${process.env.HF_HOME ?? "(default ~/.cache/huggingface)"}, ` +
      `revision=${process.env.NOMIC_MODEL_REVISION ?? "main"}, ` +
      `offline=${process.env.TRANSFORMERS_OFFLINE ?? "0"}`,
  );

  // Construct the encoder ONCE — it lazy-loads the ONNX model on first use; a
  // per-page instance would reload the model every page.
  const encoder = new NomicEncoder();

  const totals: EmbedJobStats = { total: 0, skipped: 0, emptySkipped: 0, embedded: 0 };
  let cursor = "";
  let processed = 0;

  for (;;) {
    const remaining = opts.limit !== null ? opts.limit - processed : opts.pageSize;
    if (remaining <= 0) break;
    const pageLimit = opts.limit !== null ? Math.min(opts.pageSize, remaining) : opts.pageSize;

    const { items, rawCount, nextCursor } = await loadItemsPage(cursor, pageLimit);
    if (items.length > 0) {
      const stats = await embedAndStoreItems(items, encoder, { batchSize: opts.batchSize });
      totals.total += stats.total;
      totals.skipped += stats.skipped;
      totals.emptySkipped += stats.emptySkipped;
      totals.embedded += stats.embedded;
    }
    // Budget --limit on RAW rows so URL-filtered rows still consume the limit
    // (otherwise --limit N would page past N raw rows).
    processed += rawCount;
    logger.info(
      `page done (raw=${processed}): embedded=${totals.embedded}, skipped=${totals.skipped}`,
    );

    if (nextCursor === null) break; // corpus exhausted
    cursor = nextCursor;
  }

  logger.info(`nomic backfill done: ${JSON.stringify(totals)}`);
}

main().catch((error) => {
  logger.error("populate-model-embeddings failed", error);
  process.exit(1);
});
