/**
 * Tests for prompt profile extraction
 */

import { describe, it, expect } from "vitest";
import { buildPromptProfile } from "../../../src/lib/pipeline/promptProfile";

describe("promptProfile", () => {
  it("should return null for empty prompt", async () => {
    const result = await buildPromptProfile("");
    expect(result).toBeNull();
  });

  it("should return null for whitespace-only prompt", async () => {
    const result = await buildPromptProfile("   ");
    expect(result).toBeNull();
  });

  it("should extract focus topics from deterministic parsing", async () => {
    const result = await buildPromptProfile("Focus on code search and agents");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.focusTopics).toContain("code search");
      expect(result.focusTopics).toContain("agents");
    }
  });

  it("should detect audience from prompt", async () => {
    const result = await buildPromptProfile("Content for senior engineers");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.audience).toBe("senior engineers");
    }
  });

  it("should detect intent from prompt", async () => {
    const result = await buildPromptProfile("Provide a deep dive into context management");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.intent).toBe("deep-dive");
    }
  });

  it("should detect voice style", async () => {
    const result = await buildPromptProfile("Create a conversational episode");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.voiceStyle).toBe("conversational");
    }
  });

  it("should extract exclusion topics", async () => {
    const result = await buildPromptProfile("Cover all topics except avoid theory");
    expect(result).not.toBeNull();
    if (result) {
      expect(result.excludeTopics).toBeDefined();
      expect(result.excludeTopics).toContain("theory");
    }
  });

  it("should deduplicate focus topics", async () => {
    const result = await buildPromptProfile("Code search code search agents agents");
    expect(result).not.toBeNull();
    if (result) {
      const codeSearchCount = result.focusTopics.filter(t => t === "code search").length;
      expect(codeSearchCount).toBe(1);
    }
  });

  it("should handle complex prompts", async () => {
    const prompt = "Create a technical deep dive for senior engineers about code search and context management. Focus on actionable insights, avoid theory.";
    const result = await buildPromptProfile(prompt);
    expect(result).not.toBeNull();
    if (result) {
      expect(result.audience).toBeDefined();
      expect(result.intent).toBeDefined();
      expect(result.focusTopics.length).toBeGreaterThan(0);
      expect(result.formatHints).toBeDefined();
    }
  });

  it("should return object with focusTopics array always", async () => {
    const result = await buildPromptProfile("Random text with no domain terms");
    expect(result).not.toBeNull();
    if (result) {
      expect(Array.isArray(result.focusTopics)).toBe(true);
    }
  });
});
