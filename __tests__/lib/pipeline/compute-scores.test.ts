/**
 * Tests for score pre-computation (src/lib/pipeline/compute-scores.ts)
 *
 * Covers: the weighted final-score formula, missing-LLM fallback,
 * the content-insufficient penalty (llmScore = bm25 * 0.3), boost
 * stacking (product x watchlist x competitor-intel), the
 * never-rescore guarantee, and per-category grouping.
 *
 * BM25 is exercised for real; the database, LLM, and boost helpers are
 * mocked so the formula composition can be asserted in isolation.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  computeAndSaveScoresForCategory,
  computeAndSaveScoresForItems,
} from "../../../src/lib/pipeline/compute-scores";
import { FeedItem, RankedItem, Category } from "../../../src/lib/model";
import { saveItemScores } from "../../../src/lib/db/scores";
import { loadScoresForItems } from "../../../src/lib/db/items";
import { scoreWithLLM } from "../../../src/lib/pipeline/llmScore";
import { computeProductBoost, findProductMentions } from "../../../src/config/products";
import { computeWatchlistBoost } from "../../../src/config/watchlist";
import { detectCompetitorSignals } from "../../../src/config/competitor-intel";

vi.mock("../../../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/lib/db/scores", () => ({
  saveItemScores: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../../../src/lib/db/items", () => ({
  loadScoresForItems: vi.fn().mockResolvedValue({}),
}));
vi.mock("../../../src/lib/pipeline/llmScore", () => ({
  scoreWithLLM: vi.fn().mockResolvedValue({}),
}));
// Spread the real modules so the categories.ts import chain (which depends on
// competitors.ts -> competitor-intel.ts) keeps working; override only the
// boost helpers under test.
vi.mock("../../../src/config/products", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/config/products")>()),
  computeProductBoost: vi.fn(() => ({ multiplier: 1.0, tags: [] })),
  findProductMentions: vi.fn(() => []),
}));
vi.mock("../../../src/config/watchlist", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/config/watchlist")>()),
  computeWatchlistBoost: vi.fn(() => ({ multiplier: 1.0, matchedTerms: [], themes: [] })),
}));
vi.mock("../../../src/config/competitor-intel", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../src/config/competitor-intel")>()),
  detectCompetitorSignals: vi.fn(() => ({ competitorIds: [], surfaces: [], matchedTerms: [] })),
}));

const mockSave = vi.mocked(saveItemScores);
const mockLoad = vi.mocked(loadScoresForItems);
const mockLLM = vi.mocked(scoreWithLLM);

function feedItem(overrides: Partial<FeedItem>): FeedItem {
  const id = overrides.id ?? "item-1";
  return {
    id,
    streamId: "stream",
    sourceTitle: "Source A",
    title: "Code search tips for engineering teams",
    url: `https://example.com/${id}`,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    categories: [],
    category: "newsletters",
    raw: {},
    summary:
      "A detailed write-up about code search workflows and developer productivity practices.",
    ...overrides,
  };
}

/** Reconstruct the [0,1] LLM component the pipeline derives from a stored item. */
function llmComponent(item: RankedItem): number {
  return (0.7 * item.llmScore.relevance + 0.3 * item.llmScore.usefulness) / 10;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue(undefined);
  mockLoad.mockResolvedValue({});
  mockLLM.mockResolvedValue({});
  vi.mocked(computeProductBoost).mockReturnValue({ multiplier: 1.0, tags: [] });
  vi.mocked(findProductMentions).mockReturnValue([]);
  vi.mocked(computeWatchlistBoost).mockReturnValue({ multiplier: 1.0, matchedTerms: [], themes: [] });
  vi.mocked(detectCompetitorSignals).mockReturnValue({ competitorIds: [], surfaces: [], matchedTerms: [] });
});

