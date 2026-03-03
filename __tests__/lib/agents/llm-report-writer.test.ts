import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/llm/completion", () => ({
  createChatCompletion: vi.fn(),
}));
vi.mock("../../../src/lib/llm/config", () => ({
  hasLLMConfigured: vi.fn(),
}));

import { createChatCompletion } from "../../../src/lib/llm/completion";
import { hasLLMConfigured } from "../../../src/lib/llm/config";
import {
  writeMarketBriefWithLLM,
  writeContentIdeasWithLLM,
  writeCompetitorIntelWithLLM,
} from "../../../src/lib/agents/llm-report-writer";
import type { MarketBriefOutput } from "../../../src/lib/agents/market-brief";
import type { ContentIdeasOutput } from "../../../src/lib/agents/content-ideas";
import type { RankedCompetitorIntelItem } from "../../../src/lib/agents/competitor-intel";

const mockCreate = vi.mocked(createChatCompletion);
const mockHasLLM = vi.mocked(hasLLMConfigured);

const minimalMarketBriefPayload: MarketBriefOutput = {
  brief_date: "2026-03-02",
  playbook_version: "2026-02-15",
  periodDays: 7,
  executive_delta: [
    {
      title: "MCP context layer adoption",
      summary: "Enterprise teams adopting MCP for code search.",
      segment_impact: ["Other"],
      persona_impact: ["VP Engineering"],
      playbook_alignment: "reinforces",
      affected_assumptions: ["MCP complements assistants"],
      why_it_matters: "Affects near-term GTM motion.",
      policy_basis: ["context_layer_message_priority"],
      evidence_basis: ["MCP context layer adoption"],
      recommended_action: { owner: "SE", action: "Incorporate into messaging this week." },
      integration_opportunity: "high_opportunity",
      sourcegraph_integration_play: ["Use Sourcegraph as the agent context layer."],
      evidence: [{ source: "example.com", url: "https://example.com/mcp", date: "2026-03-01", confidence: "high" }],
    },
  ],
  watch_items: [],
  invalidations_to_monitor: [],
  noisy_items_suppressed: [],
};

const minimalContentIdeasPayload: ContentIdeasOutput = {
  generated_at: "2026-03-02",
  playbook_version: "2026-02-15",
  periodDays: 7,
  ideas: [
    {
      title: "Blog: Evaluating AI coding benchmarks",
      thesis: "SWE-Bench Pro signals matter for tool selection.",
      target_segment: "Other",
      target_persona: "VP Engineering",
      funnel_stage: "awareness",
      channel: "blog",
      why_now: "Recent model releases.",
      playbook_alignment: [],
      sources: [{ title: "Post", source: "example.com", url: "https://example.com", date: "2026-03-01" }],
      core_claim: "Sourcegraph complements coding assistants.",
      key_insights: ["Blog post: How to evaluate AI coding assistants."],
      content_outline: ["Outline from source."],
      proof_required: [],
      guardrails: [],
      integration_opportunity: "high_opportunity",
      sourcegraph_integration_play: ["Use Sourcegraph as the agent context layer."],
      distribution_plan: {
        primary_format: "Blog post",
        recommended_venue: "Company blog",
        channel_strategy: "Blog as anchor.",
        setup_steps: ["Draft outline"],
      },
      priority_score: 0.8,
    },
  ],
};

const minimalCompetitorItems: RankedCompetitorIntelItem[] = [
  {
    competitor: "GitHub",
    date: "2026-03-01",
    date_confidence: "exact",
    title: "Copilot for CLI GA",
    source: "github.blog",
    source_type: "primary",
    url: "https://github.blog/copilot-cli",
    update_type: "product_launch",
    overlap_with_sourcegraph: ["code_search", "agent_context"],
    summary: "GitHub announced general availability of Copilot for CLI.",
    why_it_matters: "Expands Copilot surface into CLI workflows.",
    threat_level: "medium",
    confidence: "high",
    novelty_score: 0.9,
    relevance_score: 0.85,
    actionability: ["product", "messaging"],
    integration_opportunity: "high_opportunity",
    sourcegraph_integration_play: ["Expose Sourcegraph via MCP for agent context."],
    evidence_notes: ["Official blog post."],
    debug_scores: {},
  },
];

