/**
 * Tests for the ranking stage (src/lib/pipeline/rank.ts)
 *
 * Covers: the weighted final-score formula, missing-LLM fallback,
 * domain-term boost tiers (Sourcegraph 5x, core-term 1.5x/2x/3x, agent+
 * context 2.5x), boost stacking via product mentions, recency applied
 * only for the all-time period, off-topic and low-relevance pre-filters,
 * and the recency-free variant used for audio digests.
 *
 * BM25 and the boost logic run for real; only the database lookup,
 * logger, and language filter are mocked.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { rankCategory, rankCategoryWithoutRecency } from "../../../src/lib/pipeline/rank";
import { FeedItem } from "../../../src/lib/model";
import { loadScoresForItems } from "../../../src/lib/db/items";

vi.mock("../../../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/lib/db/items", () => ({
  loadScoresForItems: vi.fn().mockResolvedValue({}),
}));

const mockLoad = vi.mocked(loadScoresForItems);
const NOW = new Date("2026-06-15T00:00:00Z");

function feedItem(overrides: Partial<FeedItem>): FeedItem {
  const id = overrides.id ?? "item-1";
  return {
    id,
    streamId: "stream",
    sourceTitle: "Source A",
    title: "A perfectly ordinary headline about software topics",
    url: `https://example.com/${id}`,
    publishedAt: NOW,
    createdAt: NOW,
    categories: [],
    category: "newsletters",
    raw: {},
    summary:
      "This is a sufficiently long body so the item clears the minimum content-length pre-filter applied during ranking.",
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.clearAllMocks();
  mockLoad.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe("rankCategory", () => {
  it("returns an empty array for empty input", async () => {
    expect(await rankCategory([], "newsletters", 7, "week")).toEqual([]);
  });

  it("returns items sorted by descending finalScore", async () => {
    const items = [
      feedItem({ id: "plain", title: "Just a generic note about teams and stuff today" }),
      feedItem({ id: "sg", title: "Sourcegraph powers code search at scale today" }),
      feedItem({ id: "two", title: "Notes on code review and documentation standards" }),
    ];

    const ranked = await rankCategory(items, "newsletters", 7, "week");

    for (let i = 0; i < ranked.length - 1; i++) {
      expect(ranked[i].finalScore).toBeGreaterThanOrEqual(ranked[i + 1].finalScore);
    }
  });

  it("falls back to BM25 as the LLM component when no stored score exists", async () => {
    const item = feedItem({
      id: "plain",
      title: "Notes about codebase organization for engineering teams",
    });

    const [ranked] = await rankCategory([item], "newsletters", 7, "week");

    // No boost (no core terms), weights sum to 1 -> finalScore == bm25Score.
    expect(ranked.finalScore).toBeCloseTo(ranked.bm25Score, 6);
    expect(ranked.llmScore.relevance).toBe(Math.round(ranked.bm25Score * 10));
  });

  it("applies the 5x Sourcegraph boost and tags the item", async () => {
    const item = feedItem({
      id: "sg",
      title: "Sourcegraph powers code search across the enterprise",
    });

    const [ranked] = await rankCategory([item], "newsletters", 7, "week");

    expect(ranked.llmScore.tags).toContain("sourcegraph");
    expect(ranked.finalScore).toBeCloseTo(ranked.bm25Score * 5.0, 6);
  });

  it("applies a 1.5x boost for a single core term", async () => {
    const item = feedItem({
      id: "one",
      title: "Tips on developer productivity for engineering teams",
    });
    const [ranked] = await rankCategory([item], "newsletters", 7, "week");
    expect(ranked.finalScore).toBeCloseTo(ranked.bm25Score * 1.5, 6);
  });

  it("applies a 2x boost for two core terms", async () => {
    const item = feedItem({
      id: "two",
      title: "Notes on code review and documentation standards",
    });
    const [ranked] = await rankCategory([item], "newsletters", 7, "week");
    expect(ranked.finalScore).toBeCloseTo(ranked.bm25Score * 2.0, 6);
  });

  it("applies a 3x boost for three or more core terms", async () => {
    const item = feedItem({
      id: "three",
      title: "Guide to code review, documentation, and onboarding for teams",
    });
    const [ranked] = await rankCategory([item], "newsletters", 7, "week");
    expect(ranked.finalScore).toBeCloseTo(ranked.bm25Score * 3.0, 6);
  });

  it("applies a 2.5x boost for agent + code-context content", async () => {
    const item = feedItem({
      id: "agentctx",
      title: "An agent that excels at code search across large repos",
    });
    const [ranked] = await rankCategory([item], "newsletters", 7, "week");
    expect(ranked.finalScore).toBeCloseTo(ranked.bm25Score * 2.5, 6);
  });

  it("filters out items tagged off-topic", async () => {
    mockLoad.mockResolvedValue({
      "off": { llm_relevance: 8, llm_usefulness: 8, llm_tags: ["off-topic"] },
    });
    const ranked = await rankCategory([feedItem({ id: "off" })], "newsletters", 7, "week");
    expect(ranked).toHaveLength(0);
  });

  it("filters out items below the category relevance threshold", async () => {
    // newsletters minRelevance 5 -> threshold max(3, 5-1) = 4 for non-day periods.
    mockLoad.mockResolvedValue({
      "low": { llm_relevance: 2, llm_usefulness: 2, llm_tags: [] },
    });
    const ranked = await rankCategory([feedItem({ id: "low" })], "newsletters", 30, "month");
    expect(ranked).toHaveLength(0);
  });

  it("uses a neutral recency score (1.0) for non-all-time periods", async () => {
    const [ranked] = await rankCategory([feedItem({ id: "x" })], "newsletters", 7, "week");
    expect(ranked.recencyScore).toBeCloseTo(1.0, 6);
  });

  it("decays the recency score for old items in the all-time period", async () => {
    const thirtyDaysAgo = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000);
    const item = feedItem({ id: "old", publishedAt: thirtyDaysAgo, createdAt: thirtyDaysAgo });

    // newsletters half-life is 3 days; 30 days old -> decay clamps to the 0.2 floor.
    const [ranked] = await rankCategory([item], "newsletters", 90, "all");
    expect(ranked.recencyScore).toBeCloseTo(0.2, 6);
  });
});

describe("rankCategoryWithoutRecency", () => {
  it("returns an empty array for empty input", async () => {
    expect(await rankCategoryWithoutRecency([], "newsletters", 7, "week")).toEqual([]);
  });

  it("sets recencyScore to 0 for all items", async () => {
    const [ranked] = await rankCategoryWithoutRecency(
      [feedItem({ id: "x" })],
      "newsletters",
      7,
      "week",
    );
    expect(ranked.recencyScore).toBe(0);
  });

  it("computes the 60/40 LLM/BM25 formula without recency", async () => {
    mockLoad.mockResolvedValue({
      "scored": { llm_relevance: 10, llm_usefulness: 0, llm_tags: [] },
    });
    const item = feedItem({
      id: "scored",
      category: "product_news",
      title: "Our latest changelog notes for the platform release this week",
    });

    const [ranked] = await rankCategoryWithoutRecency([item], "product_news", 7, "week");

    // llmScore = (0.7*10 + 0.3*0)/10 = 0.7; no boost on this content.
    // finalScore = 0.60 * 0.7 + 0.40 * bm25Score
    const expected = 0.6 * 0.7 + 0.4 * ranked.bm25Score;
    expect(ranked.bm25Score).toBeGreaterThan(0);
    expect(ranked.finalScore).toBeCloseTo(expected, 6);
  });

  it("applies a product boost for detected product mentions in product_news", async () => {
    const item = feedItem({
      id: "prod",
      category: "product_news",
      title: "Windsurf editor ships a major update for developers this week",
    });

    const [ranked] = await rankCategoryWithoutRecency([item], "product_news", 7, "week");

    expect(ranked.productMentions).toContain("windsurf");
    // Single product -> 3x boost; base == bm25Score (LLM fallback).
    expect(ranked.finalScore).toBeCloseTo(ranked.bm25Score * 3.0, 6);
  });
});
