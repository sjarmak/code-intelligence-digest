import { describe, expect, it } from "vitest";

import { postProcessMarketBriefOutput, type MarketBriefOutput } from "../../../src/lib/agents/market-brief";
import { postProcessContentIdeasOutput, type ContentIdeasOutput } from "../../../src/lib/agents/content-ideas";

describe("market brief quality guards", () => {
  it("removes low-quality deltas and preserves unknown alignment", () => {
    const payload: MarketBriefOutput = {
      brief_date: "2026-02-28",
      playbook_version: "2026.02.15.1",
      executive_delta: [
        {
          title: "Noisy item",
          summary: "Section Title: Foo Content: bar",
          segment_impact: ["Other"],
          persona_impact: ["VP Engineering"],
          playbook_alignment: "unknown",
          affected_assumptions: [],
          why_it_matters: "x",
          policy_basis: [],
          evidence_basis: [],
          recommended_action: { owner: "SE", action: "x" },
          integration_opportunity: "medium_opportunity",
          sourcegraph_integration_play: ["play"],
          evidence: [
            {
              source: "foo",
              url: "https://example.com/",
              date: "2026-02-28",
              confidence: "medium",
            },
          ],
        },
        {
          title: "Real item",
          summary: "Section Title: Security update Content: enterprise controls",
          segment_impact: ["Banks"],
          persona_impact: ["Security/Compliance"],
          playbook_alignment: "unknown",
          affected_assumptions: [],
          why_it_matters: "x",
          policy_basis: [],
          evidence_basis: [],
          recommended_action: { owner: "SE", action: "x" },
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["play"],
          evidence: [
            {
              source: "vendor",
              url: "https://vendor.example/blog/update?utm_source=test#fragment",
              date: "2026-02-28",
              confidence: "high",
            },
          ],
        },
      ],
      watch_items: [],
      invalidations_to_monitor: [],
      noisy_items_suppressed: [],
    };

    const out = postProcessMarketBriefOutput(payload);
    expect(out.executive_delta).toHaveLength(1);
    expect(out.executive_delta[0].playbook_alignment).toBe("unknown");
    expect(out.executive_delta[0].summary).not.toContain("Section Title:");
    expect(out.executive_delta[0].summary).not.toContain("Content:");
    expect(out.executive_delta[0].evidence[0].url).toBe("https://vendor.example/blog/update");
  });
});