describe("llm-report-writer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockHasLLM.mockReturnValue(true);
  });

  describe("writeMarketBriefWithLLM", () => {
    it("returns null when LLM is not configured", async () => {
      mockHasLLM.mockReturnValue(false);
      const out = await writeMarketBriefWithLLM(minimalMarketBriefPayload, "Market Brief Agent Report");
      expect(out).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns null when createChatCompletion throws", async () => {
      mockCreate.mockRejectedValueOnce(new Error("API error"));
      const out = await writeMarketBriefWithLLM(minimalMarketBriefPayload, "Market Brief Agent Report");
      expect(out).toBeNull();
    });

    it("returns LLM markdown when createChatCompletion succeeds", async () => {
      const expectedMd = "# Market Brief Agent Report\n\nGenerated: 2026-03-02\n\n## Executive Delta\n\n### 1. MCP context layer adoption\n- Why it matters: Affects near-term GTM motion.";
      mockCreate.mockResolvedValueOnce({ content: expectedMd, model: "claude-sonnet-4-6" });
      const out = await writeMarketBriefWithLLM(minimalMarketBriefPayload, "Market Brief Agent Report");
      expect(out).toBe(expectedMd);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0][0];
      expect(call.messages.some((m) => m.role === "system" && m.content.includes("Executive Delta"))).toBe(true);
      expect(call.messages.some((m) => m.role === "user" && m.content.includes("MCP context layer adoption"))).toBe(true);
    });

    it("returns null when createChatCompletion returns empty content", async () => {
      mockCreate.mockResolvedValueOnce({ content: "", model: "gpt-4o-mini" });
      const out = await writeMarketBriefWithLLM(minimalMarketBriefPayload, "Market Brief Agent Report");
      expect(out).toBeNull();
    });
  });

  describe("writeContentIdeasWithLLM", () => {
    it("returns null when LLM is not configured", async () => {
      mockHasLLM.mockReturnValue(false);
      const out = await writeContentIdeasWithLLM(minimalContentIdeasPayload, "Content Ideas Agent Report");
      expect(out).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns LLM markdown when createChatCompletion succeeds", async () => {
      const expectedMd = "# Content Ideas Agent Report\n\n## Prioritized Ideas\n\n### 1. Blog: Evaluating AI coding benchmarks";
      mockCreate.mockResolvedValueOnce({ content: expectedMd, model: "claude-sonnet-4-6" });
      const out = await writeContentIdeasWithLLM(minimalContentIdeasPayload, "Content Ideas Agent Report");
      expect(out).toBe(expectedMd);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0][0];
      expect(call.messages.some((m) => m.role === "user" && m.content.includes("Prioritized Ideas"))).toBe(true);
      expect(call.messages.some((m) => m.role === "user" && m.content.includes("https://example.com"))).toBe(true);
      expect(call.messages.some((m) => m.role === "system" && m.content.includes("Do NOT split/remix"))).toBe(true);
    });
  });

  describe("writeCompetitorIntelWithLLM", () => {
    it("returns null when LLM is not configured", async () => {
      mockHasLLM.mockReturnValue(false);
      const out = await writeCompetitorIntelWithLLM(
        minimalCompetitorItems,
        7,
        "Competitor Intel Agent Report",
        "2026-03-02T12:00:00.000Z"
      );
      expect(out).toBeNull();
      expect(mockCreate).not.toHaveBeenCalled();
    });

    it("returns LLM markdown when createChatCompletion succeeds", async () => {
      const expectedMd = "# Competitor Intel Agent Report\n\n## GitHub\n\n### 1. Copilot for CLI GA";
      mockCreate.mockResolvedValueOnce({ content: expectedMd, model: "claude-sonnet-4-6" });
      const out = await writeCompetitorIntelWithLLM(
        minimalCompetitorItems,
        7,
        "Competitor Intel Agent Report",
        "2026-03-02T12:00:00.000Z"
      );
      expect(out).toBe(expectedMd);
      expect(mockCreate).toHaveBeenCalledTimes(1);
      const call = mockCreate.mock.calls[0][0];
      expect(call.messages.some((m) => m.role === "user" && m.content.includes("Copilot for CLI GA"))).toBe(true);
    });
  });
});
