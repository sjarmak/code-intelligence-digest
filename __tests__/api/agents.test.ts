/**
 * Tests for agent pipeline (retrieve → rank → shortlist) used by agent API routes.
 * Route handlers are tested indirectly via pipeline behavior; full route tests
 * require Next.js path resolution (@/...) which may not be set in Vitest.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { rankForAgent } from "../../src/lib/pipeline/agentRank";
import { buildAgentShortlist } from "../../src/lib/pipeline/agentShortlist";

describe("agents pipeline", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("rankForAgent returns sorted docs with agentScore", async () => {
    const docs = [
      {
        source: "postgres_items" as const,
        title: "Doc A",
        metadata: {},
      },
      {
        source: "web" as const,
        title: "Doc B",
        url: "https://example.com/b",
        metadata: {},
      },
    ];
    const ranked = await rankForAgent("market_brief", docs);
    expect(ranked.length).toBe(2);
    expect(ranked[0]).toHaveProperty("agentScore");
    expect(ranked[0].agentScore).toBeGreaterThanOrEqual(ranked[1]?.agentScore ?? 0);
  });

  it("buildAgentShortlist returns shortlist entries with rank", async () => {
    const ranked = [
      {
        source: "postgres_items" as const,
        title: "Top",
        metadata: {},
        baseScore: 0.8,
        goalScore: 0.8,
        agentScore: 0.8,
        features: {
          competitorMatch: 0,
          formatType: 0,
          icpMatch: 0,
          recency: 0,
          trendLandscape: 0,
        },
      },
    ];
    const shortlist = await buildAgentShortlist("competitor_intel", ranked, 5);
    expect(Array.isArray(shortlist)).toBe(true);
    expect(shortlist.length).toBeGreaterThan(0);
    expect(shortlist[0]).toHaveProperty("rank");
    expect(shortlist[0]).toHaveProperty("doc");
  });
});
