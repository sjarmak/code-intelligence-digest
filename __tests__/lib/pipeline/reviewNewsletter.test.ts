/**
 * Tests for newsletter review and quality gate
 */

import { describe, it, expect } from "vitest";
import { reviewDigests } from "../../../src/lib/pipeline/reviewNewsletter.js";
import type { ItemDigest } from "../../../src/lib/pipeline/extract.js";

function createMockDigest(overrides?: Partial<ItemDigest>): ItemDigest {
  return {
    id: "test-digest",
    title: "Test Article",
    url: "https://example.com/article",
    sourceTitle: "Example Source",
    category: "research",
    topicTags: ["code-search", "agents"],
    gist: "This is a test gist about code search.",
    keyBullets: ["Point 1", "Point 2"],
    namedEntities: ["Entity1", "Entity2"],
    whyItMatters: "Important for code search systems.",
    sourceCredibility: "high",
    userRelevanceScore: 8,
    ...overrides,
  };
}

describe("Newsletter Review", () => {
  describe("URL validation", () => {
    it("should flag bad URLs from digest domains", () => {
      const digests = [
        createMockDigest({
          url: "https://csharpdigest.com/issues/123",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
      expect(result.digestsWithIssues.size).toBe(1);
      expect(result.issues[0]).toMatch(/Bad URL domain/);
    });

    it("should flag advertise pages", () => {
      const digests = [
        createMockDigest({
          url: "https://example.com/advertise",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toMatch(/Bad URL/);
    });

    it("should flag sponsor pages", () => {
      const digests = [
        createMockDigest({
          url: "https://leadershipintech.com/sponsor",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
    });

    it("should allow good URLs", () => {
      const digests = [
        createMockDigest({
          url: "https://example.com/real-article",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.digestsWithIssues.has("test-digest")).toBe(false);
    });
  });

  describe("AI language detection", () => {
    it("should flag 'highlights' in gist", () => {
      const digests = [
        createMockDigest({
          gist: "This article highlights the importance of code search.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toMatch(/highlights/i);
    });

    it("should flag 'shapes' in whyItMatters", () => {
      const digests = [
        createMockDigest({
          whyItMatters: "This shapes how we think about agents.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toMatch(/shapes/i);
    });

    it("should flag 'fosters' in whyItMatters", () => {
      const digests = [
        createMockDigest({
          whyItMatters: "This approach fosters better code search practices.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
    });

    it("should flag 'landscape' in content", () => {
      const digests = [
        createMockDigest({
          whyItMatters: "Important for understanding the AI landscape.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
    });

    it("should flag 'emerging' as AI vocabulary", () => {
      const digests = [
        createMockDigest({
          gist: "Emerging approaches to code search are important.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
    });

    it("should pass content without AI vocabulary", () => {
      const digests = [
        createMockDigest({
          gist: "Google released a new code search tool that scales to 100M+ LOC.",
          whyItMatters: "Solves the problem of searching large codebases efficiently.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.digestsWithIssues.has("test-digest")).toBe(false);
    });
  });

  describe("Sourcegraph bias detection", () => {
    it("should flag excessive Sourcegraph mentions", () => {
      const digests = [
        createMockDigest({
          whyItMatters:
            "Sourcegraph can benefit from this. Sourcegraph team should evaluate. Sourcegraph's position.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toMatch(/Sourcegraph/);
    });

    it("should allow one or two Sourcegraph mentions", () => {
      const digests = [
        createMockDigest({
          whyItMatters: "Relevant for Sourcegraph's code search product.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.digestsWithIssues.has("test-digest")).toBe(false);
    });

    it("should flag heavy keyword stuffing", () => {
      const digests = [
        createMockDigest({
          whyItMatters:
            "Code search and context management with information retrieval. Agents use code search. Context management for agents. Information retrieval is key.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
      expect(result.issues[0]).toMatch(/keyword/i);
    });

    it("should flag generic corporate advice", () => {
      const digests = [
        createMockDigest({
          whyItMatters: "Teams should evaluate this approach to code search.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
    });
  });

  describe("Multiple digests", () => {
    it("should review all digests and track which ones have issues", () => {
      const digests = [
        createMockDigest({ id: "good-1", url: "https://example.com/good" }),
        createMockDigest({ id: "bad-1", url: "https://csharpdigest.com/index" }),
        createMockDigest({
          id: "bad-2",
          gist: "This highlights the importance of searching code.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
      expect(result.digestsWithIssues.size).toBe(2);
      expect(result.digestsWithIssues.has("good-1")).toBe(false);
      expect(result.digestsWithIssues.has("bad-1")).toBe(true);
      expect(result.digestsWithIssues.has("bad-2")).toBe(true);
    });

    it("should pass when all digests are clean", () => {
      const digests = [
        createMockDigest({
          id: "clean-1",
          url: "https://example.com/a",
          gist: "Google released LLM-based code search for 100M LOC repositories.",
        }),
        createMockDigest({
          id: "clean-2",
          url: "https://research.org/paper",
          whyItMatters: "Proves that semantic search reduces query time by 80%.",
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(true);
      expect(result.digestsWithIssues.size).toBe(0);
    });
  });

  describe("KeyBullets validation", () => {
    it("should flag AI language in key bullets", () => {
      const digests = [
        createMockDigest({
          keyBullets: ["Point that highlights importance", "Another point"],
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.passed).toBe(false);
    });

    it("should allow concrete bullets", () => {
      const digests = [
        createMockDigest({
          keyBullets: ["Scales to 100M LOC with <50ms latency", "Uses semantic indexing"],
        }),
      ];

      const result = reviewDigests(digests);

      expect(result.digestsWithIssues.has("test-digest")).toBe(false);
    });
  });
});