describe("computeAndSaveScoresForCategory", () => {
  it("returns 0 and saves nothing for empty input", async () => {
    const count = await computeAndSaveScoresForCategory([], "newsletters");
    expect(count).toBe(0);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("skips items that already have scores (never rescores)", async () => {
    mockLoad.mockResolvedValue({
      "item-1": { llm_relevance: 5, llm_usefulness: 5, llm_tags: [] },
    });

    const count = await computeAndSaveScoresForCategory(
      [feedItem({ id: "item-1" })],
      "newsletters",
    );

    expect(count).toBe(0);
    expect(mockSave).not.toHaveBeenCalled();
  });

  it("only scores items lacking a stored score", async () => {
    mockLoad.mockResolvedValue({
      "has-score": { llm_relevance: 7, llm_usefulness: 7, llm_tags: [] },
    });

    const count = await computeAndSaveScoresForCategory(
      [feedItem({ id: "has-score" }), feedItem({ id: "needs-score" })],
      "newsletters",
    );

    expect(count).toBe(1);
    const saved = mockSave.mock.calls[0][0] as RankedItem[];
    expect(saved).toHaveLength(1);
    expect(saved[0].id).toBe("needs-score");
  });

  it("computes finalScore = llmWeight*llmScore + bm25Weight*bm25Score (boosts neutral)", async () => {
    mockLLM.mockResolvedValue({
      "item-1": { id: "item-1", relevance: 8, usefulness: 6, tags: ["llm-tag"] },
    });

    await computeAndSaveScoresForCategory([feedItem({ id: "item-1" })], "newsletters");

    const saved = mockSave.mock.calls[0][0] as RankedItem[];
    const item = saved[0];
    // newsletters weights: llm 0.6, bm25 0.4
    const expected = 0.6 * llmComponent(item) + 0.4 * item.bm25Score;
    expect(item.finalScore).toBeCloseTo(expected, 6);
    expect(item.llmScore.relevance).toBe(8);
    expect(item.llmScore.usefulness).toBe(6);
    expect(item.llmScore.tags).toContain("llm-tag");
  });

  it("falls back to BM25 as the LLM component when no LLM score but content is sufficient", async () => {
    // LLM returns no entry for the item even though it has real content.
    mockLLM.mockResolvedValue({});

    await computeAndSaveScoresForCategory([feedItem({ id: "item-1" })], "newsletters");

    const saved = mockSave.mock.calls[0][0] as RankedItem[];
    const item = saved[0];
    // llmScore == bm25Score, weights sum to 1 -> finalScore == bm25Score.
    expect(item.finalScore).toBeCloseTo(item.bm25Score, 6);
    expect(item.llmScore.relevance).toBe(Math.round(item.bm25Score * 10));
  });

  it("applies the content-insufficient penalty (llmScore = bm25 * 0.3) and skips the LLM", async () => {
    // Title carries query terms (so BM25 > 0) but there is no real body content.
    const thin = feedItem({
      id: "thin",
      title: "Code search update",
      summary: undefined,
      contentSnippet: undefined,
      fullText: undefined,
    });

    await computeAndSaveScoresForCategory([thin], "newsletters");

    expect(mockLLM).not.toHaveBeenCalled();
    const saved = mockSave.mock.calls[0][0] as RankedItem[];
    const item = saved[0];
    expect(item.bm25Score).toBeGreaterThan(0); // title carries query terms
    // The penalty applies to the LLM component: llmScore = bm25 * 0.3.
    // finalScore = 0.6 * (bm25 * 0.3) + 0.4 * bm25
    const expected = 0.6 * (item.bm25Score * 0.3) + 0.4 * item.bm25Score;
    expect(item.finalScore).toBeCloseTo(expected, 6);
  });

  it("stacks product, watchlist, and competitor-intel boosts multiplicatively for product_news", async () => {
    vi.mocked(computeProductBoost).mockReturnValue({ multiplier: 2.0, tags: ["prod-x"] });
    vi.mocked(computeWatchlistBoost).mockReturnValue({
      multiplier: 1.5,
      matchedTerms: ["watch-y"],
      themes: [],
    });
    vi.mocked(detectCompetitorSignals).mockReturnValue({
      competitorIds: ["comp-z"],
      surfaces: [],
      matchedTerms: [],
    });
    mockLLM.mockResolvedValue({
      "item-1": { id: "item-1", relevance: 10, usefulness: 10, tags: [] },
    });

    await computeAndSaveScoresForCategory(
      [feedItem({ id: "item-1", category: "product_news" })],
      "product_news",
    );

    const saved = mockSave.mock.calls[0][0] as RankedItem[];
    const item = saved[0];
    // intel boost = 1 + min(0.18, 1*0.03 + 0*0.02) = 1.03
    const stacked = 2.0 * 1.5 * 1.03;
    const base = 0.6 * llmComponent(item) + 0.4 * item.bm25Score; // product_news weights 0.6/0.4
    expect(item.finalScore).toBeCloseTo(base * stacked, 6);
    expect(item.llmScore.tags).toEqual(
      expect.arrayContaining(["prod-x", "watch-y", "competitor:comp-z"]),
    );
  });

  it("passes the category through to saveItemScores", async () => {
    await computeAndSaveScoresForCategory([feedItem({ id: "item-1" })], "tech_articles");
    expect(mockSave.mock.calls[0][1]).toBe("tech_articles" as Category);
  });
});

describe("computeAndSaveScoresForItems", () => {
  it("returns zero totals for empty input", async () => {
    const result = await computeAndSaveScoresForItems([]);
    expect(result).toEqual({ totalScored: 0, categoriesScored: [] });
  });

  it("groups by category and aggregates the scored count", async () => {
    const items = [
      feedItem({ id: "n1", category: "newsletters" }),
      feedItem({ id: "n2", category: "newsletters" }),
      feedItem({ id: "a1", category: "ai_news" }),
    ];

    const result = await computeAndSaveScoresForItems(items);

    expect(result.totalScored).toBe(3);
    expect(result.categoriesScored).toEqual(
      expect.arrayContaining(["newsletters", "ai_news"]),
    );
  });
});
