/**
 * Tests for run-scoped degradation accounting
 * (src/lib/observability/degradation.ts).
 *
 * Covers: pure aggregation across kinds, the no-op-outside-context guarantee,
 * count handling (defaults, non-positive ignored), per-run isolation, and the
 * degraded/total derived fields.
 */

import { describe, it, expect } from "vitest";
import {
  withDegradationTracking,
  recordDegradation,
  getDegradationSummary,
  summarizeDegradation,
  mergeDegradationSummaries,
} from "../../../src/lib/observability/degradation";

describe("summarizeDegradation", () => {
  it("returns an all-zero, non-degraded summary for no events", () => {
    expect(summarizeDegradation([])).toEqual({
      degraded: false,
      total: 0,
      completionFallback: 0,
      pseudoEmbedding: 0,
      webSearchMissing: 0,
      neutralScore: 0,
    });
  });

  it("aggregates counts per kind and derives total + degraded", () => {
    const summary = summarizeDegradation([
      { kind: "completion_fallback", count: 1 },
      { kind: "neutral_score", count: 3 },
      { kind: "neutral_score", count: 2 },
      { kind: "pseudo_embedding", count: 4 },
      { kind: "web_search_missing", count: 1 },
    ]);
    expect(summary).toEqual({
      degraded: true,
      total: 11,
      completionFallback: 1,
      pseudoEmbedding: 4,
      webSearchMissing: 1,
      neutralScore: 5,
    });
  });
});

describe("mergeDegradationSummaries", () => {
  it("returns a non-degraded summary for no inputs", () => {
    expect(mergeDegradationSummaries([])).toEqual({
      degraded: false,
      total: 0,
      completionFallback: 0,
      pseudoEmbedding: 0,
      webSearchMissing: 0,
      neutralScore: 0,
    });
  });

  it("sums per-kind counts across summaries and re-derives total + degraded", () => {
    const a = summarizeDegradation([
      { kind: "pseudo_embedding", count: 2 },
      { kind: "neutral_score", count: 1 },
    ]);
    const b = summarizeDegradation([
      { kind: "neutral_score", count: 4 },
      { kind: "completion_fallback", count: 1 },
    ]);
    expect(mergeDegradationSummaries([a, b])).toEqual({
      degraded: true,
      total: 8,
      completionFallback: 1,
      pseudoEmbedding: 2,
      webSearchMissing: 0,
      neutralScore: 5,
    });
  });

  it("stays non-degraded when every input summary is clean", () => {
    const clean = summarizeDegradation([]);
    expect(mergeDegradationSummaries([clean, clean]).degraded).toBe(false);
  });
});

describe("withDegradationTracking + recordDegradation", () => {
  it("records degradations into the active context", async () => {
    const summary = await withDegradationTracking(async () => {
      recordDegradation("completion_fallback");
      recordDegradation("neutral_score", 7);
      return getDegradationSummary();
    });
    expect(summary).toEqual({
      degraded: true,
      total: 8,
      completionFallback: 1,
      pseudoEmbedding: 0,
      webSearchMissing: 0,
      neutralScore: 7,
    });
  });

  it("defaults count to 1 and ignores non-positive counts", async () => {
    const summary = await withDegradationTracking(async () => {
      recordDegradation("pseudo_embedding");
      recordDegradation("pseudo_embedding", 0);
      recordDegradation("pseudo_embedding", -5);
      return getDegradationSummary();
    });
    expect(summary?.pseudoEmbedding).toBe(1);
    expect(summary?.total).toBe(1);
  });

  it("is a no-op outside a tracking context", () => {
    // Must not throw, and there is no summary to read.
    expect(() => recordDegradation("completion_fallback")).not.toThrow();
    expect(getDegradationSummary()).toBeNull();
  });

  it("reports a non-degraded summary when nothing is recorded", async () => {
    const summary = await withDegradationTracking(async () =>
      getDegradationSummary(),
    );
    expect(summary?.degraded).toBe(false);
    expect(summary?.total).toBe(0);
  });

  it("isolates concurrent runs from each other", async () => {
    const [a, b] = await Promise.all([
      withDegradationTracking(async () => {
        recordDegradation("neutral_score", 2);
        await Promise.resolve();
        return getDegradationSummary();
      }),
      withDegradationTracking(async () => {
        recordDegradation("web_search_missing", 1);
        await Promise.resolve();
        return getDegradationSummary();
      }),
    ]);
    expect(a?.neutralScore).toBe(2);
    expect(a?.webSearchMissing).toBe(0);
    expect(b?.webSearchMissing).toBe(1);
    expect(b?.neutralScore).toBe(0);
  });
});