describe("content ideas quality guards", () => {
  it("drops tracking/generic source links and keeps canonical source URLs", () => {
    const payload: ContentIdeasOutput = {
      generated_at: "2026-02-28",
      playbook_version: "2026.02.15.1",
      ideas: [
        {
          title: "Guide: MCP Context",
          thesis: "Section Title: X Content: Y",
          target_segment: "Banks",
          target_persona: "Head of Developer Platform",
          funnel_stage: "business_case",
          channel: "whitepaper",
          why_now: "Now",
          playbook_alignment: [],
          sources: [
            {
              title: "Tracking",
              source: "click.kit-mail3.com",
              url: "https://click.kit-mail3.com/abc",
              date: "2026-02-28",
            },
          ],
          core_claim: "Claim",
          key_insights: ["Content: insight"],
          content_outline: ["Section Title: line"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "monitor_only",
          sourcegraph_integration_play: ["play"],
          distribution_plan: {
            primary_format: "Analyst-style whitepaper",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.9,
        },
        {
          title: "Guide: Cross-repo migration",
          thesis: "Section Title: A Content: B",
          target_segment: "Capital Markets",
          target_persona: "VP Engineering",
          funnel_stage: "business_case",
          channel: "event_talk",
          why_now: "Now",
          playbook_alignment: [],
          sources: [
            {
              title: "Canonical",
              source: "vendor.example",
              url: "https://vendor.example/blog/post?utm_source=test#frag",
              date: "2026-02-28",
            },
          ],
          core_claim: "Claim",
          key_insights: ["Section Title: insight"],
          content_outline: ["Content: outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["play"],
          distribution_plan: {
            primary_format: "Conference talk",
            recommended_venue: "event",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.92,
        },
      ],
    };

    const out = postProcessContentIdeasOutput(payload);
    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0].sources).toHaveLength(1);
    expect(out.ideas[0].sources[0].url).toBe("https://vendor.example/blog/post");
    expect(out.ideas[0].thesis).not.toContain("Section Title:");
    expect(out.ideas[0].thesis).not.toContain("Content:");
  });

  it("prefers distinct short-window topics over duplicate format variants", () => {
    const payload: ContentIdeasOutput = {
      generated_at: "2026-02-28",
      playbook_version: "2026.02.15.1",
      periodDays: 14,
      ideas: [
        {
          title: "Talk Track: Governance, Compliance, and Verification for AI Code Changes",
          thesis: "A",
          target_segment: "Banks",
          target_persona: "VP Engineering",
          funnel_stage: "validation",
          channel: "event_talk",
          why_now: "Now",
          playbook_alignment: [],
          sources: [
            {
              title: "Official launch",
              source: "github.blog",
              url: "https://github.blog/security/application-security/update",
              date: "2026-02-28",
            },
          ],
          core_claim: "Claim",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["play"],
          distribution_plan: {
            primary_format: "Conference talk",
            recommended_venue: "event",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.95,
        },
        {
          title: "Guide: Governance, Compliance, and Verification for AI Code Changes",
          thesis: "B",
          target_segment: "Banks",
          target_persona: "VP Engineering",
          funnel_stage: "validation",
          channel: "whitepaper",
          why_now: "Now",
          playbook_alignment: [],
          sources: [
            {
              title: "Official launch 2",
              source: "blog.cloudflare.com",
              url: "https://blog.cloudflare.com/ai-governance-controls",
              date: "2026-02-28",
            },
          ],
          core_claim: "Claim",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["play"],
          distribution_plan: {
            primary_format: "Whitepaper",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.9,
        },
        {
          title: "Video Brief: Cross-Repo Remediation Workflows with Verification",
          thesis: "C",
          target_segment: "Banks",
          target_persona: "VP Engineering",
          funnel_stage: "validation",
          channel: "long_video",
          why_now: "Now",
          playbook_alignment: [],
          sources: [
            {
              title: "Official remediation story",
              source: "gitlab.com",
              url: "https://about.gitlab.com/releases/2026/03/19/gitlab-18-10-released/",
              date: "2026-02-28",
            },
          ],
          core_claim: "Claim",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["play"],
          distribution_plan: {
            primary_format: "Video",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.88,
        },
      ],
    };

    const out = postProcessContentIdeasOutput(payload);
    expect(out.ideas).toHaveLength(2);
    expect(out.ideas.map((idea) => idea.title)).toContain(
      "Talk Track: Governance, Compliance, and Verification for AI Code Changes",
    );
    expect(out.ideas.map((idea) => idea.title)).toContain(
      "Video Brief: Cross-Repo Remediation Workflows with Verification",
    );
  });

  it("demotes single-source heavyweight competitor hooks in favor of corroborated Sourcegraph-ownable ideas", () => {
    const payload: ContentIdeasOutput = {
      generated_at: "2026-04-06",
      playbook_version: "2026.02.15.1",
      periodDays: 14,
      ideas: [
        {
          title: "Guide: Governance and Auditability for Enterprise Coding Workflows",
          thesis: "A competitor Series B frames quality gates as the next market battleground.",
          target_segment: "Other",
          target_persona: "VP Engineering",
          funnel_stage: "awareness",
          channel: "whitepaper",
          why_now: "A Series B announcement published today makes this timely.",
          playbook_alignment: [],
          sources: [
            {
              title: "CodeRabbit raises $60 million in Series B to build quality gates for AI coding",
              source: "coderabbit.ai",
              url: "https://coderabbit.ai/blog/series-b",
              date: "2026-04-06",
            },
          ],
          core_claim: "AI coding needs governance.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "medium_opportunity",
          sourcegraph_integration_play: ["Position Sourcegraph as the verification layer behind AI code review."],
          distribution_plan: {
            primary_format: "Analyst-style whitepaper",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.95,
        },
        {
          title: "Brief: What Multi-Agent Coding Workflows Need From Repository Context",
          thesis: "New multi-agent repo workflows expose ownership, dependency, and verification gaps that only show up across repository boundaries.",
          target_segment: "Other",
          target_persona: "Head of Developer Platform",
          funnel_stage: "awareness",
          channel: "blog",
          why_now: "Multiple April workflow launches and engineering posts point to the same repository-context bottleneck.",
          playbook_alignment: [],
          sources: [
            {
              title: "GitHub details multi-agent workflows across repositories",
              source: "github.blog",
              url: "https://github.blog/engineering/platform-security/multi-agent-workflows-across-repositories",
              date: "2026-04-05",
            },
            {
              title: "How Meta mapped tribal knowledge before AI touched large-scale pipelines",
              source: "engineering.fb.com",
              url: "https://engineering.fb.com/2026/04/06/ai-tribal-knowledge",
              date: "2026-04-06",
            },
          ],
          core_claim: "Multi-agent coding workflows break when repo context, ownership, and downstream impact are not queryable before merge.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: [
            "Use Sourcegraph Code Search and Deep Search to recover cross-repo ownership and usage paths before agents edit code.",
            "Add Batch Changes plus verification before merge for controlled rollout.",
          ],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.9,
        },
      ],
    };

    const out = postProcessContentIdeasOutput(payload);
    expect(out.ideas).toHaveLength(2);
    expect(out.ideas[0].title).toBe(
      "Brief: What Multi-Agent Coding Workflows Need From Repository Context",
    );
    expect(out.ideas[0].editorial_rubric?.evidence_breadth).toBeGreaterThan(
      out.ideas[1].editorial_rubric?.evidence_breadth ?? 0,
    );
    expect(out.ideas[0].editorial_rubric?.lead_source_authority).toBeGreaterThan(
      out.ideas[1].editorial_rubric?.lead_source_authority ?? 0,
    );
    expect(out.ideas[0].editorial_rubric?.sourcegraph_ownability).toBeGreaterThan(
      out.ideas[1].editorial_rubric?.sourcegraph_ownability ?? 0,
    );
    expect(out.ideas[1].editorial_rubric?.format_fit).toBeLessThan(0.5);
  });

  it("uses portfolio-aware ordering so the top short-window slate is not one narrative cluster", () => {
    const payload: ContentIdeasOutput = {
      generated_at: "2026-04-06",
      playbook_version: "2026.02.15.1",
      periodDays: 14,
      ideas: [
        {
          title: "Brief: How Teams Add Quality Gates to AI Code Review",
          thesis: "Teams are adding approval workflows and review standards to AI-assisted code review.",
          target_segment: "Other",
          target_persona: "VP Engineering",
          funnel_stage: "awareness",
          channel: "blog",
          why_now: "A recent launch made governed AI code review visible again.",
          playbook_alignment: [],
          sources: [
            {
              title: "Enterprise coding assistant adds audit controls",
              source: "vendor.example",
              url: "https://vendor.example/audit-controls",
              date: "2026-04-06",
            },
            {
              title: "Platform teams define review standards for AI code changes",
              source: "thenewstack.io",
              url: "https://thenewstack.io/review-standards",
              date: "2026-04-05",
            },
          ],
          core_claim: "Governed AI coding requires review standards before merge.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["Use Sourcegraph verification before merge."],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.93,
        },
        {
          title: "Webinar: Turning AI Code Changes Into Audit-Ready Workflows",
          thesis: "Security and platform leaders need auditability around AI-generated changes.",
          target_segment: "Other",
          target_persona: "VP Engineering",
          funnel_stage: "validation",
          channel: "webinar",
          why_now: "Governance requirements are rising.",
          playbook_alignment: [],
          sources: [
            {
              title: "Vendor adds policy controls",
              source: "vendor-two.example",
              url: "https://vendor-two.example/policy-controls",
              date: "2026-04-06",
            },
            {
              title: "Analyst note on AI coding governance",
              source: "infoq.com",
              url: "https://infoq.com/governance-note",
              date: "2026-04-05",
            },
          ],
          core_claim: "Auditability is the gating factor for AI code review at scale.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["Frame Sourcegraph as the verification layer."],
          distribution_plan: {
            primary_format: "Live webinar",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.91,
        },
        {
          title: "Brief: Cross-Repo Upgrade and Migration Workflows",
          thesis: "Cross-repo migrations surface dependency and rollback risk that assistants cannot safely infer from one file at a time.",
          target_segment: "Other",
          target_persona: "Head of Developer Platform",
          funnel_stage: "expansion",
          channel: "blog",
          why_now: "Fresh migration stories show that rollout sequencing and verification are still the hard parts.",
          playbook_alignment: [],
          sources: [
            {
              title: "Large-scale codemod rollout with verification",
              source: "moderne.ai",
              url: "https://moderne.ai/codemod-rollout",
              date: "2026-04-06",
            },
            {
              title: "Engineering team details rollback-safe dependency migration",
              source: "engineering.example",
              url: "https://engineering.example/dependency-migration",
              date: "2026-04-04",
            },
          ],
          core_claim: "Cross-repo migration success depends on dependency visibility, rollout control, and verification before merge.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: [
            "Use Code Search for dependency mapping and Batch Changes for controlled rollout.",
          ],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.86,
        },
      ],
    };

    const out = postProcessContentIdeasOutput(payload);
    expect(out.ideas).toHaveLength(3);
    expect(out.ideas.slice(0, 2).map((idea) => idea.title)).toEqual([
      "Brief: Cross-Repo Upgrade and Migration Workflows",
      "Brief: How Teams Add Quality Gates to AI Code Review",
    ]);
    expect(out.ideas.map((idea) => idea.title)).toContain(
      "Webinar: Turning AI Code Changes Into Audit-Ready Workflows",
    );
  });

  it("penalizes low-authority lead sources even when the idea is otherwise corroborated", () => {
    const payload: ContentIdeasOutput = {
      generated_at: "2026-04-07",
      playbook_version: "2026.02.15.1",
      periodDays: 14,
      ideas: [
        {
          title: "Brief: Repo Context Fails First in Enterprise Agent Rollouts",
          thesis: "A mandate plus parallel-agent tooling exposes repository-boundary failures first.",
          target_segment: "Other",
          target_persona: "Head of Developer Platform",
          funnel_stage: "awareness",
          channel: "blog",
          why_now: "A low-authority business-summary site amplified the mandate story this week.",
          playbook_alignment: [],
          sources: [
            {
              title: "JPMorgan ties engineer reviews to AI use for 65,000 staff",
              source: "letsdatascience.com",
              url: "https://letsdatascience.com/jpmorgan-ai-adoption",
              date: "2026-04-07",
            },
            {
              title: "Meta maps tribal knowledge before AI touches large-scale pipelines",
              source: "engineering.fb.com",
              url: "https://engineering.fb.com/2026/04/06/ai-tribal-knowledge",
              date: "2026-04-06",
            },
          ],
          core_claim: "Repo boundaries and ownership gaps break enterprise agents before code quality does.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: [
            "Use Sourcegraph Code Search and Deep Search to recover ownership and dependency paths before agents act.",
          ],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.93,
        },
        {
          title: "Brief: Repository Context Failures in Parallel Agent Workflows",
          thesis: "Parallel-agent tooling and engineering practice now point to the same repository-context bottleneck.",
          target_segment: "Other",
          target_persona: "Head of Developer Platform",
          funnel_stage: "awareness",
          channel: "blog",
          why_now: "GitHub and Meta both surfaced fresh evidence for repo-boundary failures this week.",
          playbook_alignment: [],
          sources: [
            {
              title: "GitHub details multi-agent workflows across repositories",
              source: "github.blog",
              url: "https://github.blog/engineering/platform-security/multi-agent-workflows-across-repositories",
              date: "2026-04-05",
            },
            {
              title: "Meta maps tribal knowledge before AI touches large-scale pipelines",
              source: "engineering.fb.com",
              url: "https://engineering.fb.com/2026/04/06/ai-tribal-knowledge",
              date: "2026-04-06",
            },
          ],
          core_claim: "Parallel agents need repository context and dependency visibility before merge.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: [
            "Use Sourcegraph Code Search and Deep Search to recover ownership and dependency paths before agents act.",
          ],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.91,
        },
      ],
    };

    const out = postProcessContentIdeasOutput(payload);
    expect(out.ideas).toHaveLength(1);
    expect(out.ideas[0].title).toBe("Brief: Repository Context Failures in Parallel Agent Workflows");
    expect(out.ideas[0].editorial_rubric?.lead_source_authority).toBeGreaterThan(0.7);
  });

  it("keeps single-source short-window ideas out of the top three when corroborated alternatives exist", () => {
    const payload: ContentIdeasOutput = {
      generated_at: "2026-04-07",
      playbook_version: "2026.02.15.1",
      periodDays: 14,
      ideas: [
        {
          title: "Guide: AI Code Review Needs Quality Gates",
          thesis: "A funded competitor frames quality gates as the next enterprise requirement.",
          target_segment: "Other",
          target_persona: "VP Engineering",
          funnel_stage: "awareness",
          channel: "whitepaper",
          why_now: "A single April announcement made quality gates visible.",
          playbook_alignment: [],
          sources: [
            {
              title: "CodeRabbit raises $60 million in Series B to build quality gates for AI coding",
              source: "coderabbit.ai",
              url: "https://coderabbit.ai/blog/series-b",
              date: "2026-04-06",
            },
          ],
          core_claim: "AI code review needs gates before merge.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "medium_opportunity",
          sourcegraph_integration_play: ["Position Sourcegraph as the verification layer behind AI code review."],
          distribution_plan: {
            primary_format: "Analyst-style whitepaper",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.98,
        },
        {
          title: "Brief: Multi-Agent Repo Boundaries Break First",
          thesis: "Parallel-agent tooling and real engineering practice now point to the same repo-boundary failure mode.",
          target_segment: "Other",
          target_persona: "Head of Developer Platform",
          funnel_stage: "awareness",
          channel: "blog",
          why_now: "GitHub and Meta surfaced fresh evidence this week.",
          playbook_alignment: [],
          sources: [
            {
              title: "GitHub details multi-agent workflows across repositories",
              source: "github.blog",
              url: "https://github.blog/engineering/platform-security/multi-agent-workflows-across-repositories",
              date: "2026-04-05",
            },
            {
              title: "Meta maps tribal knowledge before AI touches large-scale pipelines",
              source: "engineering.fb.com",
              url: "https://engineering.fb.com/2026/04/06/ai-tribal-knowledge",
              date: "2026-04-06",
            },
          ],
          core_claim: "Repo context beats prompt quality as the first constraint in enterprise agent workflows.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["Use Code Search and Deep Search to recover dependency and ownership paths before agents act."],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.9,
        },
        {
          title: "Brief: Cross-Repo Migration Workflows Need Verification",
          thesis: "Migration stories show that dependency visibility and rollback discipline are still the hard parts.",
          target_segment: "Other",
          target_persona: "Staff Engineer",
          funnel_stage: "business_case",
          channel: "blog",
          why_now: "Multiple migration stories landed this week.",
          playbook_alignment: [],
          sources: [
            {
              title: "Large-scale codemod rollout with verification",
              source: "moderne.ai",
              url: "https://moderne.ai/codemod-rollout",
              date: "2026-04-06",
            },
            {
              title: "Engineering team details rollback-safe dependency migration",
              source: "engineering.example",
              url: "https://engineering.example/dependency-migration",
              date: "2026-04-04",
            },
          ],
          core_claim: "Cross-repo migrations need dependency mapping and rollback-ready rollout control.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["Use Batch Changes plus Code Search for controlled rollout and verification."],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.89,
        },
        {
          title: "Brief: AI Onboarding Still Breaks on Tribal Knowledge",
          thesis: "Large-codebase onboarding remains a system-understanding problem even with AI assistance.",
          target_segment: "Other",
          target_persona: "Staff Engineer",
          funnel_stage: "expansion",
          channel: "blog",
          why_now: "Fresh engineering stories surfaced the same knowledge-mapping problem.",
          playbook_alignment: [],
          sources: [
            {
              title: "How Meta mapped tribal knowledge before AI touched large-scale pipelines",
              source: "engineering.fb.com",
              url: "https://engineering.fb.com/2026/04/06/ai-tribal-knowledge",
              date: "2026-04-06",
            },
            {
              title: "Internal developer platform teams revisit onboarding with AI",
              source: "thenewstack.io",
              url: "https://thenewstack.io/ai-onboarding-large-codebases",
              date: "2026-04-05",
            },
          ],
          core_claim: "System understanding is still the gating factor in large codebases.",
          key_insights: ["Insight"],
          content_outline: ["Outline"],
          proof_required: [],
          guardrails: [],
          integration_opportunity: "high_opportunity",
          sourcegraph_integration_play: ["Use Deep Search and code navigation to recover system understanding faster."],
          distribution_plan: {
            primary_format: "Blog post",
            recommended_venue: "site",
            channel_strategy: "x",
            setup_steps: [],
          },
          priority_score: 0.88,
        },
      ],
    };

    const out = postProcessContentIdeasOutput(payload);
    expect(out.ideas).toHaveLength(4);
    expect(out.ideas.slice(0, 3).every((idea) => idea.sources.length >= 2)).toBe(true);
    expect(out.ideas[3].title).toBe("Guide: AI Code Review Needs Quality Gates");
  });
});
