/**
 * Tests for the BM25 ranking index (src/lib/pipeline/bm25.ts)
 *
 * Covers: term matching, IDF rarity weighting, TF saturation (K1),
 * length normalization (B), score normalization to [0,1], tokenization
 * rules (case-insensitivity, short-token filtering), and the
 * per-category domain query helper.
 */

import { describe, it, expect } from "vitest";
import { BM25Index, getQueryForCategory } from "../../../src/lib/pipeline/bm25";
import { VALID_CATEGORIES } from "../../../src/lib/model";

type Doc = { id: string; title?: string };

function indexOf(docs: Doc[]): BM25Index {
  const idx = new BM25Index();
  idx.addDocuments(docs);
  return idx;
}

describe("BM25Index.score", () => {
  it("scores documents containing a query term above zero and others at zero", () => {
    const idx = indexOf([
      { id: "a", title: "alpha beta gamma" },
      { id: "b", title: "delta epsilon zeta" },
    ]);

    const scores = idx.score(["alpha"]);

    expect(scores.get("a")!).toBeGreaterThan(0);
    expect(scores.get("b")).toBe(0);
  });

  it("initializes every known document to a defined score", () => {
    const idx = indexOf([
      { id: "a", title: "alpha" },
      { id: "b", title: "beta" },
    ]);

    const scores = idx.score(["nonexistent"]);

    // No document matches, but all docs are present with a 0 score.
    expect(scores.get("a")).toBe(0);
    expect(scores.get("b")).toBe(0);
  });

  it("returns all-zero scores for an empty query", () => {
    const idx = indexOf([{ id: "a", title: "alpha beta" }]);

    const scores = idx.score([]);

    expect(scores.get("a")).toBe(0);
  });

  it("returns an empty map when the index has no documents", () => {
    const idx = new BM25Index();
    expect(idx.score(["alpha"]).size).toBe(0);
  });

  it("weights rare terms higher than common terms (IDF)", () => {
    const idx = indexOf([
      { id: "d1", title: "rare common foo" },
      { id: "d2", title: "common bar baz" },
      { id: "d3", title: "common qux quux" },
    ]);

    // d1 has equal length and TF=1 for both terms, so the only difference
    // is the inverse document frequency: "rare" (1 doc) >> "common" (3 docs).
    const rareScore = idx.score(["rare"]).get("d1")!;
    const commonScore = idx.score(["common"]).get("d1")!;

    expect(rareScore).toBeGreaterThan(commonScore);
  });

  it("applies no per-term domain weighting (equal IDF/TF/length terms score identically)", () => {
    // "indexing" and "testing" were formerly weighted 1.6x and 1.0x in the
    // domain-term config (bd-2gp). With those phantom weights removed, the
    // scorer treats them equally: each appears in exactly one equal-length doc
    // (equal IDF), once (equal TF). If per-term weighting is ever reintroduced,
    // these scores diverge and this test fails.
    const idx = indexOf([
      { id: "a", title: "indexing foo bar" },
      { id: "b", title: "testing foo bar" },
    ]);

    const indexingScore = idx.score(["indexing"]).get("a")!;
    const testingScore = idx.score(["testing"]).get("b")!;

    expect(indexingScore).toBeCloseTo(testingScore, 10);
  });

  it("increases score with term frequency but sub-linearly (K1 saturation)", () => {
    // Equal-length docs isolate the TF effect from length normalization.
    const idx = indexOf([
      { id: "once", title: "alpha beta gamma delta" },
      { id: "twice", title: "alpha alpha gamma delta" },
    ]);

    const scores = idx.score(["alpha"]);
    const once = scores.get("once")!;
    const twice = scores.get("twice")!;

    expect(twice).toBeGreaterThan(once); // more occurrences -> higher
    expect(twice).toBeLessThan(once * 2); // but saturating, not linear
  });

  it("scores shorter documents higher for equal term frequency (length normalization)", () => {
    const idx = indexOf([
      { id: "short", title: "alpha beta gamma" },
      {
        id: "long",
        title: "alpha delta epsilon zeta eta theta iota kappa lambda",
      },
    ]);

    const scores = idx.score(["alpha"]);

    expect(scores.get("short")!).toBeGreaterThan(scores.get("long")!);
  });

  it("matches terms case-insensitively", () => {
    const idx = indexOf([{ id: "a", title: "Alpha Beta GAMMA" }]);

    expect(idx.score(["alpha"]).get("a")!).toBeGreaterThan(0);
    expect(idx.score(["gamma"]).get("a")!).toBeGreaterThan(0);
  });

  it("ignores tokens of two characters or fewer", () => {
    const idx = indexOf([{ id: "a", title: "go alpha" }]);

    // "go" is two chars -> not indexed -> contributes nothing.
    expect(idx.score(["go"]).get("a")).toBe(0);
    // Control: a real token from the same doc still matches.
    expect(idx.score(["alpha"]).get("a")!).toBeGreaterThan(0);
  });

  it("indexes across all document fields (title, summary, snippet, fullText, source, categories)", () => {
    const idx = new BM25Index();
    idx.addDocuments([
      {
        id: "a",
        title: "headline",
        summary: "summaryword",
        contentSnippet: "snippetword",
        fullText: "fulltextword",
        sourceTitle: "sourceword",
        categories: ["categoryword"],
      },
    ]);

    for (const term of [
      "headline",
      "summaryword",
      "snippetword",
      "fulltextword",
      "sourceword",
      "categoryword",
    ]) {
      expect(idx.score([term]).get("a")!).toBeGreaterThan(0);
    }
  });

  it("rebuilds the index on each addDocuments call (no stale documents)", () => {
    const idx = new BM25Index();
    idx.addDocuments([{ id: "old", title: "alpha" }]);
    idx.addDocuments([{ id: "new", title: "alpha" }]);

    const scores = idx.score(["alpha"]);
    expect(scores.has("old")).toBe(false);
    expect(scores.get("new")!).toBeGreaterThan(0);
  });
});

