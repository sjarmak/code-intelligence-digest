/**
 * Tests for the versioned agent prompt store (bd-53z): version selection
 * (active / explicit pin / env override), error paths, and the live registry.
 */

import { describe, it, expect, afterEach } from "vitest";
import {
  resolveAgentPrompt,
  selectPromptVersion,
  listPromptVersions,
  getActivePromptVersion,
  type AgentPromptId,
  type PromptVersion,
} from "../../../src/lib/agents/prompt-store";

const PROMPT_IDS: AgentPromptId[] = [
  "market_brief_system",
  "content_ideas_system",
  "competitor_intel_system",
  "daily_competitor_report_system",
  "weekly_competitor_summary_system",
  "daily_icp_brief_system",
  "daily_content_ideas_system",
];

const ENV_KEYS = PROMPT_IDS.map((id) => `AGENT_PROMPT_VERSION__${id.toUpperCase()}`);

afterEach(() => {
  for (const key of ENV_KEYS) delete process.env[key];
});

describe("selectPromptVersion (pure selection)", () => {
  const versions: PromptVersion[] = [
    { version: 1, system: "v1" },
    { version: 3, system: "v3" },
    { version: 2, system: "v2" },
  ];

  it("returns the highest version when none is requested (active default)", () => {
    expect(selectPromptVersion(versions).version).toBe(3);
    expect(selectPromptVersion(versions).system).toBe("v3");
  });

  it("returns the exact requested version (rollback / A-B pin)", () => {
    expect(selectPromptVersion(versions, 1).system).toBe("v1");
    expect(selectPromptVersion(versions, 2).system).toBe("v2");
  });

  it("throws on a requested version that is not registered", () => {
    expect(() => selectPromptVersion(versions, 99)).toThrow(/version 99 not found/i);
    expect(() => selectPromptVersion(versions, 99)).toThrow(/1, 3, 2/);
  });

  it("throws when there are no versions", () => {
    expect(() => selectPromptVersion([])).toThrow(/no versions registered/i);
  });
});

describe("resolveAgentPrompt (live registry)", () => {
  it("resolves every registered prompt to a non-empty system + active version", () => {
    for (const id of PROMPT_IDS) {
      const resolved = resolveAgentPrompt(id);
      expect(resolved.promptId).toBe(id);
      expect(resolved.version).toBe(getActivePromptVersion(id));
      expect(resolved.system.length).toBeGreaterThan(0);
    }
  });

  it("resolved prompts contain their distinguishing section anchors", () => {
    expect(resolveAgentPrompt("market_brief_system").system).toContain("## Executive Delta");
    expect(resolveAgentPrompt("market_brief_system").system).toContain('Do NOT mention "Cody"');
    expect(resolveAgentPrompt("content_ideas_system").system).toContain("## Prioritized Ideas");
    expect(resolveAgentPrompt("competitor_intel_system").system).toContain(
      "Group items by competitor"
    );
    expect(resolveAgentPrompt("daily_competitor_report_system").system).toContain(
      "retrieval and triage analyst"
    );
    expect(resolveAgentPrompt("weekly_competitor_summary_system").system).toContain(
      "analyst for leadership"
    );
    expect(resolveAgentPrompt("daily_icp_brief_system").system).toContain("ICP and market analyst");
    expect(resolveAgentPrompt("daily_content_ideas_system").system).toContain("content strategist");
  });

  it("honors an explicit version pin and surfaces a missing one as an error", () => {
    const active = getActivePromptVersion("market_brief_system");
    expect(resolveAgentPrompt("market_brief_system", { version: active }).version).toBe(active);
    expect(() => resolveAgentPrompt("market_brief_system", { version: 9999 })).toThrow(
      /version 9999 not found/i
    );
  });

  it("throws on an unknown prompt id reached via a cast", () => {
    expect(() => resolveAgentPrompt("nope" as AgentPromptId)).toThrow(/unknown agent prompt id/i);
  });
});

describe("resolveAgentPrompt env override", () => {
  it("selects the env-pinned version when valid", () => {
    const active = getActivePromptVersion("competitor_intel_system");
    process.env.AGENT_PROMPT_VERSION__COMPETITOR_INTEL_SYSTEM = String(active);
    const resolved = resolveAgentPrompt("competitor_intel_system");
    expect(resolved.version).toBe(active);
  });

  it("throws when the env pin names a version that does not exist", () => {
    process.env.AGENT_PROMPT_VERSION__CONTENT_IDEAS_SYSTEM = "9999";
    expect(() => resolveAgentPrompt("content_ideas_system")).toThrow(/version 9999 not found/i);
  });

  it("throws on a malformed env value rather than silently using the active version", () => {
    process.env.AGENT_PROMPT_VERSION__MARKET_BRIEF_SYSTEM = "latest";
    expect(() => resolveAgentPrompt("market_brief_system")).toThrow(
      /expected a positive integer version id/i
    );
  });

  it("an explicit version arg takes precedence over the env override", () => {
    const active = getActivePromptVersion("market_brief_system");
    process.env.AGENT_PROMPT_VERSION__MARKET_BRIEF_SYSTEM = "9999"; // would throw if consulted
    expect(resolveAgentPrompt("market_brief_system", { version: active }).version).toBe(active);
  });
});

describe("listPromptVersions / getActivePromptVersion", () => {
  it("lists at least one version per prompt and the active is the maximum", () => {
    for (const id of PROMPT_IDS) {
      const versions = listPromptVersions(id);
      expect(versions.length).toBeGreaterThan(0);
      const max = Math.max(...versions.map((v) => v.version));
      expect(getActivePromptVersion(id)).toBe(max);
    }
  });
});
