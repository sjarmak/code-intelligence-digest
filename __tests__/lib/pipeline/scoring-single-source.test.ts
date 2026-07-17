/**
 * Guard test: recency scoring has a SINGLE canonical source.
 *
 * arch-review 2026-07-10 finding #1 (bd code-intel-digest-ixc.1): the canonical
 * `scoring-utils.ts` had gone dead (0 importers) while recency was privately
 * re-implemented four different ways (rank.ts, compute-scores.ts, agentRank.ts,
 * goalFeatures.ts) — correctness-grade drift where the same item ranked
 * differently per code path.
 *
 * Two layers of defense:
 *  1. Static scan of src/lib/pipeline — no module other than scoring-utils.ts
 *     may define computeRecencyScore or carry an exponential-decay expression.
 *     This pins against the specific fork shapes that existed. It is a
 *     necessary-not-sufficient check: a fork written in a novel shape (e.g. a
 *     fresh step-function ladder) can evade pattern matching, which is why the
 *     behavioral layer below exists for the outputs we can observe directly.
 *  2. Behavioral delegation — the recency outputs a caller exposes must equal
 *     the canonical formula. This catches a fork regardless of how it is
 *     written (it was verified to catch a revert of goalFeatures.ts to its old
 *     step-bucket implementation, which the static scan alone does not).
 */

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve, join } from "node:path";
import {
  computeGoalFeatures,
  RECENCY_HALF_LIFE_DAYS,
} from "../../../src/lib/pipeline/goalFeatures";
import { computeRecencyScore } from "../../../src/lib/pipeline/scoring-utils";
import type { RetrievedDoc } from "../../../src/lib/pipeline/agentRetrieval";

const here = dirname(fileURLToPath(import.meta.url));
const libDir = resolve(here, "../../../src/lib");

/**
 * Directories scanned for a private recency fork. `pipeline` holds the canonical
 * plus the four files that were formerly forked; `agents` and `retrieval` are
 * included so a re-fork that migrates OUT of pipeline (arch-review finding #5)
 * cannot escape the guard by living in a sibling directory.
 */
const SCANNED_DIRS = ["pipeline", "agents", "retrieval"];

const CANONICAL = "pipeline/scoring-utils.ts";

/** Files that previously carried a private recency fork and must now delegate. */
const FORMERLY_FORKED = [
  "pipeline/rank.ts",
  "pipeline/compute-scores.ts",
  "pipeline/agentRank.ts",
  "pipeline/goalFeatures.ts",
];

/**
 * Signatures of a locally-defined recency-decay implementation. Covers the
 * exponential forms that existed plus the ES exponentiation operator, so a
 * re-fork written as `2 ** (-x)` is caught as well as `Math.pow`/`Math.exp`.
 */
const DECAY_SIGNATURES = [
  /Math\.pow\(2,\s*-/,
  /Math\.exp\(-Math\.log\(2\)/,
  /2\s*\*\*\s*-/,
];

/** Matches both `function computeRecencyScore` and `const computeRecencyScore =`. */
const LOCAL_DEFINITION =
  /(?:function\s+computeRecencyScore\b|(?:const|let|var)\s+computeRecencyScore\s*=)/;

function read(rel: string): string {
  return readFileSync(join(libDir, rel), "utf8");
}

function sourceFiles(): string[] {
  return SCANNED_DIRS.flatMap((d) =>
    readdirSync(join(libDir, d), { withFileTypes: true })
      .filter(
        (e) => e.isFile() && e.name.endsWith(".ts") && !e.name.endsWith(".test.ts"),
      )
      .map((e) => `${d}/${e.name}`),
  );
}

function doc(overrides: Partial<RetrievedDoc>): RetrievedDoc {
  return { source: "postgres_items", title: "Test", metadata: {}, ...overrides };
}

describe("recency scoring single source (static)", () => {
  it("defines computeRecencyScore in exactly one pipeline module (scoring-utils.ts)", () => {
    const definers = sourceFiles().filter((f) => LOCAL_DEFINITION.test(read(f)));
    expect(definers).toEqual([CANONICAL]);
  });

  it("keeps the recency-decay formula only in the canonical module", () => {
    const offenders = sourceFiles()
      .filter((f) => f !== CANONICAL)
      .filter((f) => {
        const src = read(f);
        return DECAY_SIGNATURES.some((re) => re.test(src));
      });
    expect(offenders).toEqual([]);
  });

  it("routes every formerly-forked file through the canonical module", () => {
    for (const file of FORMERLY_FORKED) {
      const src = read(file);
      expect(
        /import\s*\{[^}]*\bcomputeRecencyScore\b[^}]*\}\s*from\s*["']\.\/scoring-utils["']/.test(
          src,
        ),
        `${file} should import computeRecencyScore from ./scoring-utils`,
      ).toBe(true);
      expect(
        LOCAL_DEFINITION.test(src),
        `${file} must not redefine computeRecencyScore locally`,
      ).toBe(false);
    }
  });
});

describe("recency scoring single source (behavioral)", () => {
  // Ages chosen to sit strictly inside/after the old goalFeatures step buckets,
  // where the canonical exponential and the step ladder produce different
  // values — so a revert to the step function fails these assertions.
  const hl = RECENCY_HALF_LIFE_DAYS;

  it("goalFeatures.recency equals the canonical formula, not a step ladder", () => {
    for (const ageDays of [0, 8, 22, 45, 120]) {
      const publishedAt = new Date(Date.now() - ageDays * 24 * 60 * 60 * 1000);
      const feature = computeGoalFeatures(doc({ publishedAt }), "content_ideas");
      expect(feature.recency).toBeCloseTo(computeRecencyScore(publishedAt, hl), 4);
    }
  });

  it("keeps the 0.5 neutral fallback when publishedAt is absent", () => {
    const feature = computeGoalFeatures(doc({}), "content_ideas");
    expect(feature.recency).toBe(0.5);
  });
});
