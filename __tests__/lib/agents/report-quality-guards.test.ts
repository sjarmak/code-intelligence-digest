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
});
