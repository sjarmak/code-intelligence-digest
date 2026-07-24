/**
 * CLI: verify the durable-render invariants for one renderKey and print an
 * InvariantReport as JSON. Exits 1 on any violation.
 *
 * Usage:
 *   npx tsx scripts/render-invariants.ts <renderKey> --history <exported-history.json> \
 *     [--store-dir .data/audio] [--transcript <sanitized-transcript.txt>] \
 *     [--total-chunks 8] [--max-blob 256] [--skip-db]
 *
 * Environment:
 *   DEMO_LEDGER_PATH    ledger JSONL (default .demo/ledger.jsonl)
 *   LOCAL_DATABASE_URL  required unless --skip-db; the checker forces
 *                       USE_LOCAL_DB=true and never falls back to the
 *                       production DATABASE_URL.
 *
 * The exported Workflow history is consumed as a plain JSON file (e.g. from
 * `temporal workflow show --output json`); this script never imports the
 * Temporal SDK, so it can audit a recording with no server running.
 */

import path from "node:path";
import { promises as fs } from "node:fs";
import {
  DbEvidence,
  InvariantReport,
  checkInvariants,
  collectObjects,
  readLedgerFile,
} from "../src/lib/audio/durable/invariants";
import { PublishEvent } from "../src/lib/audio/durable/types";

const DEFAULT_LEDGER_PATH = path.join(".demo", "ledger.jsonl");
const DEFAULT_STORE_DIR = path.join(".data", "audio");

// stdout carries exactly one thing: the InvariantReport JSON, so
// `render-invariants.ts ... | jq` always parses. Shared modules log through
// console.log (the db driver announces its connection); reroute those
// operational logs to stderr for this process.
console.log = (...args: Parameters<typeof console.error>): void => {
  console.error(...args);
};

interface CliArgs {
  renderKey: string;
  historyPath: string;
  storeDir: string;
  transcriptPath: string | null;
  totalChunks: number | undefined;
  maxBlobChars: number | undefined;
  skipDb: boolean;
}

function usage(): never {
  console.error(
    "usage: npx tsx scripts/render-invariants.ts <renderKey> --history <path> " +
      "[--store-dir <dir>] [--transcript <path>] [--total-chunks <n>] [--max-blob <n>] [--skip-db]"
  );
  process.exit(2);
}

function parseArgs(argv: string[]): CliArgs {
  const positional: string[] = [];
  let historyPath: string | undefined;
  let storeDir = DEFAULT_STORE_DIR;
  let transcriptPath: string | null = null;
  let totalChunks: number | undefined;
  let maxBlobChars: number | undefined;
  let skipDb = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const next = (): string => {
      const value = argv[++i];
      if (value === undefined) {
        console.error(`missing value for ${arg}`);
        usage();
      }
      return value;
    };
    switch (arg) {
      case "--history":
        historyPath = next();
        break;
      case "--store-dir":
        storeDir = next();
        break;
      case "--transcript":
        transcriptPath = next();
        break;
      case "--total-chunks":
        totalChunks = parsePositiveInt(arg, next());
        break;
      case "--max-blob":
        maxBlobChars = parsePositiveInt(arg, next());
        break;
      case "--skip-db":
        skipDb = true;
        break;
      default:
        if (arg.startsWith("--")) {
          console.error(`unknown option ${arg}`);
          usage();
        }
        positional.push(arg);
    }
  }

  if (positional.length !== 1 || historyPath === undefined) {
    usage();
  }
  const renderKey = positional[0];
  if (!/^[0-9a-f]{64}$/.test(renderKey)) {
    console.error(`renderKey must be bare lowercase 64-char sha256 hex, got "${renderKey}"`);
    usage();
  }
  return { renderKey, historyPath, storeDir, transcriptPath, totalChunks, maxBlobChars, skipDb };
}

function parsePositiveInt(flag: string, value: string): number {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    console.error(`${flag} expects a positive integer, got "${value}"`);
    usage();
  }
  return n;
}

/**
 * Fetch the published domain row for the ledger's publish event, local DB
 * only. Forces USE_LOCAL_DB=true and requires LOCAL_DATABASE_URL so the
 * checker can never read (or lazily connect to) the production database.
 */
async function loadDbEvidence(publishAudioId: string | null): Promise<DbEvidence> {
  process.env.USE_LOCAL_DB = "true";
  if (!process.env.LOCAL_DATABASE_URL) {
    throw new Error(
      "LOCAL_DATABASE_URL is not set. The invariant checker only runs against the local " +
        "docker-compose Postgres (npm run db:start); pass --skip-db to check without a database."
    );
  }
  if (publishAudioId === null) {
    // No publish event: the core checker reports that violation; there is no
    // row id to look up.
    return { kind: "row", row: null };
  }
  const { getPodcastAudioById } = await import("../src/lib/db/podcast-audio");
  const record = await getPodcastAudioById(publishAudioId);
  if (record === null) {
    return { kind: "row", row: null };
  }
  return {
    kind: "row",
    row: { id: record.id, audioUrl: record.audioUrl, bytes: record.bytes },
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  const ledgerPath = process.env.DEMO_LEDGER_PATH ?? DEFAULT_LEDGER_PATH;

  const [ledger, objects, historyText, transcriptText] = await Promise.all([
    readLedgerFile(ledgerPath, args.renderKey),
    collectObjects(args.storeDir, args.renderKey),
    fs.readFile(args.historyPath, "utf8"),
    args.transcriptPath === null
      ? Promise.resolve(null)
      : fs.readFile(args.transcriptPath, "utf8"),
  ]);

  const publishEvent = ledger.events.find((e): e is PublishEvent => e.type === "publish");
  const db: DbEvidence = args.skipDb
    ? { kind: "skipped" }
    : await loadDbEvidence(publishEvent ? publishEvent.audioId : null);

  const report: InvariantReport = checkInvariants({
    renderKey: args.renderKey,
    events: ledger.events,
    ledgerErrors: ledger.errors,
    objects,
    db,
    historyText,
    transcriptText,
    totalChunks: args.totalChunks,
    maxBlobChars: args.maxBlobChars,
  });

  if (!args.skipDb) {
    const { resetDbClient } = await import("../src/lib/db/driver");
    await resetDbClient();
  }

  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.exit(report.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(2);
});
