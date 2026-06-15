/**
 * Tests for diversity selection (src/lib/pipeline/select.ts)
 *
 * Covers: URL deduplication, low-score filtering, the top-10 minimum
 * guarantee, per-source diversity caps, total-cap override, and
 * pagination exclusion.
 */

import { describe, it, expect, vi } from "vitest";
import { selectWithDiversity } from "../../../src/lib/pipeline/select";
import { RankedItem, Category } from "../../../src/lib/model";

vi.mock("../../../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

function rankedItem(overrides: Partial<RankedItem>): RankedItem {
  const id = overrides.id ?? "id";
  return {
    id,
    streamId: "stream",
    sourceTitle: overrides.sourceTitle ?? "Source A",
    title: `Title for ${id}`,
    url: overrides.url ?? `https://example.com/${id}`,
    publishedAt: new Date("2026-01-01T00:00:00Z"),
    categories: [],
    category: "newsletters",
    raw: {},
    bm25Score: 1,
    llmScore: { relevance: 8, usefulness: 8, tags: [] },
    recencyScore: 1,
    finalScore: 1,
    reasoning: "",
    ...overrides,
  };
}

/** Build n items across the given number of distinct sources, descending score. */
function buildItems(n: number, sources: number, category: Category = "tech_articles"): RankedItem[] {
  return Array.from({ length: n }, (_, i) =>
    rankedItem({
      id: `item-${i}`,
      sourceTitle: `Source ${i % sources}`,
      url: `https://example.com/item-${i}`,
      finalScore: n - i,
      category,
    }),
  );
}

describe("selectWithDiversity", () => {
  it("returns an empty result for empty input", () => {
    const result = selectWithDiversity([], "newsletters");
    expect(result.items).toEqual([]);
    expect(result.reasons.size).toBe(0);
  });

  it("deduplicates items that share a normalized URL, keeping the first", () => {
    const items = [
      rankedItem({ id: "a", url: "https://example.com/post?utm=1", sourceTitle: "S1", finalScore: 5 }),
      rankedItem({ id: "b", url: "https://example.com/post?utm=2", sourceTitle: "S2", finalScore: 4 }),
    ];

    const result = selectWithDiversity(items, "newsletters");

    expect(result.items.map((i) => i.id)).toEqual(["a"]);
  });

  it("filters out items with finalScore below 0.05", () => {
    const items = [
      rankedItem({ id: "keep", finalScore: 0.5, url: "https://example.com/keep" }),
      rankedItem({ id: "drop", finalScore: 0.01, url: "https://example.com/drop" }),
    ];

    const result = selectWithDiversity(items, "newsletters");

    expect(result.items.map((i) => i.id)).toContain("keep");
    expect(result.items.map((i) => i.id)).not.toContain("drop");
  });

  it("returns up to 10 items from a single source (minimum guarantee)", () => {
    const items = buildItems(15, 1, "tech_articles");

    const result = selectWithDiversity(items, "tech_articles");

    expect(result.items.length).toBe(10);
  });

  it("enforces source diversity for newsletters with many sources (max 2 per source in top 10)", () => {
    // 15 items across 5 sources (3 each); newsletters caps at 2 per source
    // during the minimum guarantee, yielding 2 * 5 = 10.
    const items = buildItems(15, 5, "newsletters");

    const result = selectWithDiversity(items, "newsletters");

    const perSource = new Map<string, number>();
    for (const item of result.items) {
      perSource.set(item.sourceTitle, (perSource.get(item.sourceTitle) ?? 0) + 1);
    }

    expect(result.items.length).toBe(10);
    for (const count of perSource.values()) {
      expect(count).toBeLessThanOrEqual(2);
    }
  });

  it("respects maxItemsOverride above the minimum guarantee", () => {
    // 20 distinct sources, 1 item each -> no per-source cap pressure.
    const items = buildItems(20, 20, "tech_articles");

    const result = selectWithDiversity(items, "tech_articles", 2, 15);

    expect(result.items.length).toBe(15);
  });

  it("caps at the category default (10) when no override is given", () => {
    const items = buildItems(20, 20, "tech_articles");

    const result = selectWithDiversity(items, "tech_articles");

    expect(result.items.length).toBe(10);
  });

  it("excludes already-selected ids for pagination", () => {
    const items = buildItems(20, 20, "tech_articles");
    const exclude = new Set(["item-0", "item-1", "item-2"]);

    const result = selectWithDiversity(items, "tech_articles", 2, undefined, exclude);

    for (const id of exclude) {
      expect(result.items.map((i) => i.id)).not.toContain(id);
    }
  });

  it("records a selection reason for every selected item", () => {
    const items = buildItems(12, 4, "tech_articles");

    const result = selectWithDiversity(items, "tech_articles");

    for (const item of result.items) {
      expect(result.reasons.get(item.id)).toBeTruthy();
    }
  });

  it("keeps items whose URL fails to parse rather than dropping them", () => {
    const items = [
      rankedItem({ id: "bad-url", url: "not a url", finalScore: 1 }),
    ];

    const result = selectWithDiversity(items, "tech_articles");

    expect(result.items.map((i) => i.id)).toContain("bad-url");
  });
});
