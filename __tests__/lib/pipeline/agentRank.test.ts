/**
 * Tests for goal-aware ranking
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rankForAgent } from "../../../src/lib/pipeline/agentRank";
import type { RetrievedDoc } from "../../../src/lib/pipeline/agentRetrieval";

vi.mock("../../../src/lib/db/items", () => ({
  loadScoresForItems: vi.fn().mockResolvedValue({}),
}));

function doc(overrides: Partial<RetrievedDoc>): RetrievedDoc {
  return {
    source: "postgres_items",
    title: "Test doc",
    metadata: {},
    ...overrides,
  };
}

describe("agentRank", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("returns empty array for empty docs", async () => {
    const result = await rankForAgent("content_ideas", []);
    expect(result).toEqual([]);
  });

  it("returns docs sorted by agentScore", async () => {
    const docs: RetrievedDoc[] = [
      doc({ id: "1", title: "Code search in monorepos", snippet: "webinar and white paper" }),
      doc({ id: "2", title: "Unrelated short" }),
    ];
    const result = await rankForAgent("content_ideas", docs);
    expect(result.length).toBe(2);
    expect(result[0].agentScore).toBeGreaterThanOrEqual(result[1].agentScore);
    expect(result[0]).toHaveProperty("baseScore");
    expect(result[0]).toHaveProperty("goalScore");
    expect(result[0]).toHaveProperty("features");
  });

  it("uses stored score when available", async () => {
    const { loadScoresForItems } = await import("../../../src/lib/db/items");
    vi.mocked(loadScoresForItems).mockResolvedValue({
      item1: {
        llm_relevance: 8,
        llm_usefulness: 7,
        llm_tags: [],
        final_score: 0.85,
      },
    });
    const docs: RetrievedDoc[] = [
      doc({ id: "item1", title: "Relevant post", source: "postgres_items" }),
    ];
    const result = await rankForAgent("competitor_intel", docs);
    expect(result.length).toBe(1);
    expect(result[0].baseScore).toBeLessThanOrEqual(1);
  });
});
