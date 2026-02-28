import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/pipeline/agentRetrieval", () => ({
  retrieveForAgent: vi.fn(),
}));

vi.mock("../../../src/lib/pipeline/agentRank", () => ({
  rankForAgent: vi.fn(),
}));

import { retrieveForAgent } from "../../../src/lib/pipeline/agentRetrieval";
import { rankForAgent } from "../../../src/lib/pipeline/agentRank";
import { generateMarketBrief } from "../../../src/lib/agents/market-brief";
import { generateContentIdeas } from "../../../src/lib/agents/content-ideas";

const rankedDocs = [
  {
    source: "web" as const,
    url: "https://example.com/finserv",
    title: "Capital markets compliance launch for cross-repo search",
    snippet: "FinServ platform teams need BYOK and auditability",
    metadata: {},
    baseScore: 0.8,
    goalScore: 0.82,
    agentScore: 0.81,
    features: {
      competitorMatch: 0.7,
      formatType: 0.2,
      icpMatch: 0.9,
      recency: 0.9,
      trendLandscape: 0.4,
    },
    publishedAt: new Date("2026-02-20"),
  },
  {
    source: "web" as const,
    url: "https://example.com/mcp",
    title: "MCP context layer update for enterprise code search",
    snippet: "Platform engineering teams evaluate cross-repo context",
    metadata: {},
    baseScore: 0.7,
    goalScore: 0.79,
    agentScore: 0.75,
    features: {
      competitorMatch: 0.6,
      formatType: 0.2,
      icpMatch: 0.8,
      recency: 0.8,
      trendLandscape: 0.5,
    },
    publishedAt: new Date("2026-02-21"),
  },
];

describe("structured gtm agents", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(rankedDocs as Awaited<ReturnType<typeof rankForAgent>>);
  });

  it("generates market brief with policy/evidence separation", async () => {
    const out = await generateMarketBrief({ periodDays: 14, maxItems: 5 });
    expect(out.playbook_version).toBeTruthy();
    expect(out.executive_delta.length).toBeGreaterThan(0);
    expect(out.executive_delta[0].policy_basis.length).toBeGreaterThan(0);
    expect(out.executive_delta[0].evidence.length).toBeGreaterThan(0);
  });

  it("generates content ideas with sources and distribution plan", async () => {
    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    expect(out.playbook_version).toBeTruthy();
    expect(out.ideas.length).toBeGreaterThan(0);
    expect(out.selection_debug).toBeDefined();
    expect(out.ideas[0].sources.length).toBeGreaterThan(0);
    expect(out.ideas[0].distribution_plan.primary_format.length).toBeGreaterThan(0);
    expect(out.ideas[0].distribution_plan.setup_steps.length).toBeGreaterThan(0);
    expect(out.ideas[0].guardrails.length).toBeGreaterThan(0);
  });
});