describe("BM25Index.normalizeScores", () => {
  it("scales scores so the maximum maps to 1.0 and preserves ratios", () => {
    const idx = new BM25Index();
    const normalized = idx.normalizeScores(
      new Map([
        ["a", 4],
        ["b", 2],
        ["c", 0],
      ]),
    );

    expect(normalized.get("a")).toBeCloseTo(1.0, 6);
    expect(normalized.get("b")).toBeCloseTo(0.5, 6);
    expect(normalized.get("c")).toBeCloseTo(0, 6);
  });

  it("keeps all-zero scores at zero (max is floored at 1)", () => {
    const idx = new BM25Index();
    const normalized = idx.normalizeScores(
      new Map([
        ["a", 0],
        ["b", 0],
      ]),
    );

    expect(normalized.get("a")).toBe(0);
    expect(normalized.get("b")).toBe(0);
  });

  it("never produces a value above 1.0", () => {
    const idx = new BM25Index();
    const normalized = idx.normalizeScores(
      new Map([
        ["a", 12.34],
        ["b", 0.01],
      ]),
    );

    for (const v of normalized.values()) {
      expect(v).toBeLessThanOrEqual(1.0);
    }
  });

  it("returns an empty map for empty input", () => {
    const idx = new BM25Index();
    expect(idx.normalizeScores(new Map()).size).toBe(0);
  });

  it("does not amplify scores when the maximum is below 1 (divisor floored at 1)", () => {
    const idx = indexOf([{ id: "only", title: "alpha beta gamma" }]);
    const raw = idx.score(["alpha"]);
    const normalized = idx.normalizeScores(raw);
    // Raw score for a single weakly-matching doc is < 1, so dividing by the
    // floor of 1 leaves it unchanged rather than scaling it up to 1.0.
    expect(raw.get("only")!).toBeLessThan(1);
    expect(normalized.get("only")).toBeCloseTo(raw.get("only")!, 6);
  });

  it("scales the top document to 1.0 when the maximum raw score exceeds 1", () => {
    const idx = new BM25Index();
    const normalized = idx.normalizeScores(
      new Map([
        ["top", 8],
        ["mid", 4],
      ]),
    );
    expect(normalized.get("top")).toBeCloseTo(1.0, 6);
    expect(normalized.get("mid")).toBeCloseTo(0.5, 6);
  });
});

describe("getQueryForCategory", () => {
  it("returns a non-empty list of string terms for every category", () => {
    for (const category of VALID_CATEGORIES) {
      const terms = getQueryForCategory(category);
      expect(Array.isArray(terms)).toBe(true);
      expect(terms.length).toBeGreaterThan(0);
      expect(terms.every((t) => typeof t === "string")).toBe(true);
    }
  });
});
