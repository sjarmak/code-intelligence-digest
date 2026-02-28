import { describe, expect, it } from "vitest";

import { postProcessCompetitorIntelItems, type RankedCompetitorIntelItem } from "../../../src/lib/agents/competitor-intel";
import { formatCompetitorIntelMarkdown } from "../../../src/lib/agents/format-structured-reports";

function makeItem(overrides: Partial<RankedCompetitorIntelItem> = {}): RankedCompetitorIntelItem {
  return {
    competitor: "Cursor",
    date: "2026-02-20",
    date_confidence: "exact",
    title: "Introducing Composer 1.5",
    source: "cursor.com",
    source_type: "primary",
    url: "https://cursor.com/blog/composer-1-5?utm_source=newsletter#section",
    update_type: "pricing_packaging",
    overlap_with_sourcegraph: ["agent_context", "enterprise_control", "large_codebase_understanding"],
    summary:
      "Blog / research Introducing Composer 1.5 Content: Navigation menu Content: A few months ago we released Composer 1. This release improves coding ability.",
    why_it_matters: "Launch update for enterprise workflows.",
    threat_level: "high",
    confidence: "high",
    novelty_score: 4.5,
    relevance_score: 4.9,
    actionability: ["sales", "product", "messaging", "exec"],
    integration_opportunity: "high_opportunity",
    sourcegraph_integration_play: [
      "Use Sourcegraph as the agent context layer: fetch cross-repo symbols, ownership, and usage paths before generation.",
    ],
    evidence_notes: [],
    debug_scores: {
      final_score: 5.2,
      enterprise_relevance: 3.5,
      direct_overlap: 2.8,
    },
    ...overrides,
  };
}

describe("competitor intel quality pass", () => {
  it("canonicalizes URLs, cleans summary noise, and backfills evidence notes", () => {
    const [item] = postProcessCompetitorIntelItems([makeItem()]);
    expect(item.url).toBe("https://cursor.com/blog/composer-1-5");
    expect(item.summary.toLowerCase()).not.toContain("content:");
    expect(item.summary.toLowerCase()).not.toContain("navigation menu");
    expect(item.evidence_notes.length).toBeGreaterThan(0);
  });

  it("downgrades high threat when overlap is not strong enough", () => {
    const [item] = postProcessCompetitorIntelItems([
      makeItem({
        overlap_with_sourcegraph: ["agent_context"],
        debug_scores: { final_score: 5.8, enterprise_relevance: 3.9, direct_overlap: 2.2 },
      }),
    ]);
    expect(item.threat_level).toBe("medium");
  });

  it("reclassifies launch-style updates that were mis-tagged as pricing", () => {
    const [item] = postProcessCompetitorIntelItems([
      makeItem({
        title: "Introducing Claude Sonnet 4.6",
        summary: "Introducing Claude Sonnet 4.6 with stronger coding and computer use capabilities.",
        why_it_matters: "Model release for coding workflows.",
        update_type: "pricing_packaging",
      }),
    ]);
    expect(item.update_type).toBe("product_launch");
  });

  it("drops entries with invalid URLs", () => {
    const items = postProcessCompetitorIntelItems([makeItem({ url: "not-a-url" })]);
    expect(items).toHaveLength(0);
  });
});

describe("competitor intel markdown format", () => {
  it("prints explicit URL and non-empty evidence section", () => {
    const markdown = formatCompetitorIntelMarkdown("Competitor Intel Agent Report", {
      generatedAt: "2026-02-28T00:00:00.000Z",
      periodDays: 30,
      topPerCompetitor: 5,
      items: [makeItem({ url: "https://cursor.com/blog/composer-1-5", evidence_notes: [] })],
    });

    expect(markdown).toContain("- URL: https://cursor.com/blog/composer-1-5");
    expect(markdown).toContain("No evidence notes captured");
  });
});
