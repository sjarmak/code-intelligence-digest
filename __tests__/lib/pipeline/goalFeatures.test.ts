/**
 * Tests for goal-aware feature computation
 */

import { describe, it, expect } from "vitest";
import { computeGoalFeatures } from "../../../src/lib/pipeline/goalFeatures";
import type { RetrievedDoc } from "../../../src/lib/pipeline/agentRetrieval";

function doc(overrides: Partial<RetrievedDoc>): RetrievedDoc {
  return {
    source: "postgres_items",
    title: "Test",
    metadata: {},
    ...overrides,
  };
}

describe("goalFeatures", () => {
  it("computes competitorMatch when competitor keywords present", () => {
    const d = doc({
      title: "Cursor IDE releases new feature",
      snippet: "Cursor and Copilot are competing.",
    });
    const f = computeGoalFeatures(d, "competitor_intel");
    expect(f.competitorMatch).toBeGreaterThan(0);
  });

  it("computes formatType for webinar content", () => {
    const d = doc({
      title: "Join our webinar on code search",
      snippet: "Live session next week.",
    });
    const f = computeGoalFeatures(d, "content_ideas");
    expect(f.formatType).toBeGreaterThan(0);
  });

  it("computes icpMatch for enterprise/monorepo terms", () => {
    const d = doc({
      title: "Scaling code search in a large monorepo",
      snippet: "Enterprise developer productivity.",
    });
    const f = computeGoalFeatures(d, "market_brief");
    expect(f.icpMatch).toBeGreaterThan(0);
  });

  it("computes recency from publishedAt", () => {
    const recent = doc({ publishedAt: new Date() });
    const old = doc({ publishedAt: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) });
    const fRecent = computeGoalFeatures(recent, "content_ideas");
    const fOld = computeGoalFeatures(old, "content_ideas");
    expect(fRecent.recency).toBeGreaterThan(fOld.recency);
  });

  it("computes trendLandscape for market brief", () => {
    const d = doc({
      title: "Market trends in developer tools",
      snippet: "Adoption report and landscape shift.",
    });
    const f = computeGoalFeatures(d, "market_brief");
    expect(f.trendLandscape).toBeGreaterThan(0);
  });
});
