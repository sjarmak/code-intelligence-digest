/**
 * Tests for agent goal configuration
 */

import { describe, it, expect } from "vitest";
import {
  getAgentGoalConfig,
  getAgentGoals,
  AGENT_GOAL_CONFIGS,
  type AgentGoal,
} from "../../src/config/agents";

describe("agents config", () => {
  it("should have config for every agent goal", () => {
    const goals = getAgentGoals();
    expect(goals).toContain("content_ideas");
    expect(goals).toContain("market_brief");
    expect(goals).toContain("competitor_intel");
    expect(goals.length).toBe(3);
  });

  it("getAgentGoalConfig returns config for valid goal", () => {
    const config = getAgentGoalConfig("content_ideas");
    expect(config.name).toBe("Content Ideas");
    expect(config.primaryCategories.length).toBeGreaterThan(0);
    expect(config.retrievalStrategies.maxPostgresDocs).toBeGreaterThan(0);
    expect(config.retrievalStrategies.maxWebDocs).toBeGreaterThan(0);
    expect(config.rankingProfile.baseScoreWeight).toBeGreaterThanOrEqual(0);
    expect(config.postgresQueryTerms.length).toBeGreaterThan(0);
    expect(config.webQueryTemplates.length).toBeGreaterThan(0);
  });

  it("content_ideas config emphasizes format and ICP", () => {
    const config = AGENT_GOAL_CONFIGS.content_ideas;
    expect(config.rankingProfile.formatTypeWeight).toBeGreaterThan(config.rankingProfile.competitorMatchWeight);
    expect(config.rankingProfile.icpMatchWeight).toBeGreaterThan(config.rankingProfile.competitorMatchWeight);
    // bd-l4b tightened source quality: terms are coding-workflow signals, not content formats
    expect(config.postgresQueryTerms.some((t) => t.toLowerCase().includes("code search"))).toBe(true);
  });

  it("market_brief config has trend/landscape weight", () => {
    const config = AGENT_GOAL_CONFIGS.market_brief;
    expect(config.rankingProfile.trendLandscapeWeight).toBeDefined();
    expect(config.timeHorizonDays).toBe(14);
  });

  it("competitor_intel config emphasizes competitor match", () => {
    const config = AGENT_GOAL_CONFIGS.competitor_intel;
    expect(config.rankingProfile.competitorMatchWeight).toBeGreaterThan(config.rankingProfile.formatTypeWeight);
  });
});
