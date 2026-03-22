import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/pipeline/agentRetrieval", () => ({
  retrieveForAgent: vi.fn(),
}));

vi.mock("../../../src/lib/pipeline/agentRank", () => ({
  rankForAgent: vi.fn(),
}));

import { retrieveForAgent } from "../../../src/lib/pipeline/agentRetrieval";
import { rankForAgent } from "../../../src/lib/pipeline/agentRank";
import { CURATOR_TRACE_SCHEMA_VERSION } from "../../../src/lib/retrieval/curator-trace";
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
    vi.mocked(rankForAgent).mockImplementation(async (goal, _docs, options) => {
      const result = rankedDocs as Awaited<ReturnType<typeof rankForAgent>>;
      if (options?.rankingTrace) {
        const n = Math.min(options.rankingSampleSize ?? 25, result.length);
        const rt = options.rankingTrace;
        rt.schemaVersion = CURATOR_TRACE_SCHEMA_VERSION;
        rt.goal = goal;
        rt.totalRanked = result.length;
        rt.sampleSize = n;
        rt.documents = result.slice(0, n).map((doc, i) => ({
          rank: i + 1,
          id: doc.id,
          url: doc.url,
          title: doc.title,
          source: doc.source,
          baseScore: doc.baseScore,
          goalScore: doc.goalScore,
          agentScore: doc.agentScore,
        }));
      }
      return result;
    });
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
    expect(out.pipeline_trace).toBeUndefined();
    expect(out.ideas.length).toBeGreaterThan(0);
    expect(out.selection_debug).toBeDefined();
    expect(out.ideas[0].sources.length).toBeGreaterThan(0);
    expect(out.ideas[0].distribution_plan.primary_format.length).toBeGreaterThan(0);
    expect(out.ideas[0].distribution_plan.setup_steps.length).toBeGreaterThan(0);
    expect(out.ideas[0].guardrails.length).toBeGreaterThan(0);
    expect(out.ideas[0].evidence_quality_note).toBeTruthy();
    expect(out.ideas[0].why_now).not.toContain("aligns with active playbook priorities");
  });

  it("includes pipeline_trace when pipelineTrace is enabled", async () => {
    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5, pipelineTrace: true });
    expect(out.pipeline_trace).toBeDefined();
    expect(out.pipeline_trace?.schemaVersion).toBe(CURATOR_TRACE_SCHEMA_VERSION);
    expect(out.pipeline_trace?.retrieval.market_brief.goal).toBe("market_brief");
    expect(out.pipeline_trace?.retrieval.competitor_intel.goal).toBe("competitor_intel");
    // configSnapshot is filled by real `retrieveForAgent`; unit tests mock retrieval without mutating trace.
    expect(out.pipeline_trace?.ranking.goal).toBe("content_ideas");
    expect(out.pipeline_trace?.ranking.documents.length).toBeGreaterThan(0);
    expect(out.pipeline_trace?.interpretable_steps?.length).toBeGreaterThan(3);
    expect(out.pipeline_trace?.refinement_stages?.some((s) => s.stage === "final_ideas")).toBe(true);
    expect(out.pipeline_trace?.candidate_gates.length).toBeGreaterThan(0);
    expect(out.pipeline_trace?.selection.selection_pool_size).toBeGreaterThan(0);

    const traceArgs = vi.mocked(retrieveForAgent).mock.calls.map((c) => c[1]);
    expect(traceArgs.every((opts) => opts?.trace != null)).toBe(true);
  });

  it("builds content ideas from market brief + competitor intel pools", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    await generateContentIdeas({ periodDays: 30, numIdeas: 3, focus: "mcp" });

    const goalsQueried = vi.mocked(retrieveForAgent).mock.calls.map((c) => c[0]);
    expect(goalsQueried).toContain("market_brief");
    expect(goalsQueried).toContain("competitor_intel");
    expect(goalsQueried).not.toContain("content_ideas");
  });

  it("does not reintroduce guardrail-violating candidates during short-window backfill", async () => {
    const invalidTitle = "Benchmark: replace GitHub Copilot for enterprise migrations";
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/secure-context-rollout",
          title: "Case study: secure context rollout for enterprise monorepos",
          snippet: "Customer case study with compliance controls, audit trails, and platform engineering workflow evidence.",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.92,
          agentScore: 0.91,
          features: {
            competitorMatch: 0.6,
            formatType: 0.8,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-16"),
        },
        {
          source: "web" as const,
          url: "https://example.com/replace-copilot",
          title: invalidTitle,
          snippet: "Benchmark launch with customer proof, compliance, and platform engineering details.",
          metadata: {},
          baseScore: 0.89,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.9,
            formatType: 0.7,
            icpMatch: 0.85,
            recency: 0.95,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-17"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 3 });

    expect(out.ideas.length).toBe(1);
    expect(out.ideas[0].sources[0]?.title).not.toBe(invalidTitle);
    expect(out.ideas.some((idea) => idea.sources.some((source) => source.title === invalidTitle))).toBe(false);
  });

  it("filters short-window academic research without direct coding-workflow hooks", async () => {
    const offTopicResearchTitle =
      "Ontology-Guided Diffusion for Zero-Shot Visual Sim2Real Transfer";
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-software-lifecycle",
          title: "GitLab enables broader access to agentic AI across the software lifecycle",
          snippet: "Enterprise developer platform teams evaluate governance, compliance, and software lifecycle controls.",
          metadata: {},
          baseScore: 0.92,
          goalScore: 0.93,
          agentScore: 0.92,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://arxiv.org/abs/2603.12345",
          title: offTopicResearchTitle,
          snippet: "A visual simulation paper with zero-shot transfer benchmarks and diffusion modeling results.",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.88,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.1,
            formatType: 0.6,
            icpMatch: 0.2,
            recency: 0.95,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-20"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 3 });

    expect(out.ideas.some((idea) => idea.sources.some((source) => source.title === offTopicResearchTitle))).toBe(false);
  });

  it("broadens authoritative research titles into Sourcegraph-relevant themes", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://arxiv.org/abs/2603.67890",
          title: "From Weak Cues to Real Identities: Evaluating Inference-Driven De-Anonymization in LLM Agents",
          snippet:
            "Research on enterprise coding agents, repository context exposure, audit controls, and governance for developer platforms.",
          metadata: {},
          baseScore: 0.86,
          goalScore: 0.87,
          agentScore: 0.86,
          features: {
            competitorMatch: 0.4,
            formatType: 0.7,
            icpMatch: 0.75,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-20"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 1 });

    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0].title).toMatch(/Repository Context|Governance|Compliance|Verification|Audit-ready|Audit-Ready/);
    expect(out.ideas[0].title).not.toContain("From Weak Cues");
  });

  it("broadens vendor product-update titles into Sourcegraph-relevant themes", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-software-lifecycle",
          title: "GitLab Enables Broader and More Affordable Access to Agentic AI Across the Software Lifecycle",
          snippet:
            "Enterprise developer platform teams evaluate governance, compliance, repository context, and software lifecycle controls.",
          metadata: {},
          baseScore: 0.92,
          goalScore: 0.93,
          agentScore: 0.92,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 1 });

    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0].title).not.toContain("GitLab Enables Broader");
    expect(out.ideas[0].title).not.toContain("Code Search, Deep Search, and Repository Context");
    expect(out.ideas[0].title).toMatch(/Repository Context|Governance|Enterprise Code Intelligence|Audit-Ready/);
  });

  it("avoids repeating the same primary source domain across short-window ideas when alternatives exist", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-controls",
          title: "GitLab adds enterprise agent governance controls",
          snippet: "Compliance, audit controls, and developer platform governance for AI code changes.",
          metadata: {},
          baseScore: 0.93,
          goalScore: 0.94,
          agentScore: 0.93,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://sourcegraph.com/blog/retrieval-precision-code-search-agents",
          title: "Guide: Retrieval precision with Code Search and Deep Search for coding agents",
          snippet: "Documentation and benchmark evidence for repository context, code search, deep search, and verification in large codebases.",
          metadata: {},
          baseScore: 0.92,
          goalScore: 0.93,
          agentScore: 0.92,
          features: {
            competitorMatch: 0.6,
            formatType: 0.8,
            icpMatch: 0.88,
            recency: 0.95,
            trendLandscape: 0.5,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://www.infoq.com/articles/cross-repo-verification-loops",
          title: "Cross-repo verification loops for platform teams",
          snippet: "Migration, remediation, verification, and governed rollout in large codebases.",
          metadata: {},
          baseScore: 0.89,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.5,
            formatType: 0.8,
            icpMatch: 0.82,
            recency: 0.9,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-18"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 3 });

    const primaryDomains = out.ideas.map((idea) => {
      const url = idea.sources[0]?.url ?? "";
      return new URL(url).hostname.replace(/^www\./, "");
    });
    expect(new Set(primaryDomains).size).toBe(primaryDomains.length);
  });

  it("prefers platform persona over security persona when workflow/platform signals are primary", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/platform-governance",
          title: "Developer platform governance for repository context",
          snippet: "Platform engineering teams need audit trails, policy controls, and repository context for coding agents.",
          metadata: {},
          baseScore: 0.91,
          goalScore: 0.92,
          agentScore: 0.91,
          features: {
            competitorMatch: 0.6,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 1 });

    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0].target_persona).toBe("Head of Developer Platform");
  });

  it("prefers staff engineer for retrieval-context themes without explicit executive language", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/retrieval-context",
          title: "Repository context and deep search for coding agents",
          snippet: "Code search, deep search, MCP, and repository context improve verification in large codebases.",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.91,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.5,
            formatType: 0.7,
            icpMatch: 0.88,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 1 });

    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0].target_persona).toBe("Staff Engineer");
  });

  it("filters untrusted secondary corroboration domains from final idea sources", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-controls",
          title: "GitLab adds enterprise agent governance controls",
          snippet: "Compliance, audit controls, and developer platform governance for AI code changes.",
          metadata: {},
          baseScore: 0.93,
          goalScore: 0.94,
          agentScore: 0.93,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://tech-insider.org/ai-code-governance-trends",
          title: "AI governance trends for coding tools",
          snippet: "Auditability and compliance trends in AI coding workflows.",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.4,
            formatType: 0.6,
            icpMatch: 0.8,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://www.infoq.com/articles/ai-code-governance-enterprise",
          title: "Why enterprise AI code governance needs audit trails and policy controls",
          snippet: "Case study coverage of compliance, audit trails, policy enforcement, and verification for enterprise developer platforms.",
          metadata: {},
          baseScore: 0.89,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.5,
            formatType: 0.8,
            icpMatch: 0.84,
            recency: 0.9,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-18"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 2 });

    expect(
      out.ideas.some((idea) => idea.sources.some((source) => source.source === "tech-insider.org")),
    ).toBe(false);
  });

  it("dedupes corroboration sources by publisher family within each idea", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-controls",
          title: "GitLab adds enterprise agent governance controls",
          snippet: "Compliance, audit controls, and developer platform governance for AI code changes.",
          metadata: {},
          baseScore: 0.93,
          goalScore: 0.94,
          agentScore: 0.93,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://gitlab.com/releases/agentic-ai-controls",
          title: "GitLab release notes for enterprise agent governance controls",
          snippet: "Documentation, release, audit controls, and policy enforcement for AI code changes.",
          metadata: {},
          baseScore: 0.91,
          goalScore: 0.92,
          agentScore: 0.91,
          features: {
            competitorMatch: 0.7,
            formatType: 0.7,
            icpMatch: 0.85,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://www.infoq.com/articles/ai-code-governance-enterprise",
          title: "Why enterprise AI code governance needs audit trails and policy controls",
          snippet: "Case study coverage of compliance, audit trails, policy enforcement, and verification for enterprise developer platforms.",
          metadata: {},
          baseScore: 0.89,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.5,
            formatType: 0.8,
            icpMatch: 0.84,
            recency: 0.9,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-18"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 1 });
    const baseDomains = out.ideas[0].sources.map((source) => {
      const url = new URL(source.url);
      const host = url.hostname.replace(/^www\./, "");
      const parts = host.split(".");
      return parts.length >= 2 ? parts.slice(-2).join(".") : host;
    });

    expect(new Set(baseDomains).size).toBe(baseDomains.length);
  });

  it("prefers alternate lead domains across short-window source-driven frames when available", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-controls",
          title: "GitLab adds enterprise agent governance controls",
          snippet: "Compliance, audit controls, and developer platform governance for AI code changes.",
          metadata: {},
          baseScore: 0.95,
          goalScore: 0.95,
          agentScore: 0.95,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-remediation",
          title: "GitLab expands agentic remediation workflows",
          snippet: "Cross-repo remediation and rollout controls for platform engineering teams.",
          metadata: {},
          baseScore: 0.94,
          goalScore: 0.94,
          agentScore: 0.94,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.88,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://www.infoq.com/articles/cross-repo-verification-loops",
          title: "Cross-repo verification loops for platform teams",
          snippet: "Migration, remediation, verification, and governed rollout in large codebases.",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.91,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.5,
            formatType: 0.8,
            icpMatch: 0.83,
            recency: 0.9,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-18"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 2 });
    const primaryDomains = out.ideas.map((idea) => {
      const url = idea.sources[0]?.url ?? "";
      return new URL(url).hostname.replace(/^www\./, "");
    });

    expect(primaryDomains).toContain("about.gitlab.com");
    expect(primaryDomains).toContain("infoq.com");
  });

  it("filters weak general-interest secondary domains from short-window primary hooks", async () => {
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://about.gitlab.com/blog/agentic-ai-controls",
          title: "GitLab adds enterprise agent governance controls",
          snippet: "Compliance, audit controls, and developer platform governance for AI code changes.",
          metadata: {},
          baseScore: 0.95,
          goalScore: 0.95,
          agentScore: 0.95,
          features: {
            competitorMatch: 0.8,
            formatType: 0.7,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://www.fastcompany.com/enterprise-ai-coding-trends",
          title: "Enterprise AI coding trends in 2026",
          snippet: "A high-level business article on AI coding investment and strategy.",
          metadata: {},
          baseScore: 0.93,
          goalScore: 0.93,
          agentScore: 0.93,
          features: {
            competitorMatch: 0.4,
            formatType: 0.6,
            icpMatch: 0.7,
            recency: 0.95,
            trendLandscape: 0.5,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://www.infoq.com/articles/repository-context-coding-agents",
          title: "Repository context for coding agents",
          snippet: "Code search, deep search, and repository context improve verification in large codebases.",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.91,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.5,
            formatType: 0.8,
            icpMatch: 0.85,
            recency: 0.9,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-18"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 3 });

    expect(
      out.ideas.some((idea) => idea.sources[0]?.source === "fastcompany.com"),
    ).toBe(false);
  });

  it("filters generic product updates without a durable Sourcegraph narrative", async () => {
    const weakTitle = "Modernizing the Command Line: Heroku CLI v11";
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://www.heroku.com/blog/heroku-cli-v11",
          title: weakTitle,
          snippet: "A platform tooling refresh for the Heroku command line with general usability improvements.",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.88,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.2,
            formatType: 0.6,
            icpMatch: 0.35,
            recency: 0.95,
            trendLandscape: 0.2,
          },
          publishedAt: new Date("2026-03-19"),
        },
        {
          source: "web" as const,
          url: "https://example.com/mcp-governance",
          title: "Enterprise MCP governance controls for coding agents",
          snippet: "Compliance, audit trails, and cross-repo context for platform engineering teams.",
          metadata: {},
          baseScore: 0.87,
          goalScore: 0.9,
          agentScore: 0.88,
          features: {
            competitorMatch: 0.5,
            formatType: 0.5,
            icpMatch: 0.9,
            recency: 0.95,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-19"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 3 });

    expect(out.ideas.some((idea) => idea.sources.some((source) => source.title === weakTitle))).toBe(false);
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

  it("prioritizes month-window ideas with corroborated (2+) sources when available", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://vendor-a.example.com/mcp-enterprise",
          title: "MCP context layer for enterprise codebases",
          snippet: "Benchmark report: cross-repo context and agent retrieval in production",
          metadata: {},
          baseScore: 0.91,
          goalScore: 0.91,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.5,
            formatType: 0.4,
            icpMatch: 0.9,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://vendor-b.example.com/mcp-agent-context",
          title: "Agent context architecture with MCP",
          snippet: "Documentation: model context protocol and cross-repo symbol retrieval",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.5,
            formatType: 0.4,
            icpMatch: 0.9,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-02-27"),
        },
        {
          source: "web" as const,
          url: "https://single-source.example.com/compliance-announcement",
          title: "Security tool update for coding agents",
          snippet: "Operational network updates for coding assistant traffic",
          metadata: {},
          baseScore: 0.82,
          goalScore: 0.82,
          agentScore: 0.81,
          features: {
            competitorMatch: 0.4,
            formatType: 0.3,
            icpMatch: 0.7,
            recency: 0.9,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-02-26"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 4 });
    expect(out.ideas.length).toBeGreaterThan(0);
    const corroborated = out.ideas.filter((idea) => new Set(idea.sources.map((s) => s.url)).size >= 2);
    expect(corroborated.length).toBeGreaterThanOrEqual(1);
    expect(new Set(corroborated[0].sources.map((s) => s.url)).size).toBeGreaterThanOrEqual(2);
  });

  it("does not map generic network-config updates to compliance frame", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://github.blog/changelog/network-config-coding-agent",
          title: "Network configuration changes for coding agent now in effect",
          snippet: "Release notes: operational routing update for enterprise orgs using coding assistants with cross-repo code search",
          metadata: {},
          baseScore: 0.86,
          goalScore: 0.86,
          agentScore: 0.84,
          features: {
            competitorMatch: 0.5,
            formatType: 0.3,
            icpMatch: 0.75,
            recency: 0.95,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-02"),
        },
        {
          source: "web" as const,
          url: "https://example.com/mcp-context-enterprise",
          title: "MCP context layer patterns for enterprise code search",
          snippet: "Documentation and benchmark: cross-repo context retrieval and symbol-level grounding for coding assistants",
          metadata: {},
          baseScore: 0.87,
          goalScore: 0.87,
          agentScore: 0.86,
          features: {
            competitorMatch: 0.5,
            formatType: 0.4,
            icpMatch: 0.82,
            recency: 0.92,
            trendLandscape: 0.35,
          },
          publishedAt: new Date("2026-03-01"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 7, numIdeas: 1 });
    expect(out.ideas.length).toBeGreaterThan(0);
    expect(out.ideas[0].title).not.toContain("Secure and Compliant AI Coding Workflows");
  });

  it("does not emit compliance idea without hard compliance controls in month window", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://github.blog/changelog/network-configuration-coding-agent",
          title: "Network configuration changes for Copilot coding agent now in effect",
          snippet: "Operational routing and policy update for enterprise orgs",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.88,
          features: {
            competitorMatch: 0.6,
            formatType: 0.3,
            icpMatch: 0.8,
            recency: 0.95,
            trendLandscape: 0.3,
          },
          publishedAt: new Date("2026-03-02"),
        },
        {
          source: "web" as const,
          url: "https://www.latent.space/p/reviews-dead",
          title: "How to Kill the Code Review",
          snippet: "Commentary on agent workflows and review bottlenecks",
          metadata: {},
          baseScore: 0.86,
          goalScore: 0.86,
          agentScore: 0.85,
          features: {
            competitorMatch: 0.4,
            formatType: 0.3,
            icpMatch: 0.75,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-01"),
        },
        {
          source: "web" as const,
          url: "https://example.com/mcp-context-enterprise",
          title: "MCP context layer patterns for enterprise code search",
          snippet: "Documentation and benchmark: cross-repo context retrieval",
          metadata: {},
          baseScore: 0.87,
          goalScore: 0.87,
          agentScore: 0.86,
          features: {
            competitorMatch: 0.5,
            formatType: 0.4,
            icpMatch: 0.82,
            recency: 0.92,
            trendLandscape: 0.35,
          },
          publishedAt: new Date("2026-03-01"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 3 });
    expect(out.ideas.length).toBeGreaterThan(0);
    expect(out.ideas.every((idea) => !idea.title.includes("Secure and Compliant AI Coding Workflows"))).toBe(true);
  });

  it("filters low-leverage github changelog network-config sources for month ideas", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://github.blog/changelog/2026-03-02-network-configuration-changes-for-copilot-coding-agent-now-in-effect",
          title: "Network configuration changes for Copilot coding agent now in effect",
          snippet: "Operational allowlist and routing updates for enterprise organizations",
          metadata: {},
          baseScore: 0.95,
          goalScore: 0.95,
          agentScore: 0.95,
          features: {
            competitorMatch: 0.7,
            formatType: 0.3,
            icpMatch: 0.8,
            recency: 0.95,
            trendLandscape: 0.35,
          },
          publishedAt: new Date("2026-03-02"),
        },
        {
          source: "web" as const,
          url: "https://example.com/customer-case-study-mcp-enterprise",
          title: "Customer case study: MCP context layer for enterprise code search",
          snippet: "Benchmark, customer outcomes, and rollout patterns across large codebases",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.6,
            formatType: 0.5,
            icpMatch: 0.85,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-01"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 3 });
    const sourceTitles = out.ideas.flatMap((i) => i.sources.map((s) => s.title));
    expect(sourceTitles).not.toContain(
      "Network configuration changes for Copilot coding agent now in effect",
    );
  });

  it("backfills month output to 3 ideas with format diversity when high-signal pool is narrow", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://augmentcode.com/blog/context-engine-mcp-now-live",
          title: "Context Engine is now available for any AI coding agent",
          snippet: "MCP context layer launch with enterprise retrieval and cross-repo context",
          metadata: {},
          baseScore: 0.95,
          goalScore: 0.95,
          agentScore: 0.94,
          features: {
            competitorMatch: 0.7,
            formatType: 0.5,
            icpMatch: 0.9,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-01"),
        },
        {
          source: "web" as const,
          url: "https://github.com/upstash/context7",
          title: "Context7 MCP server for up-to-date code documentation",
          snippet: "Open MCP project for retrieval context in coding workflows",
          metadata: {},
          baseScore: 0.92,
          goalScore: 0.92,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.6,
            formatType: 0.4,
            icpMatch: 0.88,
            recency: 0.88,
            trendLandscape: 0.35,
          },
          publishedAt: new Date("2026-02-23"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    expect(out.ideas.length).toBeGreaterThanOrEqual(3);
    expect(out.ideas.length).toBeLessThanOrEqual(5);
    const channels = new Set(out.ideas.map((i) => i.channel));
    expect(channels.size).toBeGreaterThanOrEqual(3);
    expect(channels.has("blog")).toBe(true);
    expect(channels.has("webinar") || channels.has("long_video")).toBe(true);
  });

  it("prefers distinct topic frames in month output when candidates support it", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/mcp-context-enterprise",
          title: "MCP context layer for enterprise codebases",
          snippet: "Cross-repo context and agent retrieval for coding assistants",
          metadata: {},
          baseScore: 0.94,
          goalScore: 0.94,
          agentScore: 0.93,
          features: {
            competitorMatch: 0.7,
            formatType: 0.4,
            icpMatch: 0.9,
            recency: 0.9,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-01"),
        },
        {
          source: "web" as const,
          url: "https://example.com/batch-changes-remediation",
          title: "Cross-repo remediation and migration with codemods",
          snippet: "Batch changes and large-scale code migration in enterprise repos",
          metadata: {},
          baseScore: 0.93,
          goalScore: 0.93,
          agentScore: 0.92,
          features: {
            competitorMatch: 0.65,
            formatType: 0.45,
            icpMatch: 0.88,
            recency: 0.89,
            trendLandscape: 0.38,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/onboarding-large-codebases",
          title: "Developer onboarding in large multi-repo codebases",
          snippet: "Knowledge transfer and onboarding workflows for complex monorepo platforms",
          metadata: {},
          baseScore: 0.91,
          goalScore: 0.91,
          agentScore: 0.9,
          features: {
            competitorMatch: 0.55,
            formatType: 0.4,
            icpMatch: 0.86,
            recency: 0.87,
            trendLandscape: 0.35,
          },
          publishedAt: new Date("2026-02-27"),
        },
        {
          source: "web" as const,
          url: "https://example.com/secure-compliant-ai-coding",
          title: "Secure and compliant AI coding workflows for enterprises",
          snippet: "Security, audit controls, and governance for AI coding adoption",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.58,
            formatType: 0.4,
            icpMatch: 0.85,
            recency: 0.86,
            trendLandscape: 0.36,
          },
          publishedAt: new Date("2026-02-26"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    const topics = new Set(
      out.ideas.map((idea) => idea.title.replace(/^[^:]+:\s*/, "").trim().toLowerCase()),
    );
    expect(out.ideas.length).toBeGreaterThanOrEqual(3);
    expect(topics.size).toBeGreaterThanOrEqual(3);
  });

  it("filters research-only month sources and prefers product-market evidence", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://arxiv.org/abs/2603.00729",
          title: "Qwen3-Coder-Next Technical Report",
          snippet: "A technical coding model paper with benchmark methodology details",
          metadata: {},
          baseScore: 0.97,
          goalScore: 0.97,
          agentScore: 0.96,
          features: {
            competitorMatch: 0.5,
            formatType: 0.3,
            icpMatch: 0.8,
            recency: 0.95,
            trendLandscape: 0.4,
          },
          publishedAt: new Date("2026-03-03"),
        },
        {
          source: "web" as const,
          url: "https://www.augmentcode.com/blog/context-engine-mcp-now-live",
          title: "Augment Context Engine now available for AI coding agents",
          snippet: "Product launch and MCP workflow support for enterprise engineering teams",
          metadata: {},
          baseScore: 0.92,
          goalScore: 0.92,
          agentScore: 0.91,
          features: {
            competitorMatch: 0.7,
            formatType: 0.4,
            icpMatch: 0.88,
            recency: 0.9,
            trendLandscape: 0.36,
          },
          publishedAt: new Date("2026-02-06"),
        },
        {
          source: "web" as const,
          url: "https://example.com/customer-case-study-cross-repo-remediation",
          title: "Customer case study: cross-repo remediation rollout in regulated enterprise",
          snippet: "Enterprise security/compliance workflow with controlled batch changes",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.6,
            formatType: 0.45,
            icpMatch: 0.86,
            recency: 0.88,
            trendLandscape: 0.35,
          },
          publishedAt: new Date("2026-02-20"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    const sourceUrls = out.ideas.flatMap((i) => i.sources.map((s) => s.url));
    expect(sourceUrls.some((u) => u.includes("arxiv.org"))).toBe(false);
    expect(sourceUrls.some((u) => u.includes("augmentcode.com"))).toBe(true);
  });

  it("avoids repeated topic frames in month output when alternatives exist", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://example.com/codemod-cross-repo-a",
          title: "Cross-repo remediation with codemods in enterprise codebases",
          snippet: "Migration and remediation workflows across many repositories",
          metadata: {},
          baseScore: 0.95,
          goalScore: 0.95,
          agentScore: 0.94,
          features: {
            competitorMatch: 0.7,
            formatType: 0.4,
            icpMatch: 0.9,
            recency: 0.9,
            trendLandscape: 0.38,
          },
          publishedAt: new Date("2026-03-02"),
        },
        {
          source: "web" as const,
          url: "https://example.com/codemod-cross-repo-b",
          title: "Enterprise migration playbook for large-scale code remediation",
          snippet: "Batch migration and codemod execution for security remediation",
          metadata: {},
          baseScore: 0.94,
          goalScore: 0.94,
          agentScore: 0.93,
          features: {
            competitorMatch: 0.68,
            formatType: 0.4,
            icpMatch: 0.88,
            recency: 0.89,
            trendLandscape: 0.37,
          },
          publishedAt: new Date("2026-03-01"),
        },
        {
          source: "web" as const,
          url: "https://example.com/mcp-context-enterprise",
          title: "MCP context layer patterns for enterprise AI coding",
          snippet: "Agent context and retrieval patterns for multi-repo codebases",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.89,
          features: {
            competitorMatch: 0.62,
            formatType: 0.42,
            icpMatch: 0.85,
            recency: 0.88,
            trendLandscape: 0.36,
          },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://example.com/onboarding-large-codebases",
          title: "Developer onboarding in large multi-repo systems",
          snippet: "Knowledge transfer and navigation for complex codebases",
          metadata: {},
          baseScore: 0.89,
          goalScore: 0.89,
          agentScore: 0.88,
          features: {
            competitorMatch: 0.58,
            formatType: 0.4,
            icpMatch: 0.84,
            recency: 0.87,
            trendLandscape: 0.35,
          },
          publishedAt: new Date("2026-02-27"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 4 });
    const frameCounts = out.ideas.reduce<Record<string, number>>((acc, idea) => {
      const topic = idea.title.replace(/^[^:]+:\s*/, "").trim().toLowerCase();
      acc[topic] = (acc[topic] ?? 0) + 1;
      return acc;
    }, {});
    const duplicateTopics = Object.values(frameCounts).filter((count) => count > 1);
    expect(out.ideas.length).toBeGreaterThanOrEqual(3);
    expect(duplicateTopics.length).toBe(0);
  });

  it("backfills to 3 distinct themes from secondary evidence when strict dedupe leaves too few", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://github.com/codemod/codemod",
          title: "Codemod CLI for cross-repo remediation and migration",
          snippet: "Batch remediation workflow for large enterprise repositories",
          metadata: {},
          baseScore: 0.95,
          goalScore: 0.95,
          agentScore: 0.94,
          features: {
            competitorMatch: 0.7,
            formatType: 0.4,
            icpMatch: 0.9,
            recency: 0.9,
            trendLandscape: 0.38,
          },
          publishedAt: new Date("2026-02-26"),
        },
        {
          source: "web" as const,
          url: "https://www.augmentcode.com/blog/context-engine-mcp-now-live",
          title: "Augment Context Engine MCP launch for coding agents",
          snippet: "MCP context layer for enterprise AI coding workflows",
          metadata: {},
          baseScore: 0.93,
          goalScore: 0.93,
          agentScore: 0.92,
          features: {
            competitorMatch: 0.68,
            formatType: 0.4,
            icpMatch: 0.88,
            recency: 0.89,
            trendLandscape: 0.37,
          },
          publishedAt: new Date("2026-02-06"),
        },
        {
          source: "web" as const,
          url: "https://example.org/enterprise-onboarding-large-codebases",
          title: "Developer onboarding in large codebases with AI assistants",
          snippet: "Platform teams need cross-repo context and knowledge transfer workflows for new engineers",
          metadata: {},
          baseScore: 0.72,
          goalScore: 0.72,
          agentScore: 0.71,
          features: {
            competitorMatch: 0.35,
            formatType: 0.35,
            icpMatch: 0.7,
            recency: 0.88,
            trendLandscape: 0.42,
          },
          publishedAt: new Date("2026-02-24"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    expect(out.ideas.length).toBeGreaterThanOrEqual(3);
  });

  it("returns 3-5 ideas with channel diversity for month window", async () => {
    vi.mocked(retrieveForAgent).mockResolvedValue([]);
    vi.mocked(rankForAgent).mockResolvedValue(
      [
        {
          source: "web" as const,
          url: "https://vendor-a.example.com/mcp-launch",
          title: "MCP context layer launch for enterprise coding agents",
          snippet: "GA release notes and docs",
          metadata: {},
          baseScore: 0.92,
          goalScore: 0.92,
          agentScore: 0.9,
          features: { competitorMatch: 0.6, formatType: 0.5, icpMatch: 0.9, recency: 0.9, trendLandscape: 0.4 },
          publishedAt: new Date("2026-03-02"),
        },
        {
          source: "web" as const,
          url: "https://vendor-b.example.com/mcp-webinar",
          title: "Webinar: scaling agent context across multi-repo codebases",
          snippet: "Customer case study and benchmark results",
          metadata: {},
          baseScore: 0.9,
          goalScore: 0.9,
          agentScore: 0.88,
          features: { competitorMatch: 0.5, formatType: 0.6, icpMatch: 0.85, recency: 0.9, trendLandscape: 0.35 },
          publishedAt: new Date("2026-03-01"),
        },
        {
          source: "web" as const,
          url: "https://vendor-c.example.com/mcp-conference-talk",
          title: "Conference talk: enterprise code search context patterns",
          snippet: "Launch and implementation walkthrough",
          metadata: {},
          baseScore: 0.89,
          goalScore: 0.89,
          agentScore: 0.87,
          features: { competitorMatch: 0.5, formatType: 0.5, icpMatch: 0.82, recency: 0.88, trendLandscape: 0.34 },
          publishedAt: new Date("2026-03-01"),
        },
        {
          source: "web" as const,
          url: "https://vendor-d.example.com/mcp-video-walkthrough",
          title: "Video walkthrough: MCP architecture for large codebases",
          snippet: "Demo video and docs",
          metadata: {},
          baseScore: 0.88,
          goalScore: 0.88,
          agentScore: 0.86,
          features: { competitorMatch: 0.5, formatType: 0.5, icpMatch: 0.8, recency: 0.87, trendLandscape: 0.33 },
          publishedAt: new Date("2026-02-28"),
        },
        {
          source: "web" as const,
          url: "https://vendor-e.example.com/mcp-ad-campaign",
          title: "Paid campaign guide for AI coding assistant adoption",
          snippet: "Ad campaign playbook and benchmark",
          metadata: {},
          baseScore: 0.87,
          goalScore: 0.87,
          agentScore: 0.85,
          features: { competitorMatch: 0.45, formatType: 0.5, icpMatch: 0.8, recency: 0.86, trendLandscape: 0.32 },
          publishedAt: new Date("2026-02-28"),
        },
      ] as Awaited<ReturnType<typeof rankForAgent>>,
    );

    const out = await generateContentIdeas({ periodDays: 30, numIdeas: 5 });
    expect(out.ideas.length).toBeGreaterThanOrEqual(3);
    expect(out.ideas.length).toBeLessThanOrEqual(5);
    const uniqueChannels = new Set(out.ideas.map((idea) => idea.channel));
    expect(uniqueChannels.size).toBeGreaterThanOrEqual(3);
  });
});
