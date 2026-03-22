/**
 * Tests for content-ideas candidate relevance gate (GTM-salient vs generic vendor churn).
 */

import { describe, it, expect } from "vitest";
import { hasMinimumContentIdeasRelevance } from "../../../src/lib/agents/content-ideas";
import type { AgentRankedDoc } from "../../../src/lib/pipeline/agentRank";

function doc(overrides: Partial<AgentRankedDoc>): AgentRankedDoc {
  return {
    source: "web",
    url: "https://vendor.example/post",
    title: "Untitled",
    snippet: "",
    metadata: {},
    baseScore: 0.5,
    goalScore: 0.5,
    agentScore: 0.5,
    features: {
      competitorMatch: 0,
      formatType: 0,
      icpMatch: 0,
      recency: 0.5,
      trendLandscape: 0,
    } satisfies AgentRankedDoc["features"],
    ...overrides,
  };
}

describe("hasMinimumContentIdeasRelevance", () => {
  it("accepts strong workflow / competitive signals without extra checks", () => {
    expect(
      hasMinimumContentIdeasRelevance(
        doc({
          title: "Cursor enterprise rollout",
          snippet: "GitHub Copilot comparison for platform teams",
        }),
      ),
    ).toBe(true);
  });

  it("rejects vendor model churn when only weak evidenceStyle (e.g. launch) matches", () => {
    expect(
      hasMinimumContentIdeasRelevance(
        doc({
          title: "Announcing Claude 4",
          snippet: "Today we launch Claude 4. It is smarter and faster than before.",
        }),
      ),
    ).toBe(false);
  });

  it("accepts vendor-titled content when enterprise or workflow hooks are present", () => {
    expect(
      hasMinimumContentIdeasRelevance(
        doc({
          title: "Announcing Claude 4 for Enterprise",
          snippet: "Self-hosted deployment and compliance controls for regulated industries.",
        }),
      ),
    ).toBe(true);
  });

  it("accepts platform engineering / monorepo signals", () => {
    expect(
      hasMinimumContentIdeasRelevance(
        doc({
          title: "Scaling developer velocity in a monorepo",
          snippet: "Platform engineering teams measure codebase health and engineering velocity.",
        }),
      ),
    ).toBe(true);
  });
});
