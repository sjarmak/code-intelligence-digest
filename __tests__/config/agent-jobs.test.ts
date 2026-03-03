/**
 * Tests for GTM agent job configuration
 */

import { describe, it, expect } from "vitest";
import {
  getJobConfig,
  getAgentConfig,
  getJobsForSchedule,
  AGENT_JOBS,
  AGENTS,
  type AgentId,
  type JobId,
  type AgentJobConfig,
} from "../../src/config/agent-jobs";

describe("agent-jobs", () => {
  it("returns job config for known agent and job", () => {
    const job = getJobConfig("competitive_intel" as AgentId, "daily_competitor_report" as JobId);
    expect(job).not.toBeNull();
    expect(job?.agentId).toBe("competitive_intel");
    expect(job?.jobId).toBe("daily_competitor_report");
    expect(job?.schedule).toBe("daily");
    expect(job?.scope.categories).toContain("product_news");
    expect(job?.scope.competitorsOnly).toBe(true);
    expect(job?.buildPrompt).toBeTypeOf("function");
  });

  it("returns null for unknown job", () => {
    expect(getJobConfig("competitive_intel" as AgentId, "unknown" as JobId)).toBeNull();
    expect(getJobConfig("unknown" as AgentId, "daily_competitor_report" as JobId)).toBeNull();
  });

  it("returns agent config with jobs", () => {
    const agent = getAgentConfig("gtm_content" as AgentId);
    expect(agent).not.toBeNull();
    expect(agent?.id).toBe("gtm_content");
    expect(agent?.name).toBe("GTM / Content");
    expect(agent?.jobs.length).toBeGreaterThan(0);
    expect(agent?.jobs.every((j: AgentJobConfig) => j.agentId === "gtm_content")).toBe(true);
  });

  it("getJobsForSchedule returns daily and weekly jobs", () => {
    const daily = getJobsForSchedule("daily");
    const weekly = getJobsForSchedule("weekly");
    expect(daily.length).toBeGreaterThan(0);
    expect(weekly.length).toBeGreaterThanOrEqual(0);
    expect(daily.every((j: AgentJobConfig) => j.schedule === "daily")).toBe(true);
    expect(weekly.every((j: AgentJobConfig) => j.schedule === "weekly")).toBe(true);
  });

  it("buildPrompt produces non-empty system and user for a job", () => {
    const job = getJobConfig("competitive_intel" as AgentId, "daily_competitor_report" as JobId);
    expect(job).not.toBeNull();
    const { system, user } = job!.buildPrompt("Sample context with [1] item.", "2025-02-23");
    expect(system.length).toBeGreaterThan(0);
    expect(user.length).toBeGreaterThan(0);
    expect(user).toContain("2025-02-23");
    expect(user).toContain("Sample context");
  });

  it("AGENT_JOBS and AGENTS are consistent", () => {
    const jobIds = new Set(AGENT_JOBS.map((j: AgentJobConfig) => `${j.agentId}/${j.jobId}`));
    for (const agent of AGENTS) {
      for (const job of agent.jobs) {
        expect(jobIds.has(`${job.agentId}/${job.jobId}`)).toBe(true);
      }
    }
  });

  it("daily content ideas job uses month window", () => {
    const job = getJobConfig("gtm_content" as AgentId, "daily_content_ideas" as JobId);
    expect(job).not.toBeNull();
    expect(job?.periodDays).toBe(30);
  });
});
