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
    expect(out.periodDays).toBe(14);
    expect(out.playbook_version).toBeTruthy();
    expect(out.executive_delta.length).toBeGreaterThan(0);
    expect(out.executive_delta[0].policy_basis.length).toBeGreaterThan(0);
    expect(out.executive_delta[0].evidence.length).toBeGreaterThan(0);
    expect(out.executive_delta[0].evidence_quality_note).toBeTruthy();
  });

  it("filters low-signal market-report sources and avoids false invalidations", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://marketsandmarkets.com/some-report",
          title: "AI Code Assistants Market worth $127.05 billion by 2032",
          snippet: "Global market forecast and CAGR report",
          metadata: {},
          baseScore: 0.95,
          goalScore: 0.95,
          agentScore: 0.95,
          features: {
            competitorMatch: 0.4,
            formatType: 0.1,
            icpMatch: 0.4,
            recency: 0.9,
            trendLandscape: 0.7,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://github.com/example/xmloxide",
          title: "Show HN: Xmloxide – an agent made rust replacement for libxml2",
          snippet: "Rust replacement for XML parser library",
          metadata: {},
          baseScore: 0.93,
          goalScore: 0.93,
          agentScore: 0.93,
          features: {
            competitorMatch: 0.2,
            formatType: 0.1,
            icpMatch: 0.4,
            recency: 0.9,
            trendLandscape: 0.6,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/enterprise-security-update",
          title: "Enterprise coding assistant adds BYOK audit controls",
          snippet: "VP Engineering and security teams requested stronger governance",
          metadata: {},
          baseScore: 0.82,
          goalScore: 0.85,
          agentScore: 0.84,
          features: {
            competitorMatch: 0.6,
            formatType: 0.2,
            icpMatch: 0.8,
            recency: 0.9,
            trendLandscape: 0.5,
          },
          publishedAt: new Date("2026-02-28"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateMarketBrief({ periodDays: 14, maxItems: 5 });
    const titles = out.executive_delta.map((d) => d.title);

    expect(titles).not.toContain("AI Code Assistants Market worth $127.05 billion by 2032");
    expect(out.invalidations_to_monitor).not.toContain(
      "Show HN: Xmloxide – an agent made rust replacement for libxml2",
    );
    // Xmloxide has no GTM relevance (no code-intel/competitor/enterprise vocabulary), so excluded by relevance gate
    expect(out.executive_delta.length).toBe(1);
  });

  it("excludes items without minimum GTM relevance (dev tools / code intelligence)", async () => {
    const offTopicTitles = [
      "Waymo blocking ambulance during deadly Austin shooting",
      "Fed raises interest rates again",
      "Apple announces new iPhone event",
    ];
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/waymo-ambulance",
          title: offTopicTitles[0],
          snippet: "Autonomous vehicle blocked emergency response during incident",
          metadata: {},
          baseScore: 0.7,
          goalScore: 0.72,
          agentScore: 0.7,
          features: {
            competitorMatch: 0.2,
            formatType: 0.1,
            icpMatch: 0.3,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/fed-rates",
          title: offTopicTitles[1],
          snippet: "Central bank signals further tightening",
          metadata: {},
          baseScore: 0.68,
          goalScore: 0.7,
          agentScore: 0.68,
          features: {
            competitorMatch: 0.1,
            formatType: 0.1,
            icpMatch: 0.2,
            recency: 0.95,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/enterprise-security-update",
          title: "Enterprise coding assistant adds BYOK audit controls",
          snippet: "VP Engineering and security teams requested stronger governance",
          metadata: {},
          baseScore: 0.82,
          goalScore: 0.85,
          agentScore: 0.84,
          features: {
            competitorMatch: 0.6,
            formatType: 0.2,
            icpMatch: 0.8,
            recency: 0.9,
            trendLandscape: 0.5,
          },
          publishedAt: new Date("2026-02-28"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateMarketBrief({ periodDays: 14, maxItems: 5 });
    const allTitles = [...out.executive_delta, ...out.watch_items].map((d) => d.title);
    for (const title of offTopicTitles) {
      expect(allTitles).not.toContain(title);
    }
    expect(out.executive_delta.length).toBe(1);
    expect(out.executive_delta[0].title).toBe("Enterprise coding assistant adds BYOK audit controls");
  });

  it("generates content ideas with sources and distribution plan", async () => {
    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    expect(out.periodDays).toBe(30);
    expect(out.playbook_version).toBeTruthy();
    expect(out.ideas.length).toBeGreaterThan(0);
    expect(out.selection_debug).toBeDefined();
    expect(out.ideas[0].sources.length).toBeGreaterThan(0);
    expect(out.ideas[0].distribution_plan.primary_format.length).toBeGreaterThan(0);
    expect(out.ideas[0].distribution_plan.setup_steps.length).toBeGreaterThan(0);
    expect(out.ideas[0].guardrails.length).toBeGreaterThan(0);
    expect(out.ideas[0].evidence_quality_note).toBeTruthy();
    expect(out.ideas[0].why_now).not.toContain("aligns with active playbook priorities");
  });

  it("does not force event-talk channel from playbook defaults", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/webinar-security",
          title: "Webinar: Secure BYOK controls for enterprise coding assistants",
          snippet: "Security compliance launch with audit controls",
          metadata: {},
          baseScore: 0.88,
          goalScore: 0.88,
          agentScore: 0.88,
          features: {
            competitorMatch: 0.5,
            formatType: 0.6,
            icpMatch: 0.8,
            recency: 0.9,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/case-study-bank",
          title: "Customer case study: cross-repo remediation in global bank",
          snippet: "Migration benchmark and customer outcomes",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.6,
            formatType: 0.5,
            icpMatch: 0.8,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/guide-mcp",
          title: "Guide: MCP context layer rollout for large codebases",
          snippet: "Documentation and enterprise adoption report",
          metadata: {},
          baseScore: 0.86,
          goalScore: 0.86,
          agentScore: 0.86,
          features: {
            competitorMatch: 0.5,
            formatType: 0.5,
            icpMatch: 0.8,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-02-28"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 3 });
    const channels = out.ideas.map((i) => i.channel);
    expect(channels.length).toBeGreaterThan(0);
    expect(channels.every((c) => c !== "event_talk")).toBe(true);
  });

  it("excludes off-topic web docs from content ideas via relevance gate", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/fed-rates",
          title: "Fed raises interest rates again",
          snippet: "Central bank signals further tightening",
          metadata: {},
          baseScore: 0.7,
          goalScore: 0.72,
          agentScore: 0.7,
          features: {
            competitorMatch: 0.1,
            formatType: 0.2,
            icpMatch: 0.2,
            recency: 0.95,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/mcp-enterprise",
          title: "MCP context layer for enterprise code search",
          snippet: "Compliance and self-hosted deployment guide",
          metadata: {},
          baseScore: 0.85,
          goalScore: 0.88,
          agentScore: 0.86,
          features: {
            competitorMatch: 0.5,
            formatType: 0.5,
            icpMatch: 0.9,
            recency: 0.9,
            trendLandscape: 0.5,
          },
          publishedAt: new Date("2026-02-28"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    const sourceTitles = out.ideas.flatMap((i) => i.sources.map((s) => s.title));
    // Relevance gate must exclude the off-topic doc (Fed rates) from any content idea source.
    expect(sourceTitles).not.toContain("Fed raises interest rates again");
  });
});
