/**
 * Regression test for the degradation context wrap in the agent job runner
 * (src/lib/agents/run-job.ts, bd-sgo).
 *
 * runAgentJobImpl must establish a withDegradationTracking context so that
 * recordDegradation calls made transitively during a run (completion fallback,
 * pseudo-embeddings, missing web context, neutral scores) are captured and
 * persistAgentRun can attach the summary to agent_runs metadata. Without the
 * wrap every record is a no-op and the summary is null — so we drive a run,
 * record a degradation from inside the retrieval step, and assert it lands in
 * the metadata passed to saveAgentRun.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../../src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
vi.mock("../../../src/lib/db/agent-runs", () => ({
  saveAgentRun: vi.fn().mockResolvedValue("run-123"),
}));
vi.mock("../../../src/lib/agents/competitor-intel", () => ({
  gatherCompetitorIntelWithTrace: vi.fn(),
}));
vi.mock("../../../src/lib/agents/llm-report-writer", () => ({
  writeCompetitorIntelWithLLM: vi.fn().mockResolvedValue("# Report"),
  writeContentIdeasWithLLM: vi.fn().mockResolvedValue("# Ideas"),
  writeMarketBriefWithLLM: vi.fn().mockResolvedValue("# Brief"),
}));

import { runAgentJob } from "../../../src/lib/agents/run-job";
import { saveAgentRun } from "../../../src/lib/db/agent-runs";
import { gatherCompetitorIntelWithTrace } from "../../../src/lib/agents/competitor-intel";
import type { CompetitorIntelOutput } from "../../../src/lib/agents/competitor-intel";
import { recordDegradation } from "../../../src/lib/observability/degradation";
import { AGENT_PAYLOAD_SCHEMA_VERSION } from "../../../src/lib/agents/payload-schema";

const mockSave = vi.mocked(saveAgentRun);
const mockGather = vi.mocked(gatherCompetitorIntelWithTrace);

function competitorPayload(): CompetitorIntelOutput {
  return {
    schemaVersion: AGENT_PAYLOAD_SCHEMA_VERSION,
    generatedAt: "2026-06-15T00:00:00Z",
    periodDays: 90,
    topPerCompetitor: 7,
    topOverall: 0,
    items: [],
  };
}

/** The metadata object passed as the 5th arg of the most recent saveAgentRun. */
function lastSavedMetadata(): Record<string, unknown> {
  const call = mockSave.mock.calls.at(-1);
  if (!call) throw new Error("saveAgentRun was not called");
  return call[4] as Record<string, unknown>;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockSave.mockResolvedValue("run-123");
});

describe("runAgentJob degradation wrap", () => {
  it("attaches a degradation summary to agent_runs metadata when a fallback occurs mid-run", async () => {
    // Simulate a silent degradation during retrieval (e.g. no web-search
    // provider configured) by recording from inside the gather step — exactly
    // where the real recordDegradation calls fire.
    mockGather.mockImplementation(async () => {
      recordDegradation("web_search_missing");
      recordDegradation("neutral_score", 3);
      return competitorPayload();
    });

    await runAgentJob("competitive_intel", "weekly_competitor_summary");

    const metadata = lastSavedMetadata();
    const degradation = metadata.degradation as Record<string, unknown>;
    expect(degradation).toBeDefined();
    expect(degradation.degraded).toBe(true);
    expect(degradation.webSearchMissing).toBe(1);
    expect(degradation.neutralScore).toBe(3);
    expect(degradation.total).toBe(4);
  });

  it("omits the degradation field from metadata for a clean run", async () => {
    mockGather.mockResolvedValue(competitorPayload());

    await runAgentJob("competitive_intel", "weekly_competitor_summary");

    const metadata = lastSavedMetadata();
    expect(metadata.degradation).toBeUndefined();
  });
});
