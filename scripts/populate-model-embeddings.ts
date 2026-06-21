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
import * as dotenv from "dotenv";
import * as path from "path";
import * as fs from "fs";

// Load env before the driver resolves DATABASE_URL (driver reads it lazily at
// getDbClient, so config-after-import is fine).
dotenv.config({ path: path.resolve(process.cwd(), ".env") });
dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });

// Cursor checkpoint: persisted after every page so a killed run (CPU onnxruntime
// can OOM / hit a runner cap after a few hundred inferences) RESUMES where it
// died instead of re-scanning from the start. Run under a shell `while` loop to
// converge: `while ! npx tsx scripts/model-embedding-coverage.ts; do npx tsx \
// scripts/populate-model-embeddings.ts --since-days 30; done`.
const CURSOR_FILE = path.resolve(process.cwd(), ".data", "nomic-backfill-cursor.json");

interface CursorState {
  sinceDays: number | null;
  cursor: string;
}

function readCursor(sinceDays: number | null): string {
  try {
    const state = JSON.parse(fs.readFileSync(CURSOR_FILE, "utf8")) as CursorState;
    // Only resume if the window matches — a different --since-days is a different run.
    if (state.sinceDays === sinceDays && typeof state.cursor === "string") {
      return state.cursor;
    }
  } catch {
    // No checkpoint yet (or unreadable) — start from the beginning.
  }
  return "";
}

function writeCursor(sinceDays: number | null, cursor: string): void {
  fs.mkdirSync(path.dirname(CURSOR_FILE), { recursive: true });
  fs.writeFileSync(CURSOR_FILE, JSON.stringify({ sinceDays, cursor } satisfies CursorState));
}

function clearCursor(): void {
  try {
    fs.rmSync(CURSOR_FILE);
  } catch {
    // already gone
  }
}

import { fileURLToPath } from "node:url";

import { initializeDatabase } from "../src/lib/db/index";
import { loadItemsPage, loadUnembeddedItemsPage } from "../src/lib/db/items";
import { NomicEncoder } from "../src/lib/embeddings/nomic-encoder";
import { embedAndStoreItems, type EmbedJobStats } from "../src/lib/embeddings/model-embed-job";
import { logger } from "../src/lib/logger";

export interface CliOptions {
  limit: number | null;
  batchSize: number;
  pageSize: number;
  sinceDays: number | null;
  restart: boolean;
  /**
   * Scheduled "keep current" mode (i4t.3): select ONLY items missing a
   * normalized nomic embedding (no published_at window), via
   * loadUnembeddedItemsPage. Mutually exclusive with --since-days; ignores the
   * persisted checkpoint cursor (see main()).
   */
  missing: boolean;
}

export function parseArgs(argv: string[]): CliOptions {
  // Page is a small multiple of a batch (full_text is unbounded TEXT, so a huge
  // page can OOM — defeating the point of paginating).
  const opts: CliOptions = {
    limit: null,
    batchSize: 32,
    pageSize: 256,
    sinceDays: null,
    restart: false,
    missing: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--restart") {
      opts.restart = true;
    } else if (arg === "--missing") {
      opts.missing = true;
    } else if (arg === "--limit" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isNaN(n) || n <= 0) throw new Error("--limit must be a positive number");
      opts.limit = n;
    } else if (arg === "--since-days" && i + 1 < argv.length) {
      const n = parseInt(argv[++i], 10);
      if (Number.isNaN(n) || n <= 0) throw new Error("--since-days must be a positive number");
      opts.sinceDays = n;
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
  // --missing selects the anti-join of un-embedded items, which deliberately
  // ignores published_at; a recency window would re-introduce the bug it fixes
  // (newly-ingested items with old publish dates slipping through).
  if (opts.missing && opts.sinceDays !== null) {
    throw new Error("--missing cannot be combined with --since-days (it selects all un-embedded items)");
  }
  return opts;
}

async function main(): Promise<void> {
  const opts = parseArgs(process.argv.slice(2));
  await initializeDatabase();

  const sinceEpoch =
    opts.sinceDays !== null
      ? Math.floor(Date.now() / 1000) - opts.sinceDays * 24 * 60 * 60
      : undefined;

  logger.info(
    `nomic backfill starting (batchSize=${opts.batchSize}, pageSize=${opts.pageSize}` +
      `${opts.missing ? ", mode=missing" : ""}` +
      `${opts.limit !== null ? `, limit=${opts.limit}` : ""}` +
      `${opts.sinceDays !== null ? `, sinceDays=${opts.sinceDays}` : ""}); ` +
      `HF_HOME=${process.env.HF_HOME ?? "(default ~/.cache/huggingface)"}, ` +
      `revision=${process.env.NOMIC_MODEL_REVISION ?? "main"}, ` +
      `offline=${process.env.TRANSFORMERS_OFFLINE ?? "0"}`,
  );

  // Construct the encoder ONCE — it lazy-loads the ONNX model on first use; a
  // per-page instance would reload the model every page.
  const encoder = new NomicEncoder();

  const totals: EmbedJobStats = { total: 0, skipped: 0, emptySkipped: 0, embedded: 0 };
  if (opts.restart) clearCursor();
  // --missing pages from the corpus head every run and never persists a cursor:
  // the anti-join already excludes embedded items, and a stale cross-run cursor
  // would skip newly-missing LOW-id items (the very bug this mode fixes). The
  // checkpoint cursor stays exclusive to the windowed/full backfill path.
  const useCheckpoint = !opts.missing && opts.limit === null;
  let cursor = useCheckpoint ? readCursor(opts.sinceDays) : "";
  if (cursor) logger.info(`resuming from checkpoint cursor …${cursor.slice(-16)}`);
  let processed = 0;

  for (;;) {
    const remaining = opts.limit !== null ? opts.limit - processed : opts.pageSize;
    if (remaining <= 0) break;
    const pageLimit = opts.limit !== null ? Math.min(opts.pageSize, remaining) : opts.pageSize;

    const { items, rawCount, nextCursor } = opts.missing
      ? await loadUnembeddedItemsPage(encoder.modelName, cursor, pageLimit)
      : await loadItemsPage(cursor, pageLimit, sinceEpoch);
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

    if (nextCursor === null) {
      // Window fully scanned — clear the checkpoint so the next run starts fresh.
      if (useCheckpoint) clearCursor();
      break;
    }
    cursor = nextCursor;
    // Checkpoint AFTER the page's writes committed, so a kill resumes past it.
    if (useCheckpoint) writeCursor(opts.sinceDays, cursor);
  }

  logger.info(`nomic backfill done: ${JSON.stringify(totals)}`);
}

// Run only when invoked directly (tsx scripts/...), not when imported by a test.
// fileURLToPath normalizes both sides (vs a raw `file://${argv[1]}` compare,
// which silently skips main() on a symlinked or space-containing path — a
// scheduled job that "runs, does nothing, exits 0" is a nasty silent failure).
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    logger.error("populate-model-embeddings failed", error);
    process.exit(1);
  });
}
