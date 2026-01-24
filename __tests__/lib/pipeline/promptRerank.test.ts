/**
 * Tests for prompt-based re-ranking
 */

import { describe, it, expect } from "vitest";
import { rerankWithPrompt, filterByExclusions } from "../../../src/lib/pipeline/promptRerank";
import { RankedItem } from "../../../src/lib/model";
import { PromptProfile } from "../../../src/lib/pipeline/promptProfile";

describe("promptRerank", () => {
  const createMockItem = (id: string, title: string, tags: string[]): RankedItem => ({
    id,
    streamId: `stream-${id}`,
    sourceTitle: "Test Source",
    title,
    url: `https://example.com/${id}`,
    publishedAt: new Date(),
    summary: "Test summary",
    category: "tech_articles",
    categories: ["tech_articles"],
    raw: {},
    bm25Score: 0.5,
    llmScore: {
      relevance: 5,
      usefulness: 5,
      tags,
    },
    recencyScore: 0.8,
    finalScore: 0.6,
    reasoning: "Test reasoning",
  });

  describe("rerankWithPrompt", () => {
    it("should not modify items if profile is null", () => {
      const items = [createMockItem("1", "Article 1", ["code-search"])];
      const result = rerankWithPrompt(items, null as unknown as PromptProfile);
      expect(result).toEqual(items);
    });

    it("should not modify items if focusTopics is empty", () => {
      const items = [createMockItem("1", "Article 1", ["code-search"])];
      const profile: PromptProfile = { focusTopics: [] };
      const result = rerankWithPrompt(items, profile);
      expect(result).toEqual(items);
    });

    it("should boost items with matching tags", () => {
      const items = [
        createMockItem("1", "Article about code search", ["code-search"]),
        createMockItem("2", "Article about agents", ["agents"]),
      ];
      const profile: PromptProfile = { focusTopics: ["code-search"] };
      const result = rerankWithPrompt(items, profile);

      // First item should have higher score
      expect(result[0].id).toBe("1");
      expect(result[0].finalScore).toBeGreaterThan(items[0].finalScore);
    });

    it("should boost items with matching terms in title", () => {
      const items = [
        createMockItem("1", "Understanding Code Search with Embeddings", ["ir"]),
        createMockItem("2", "Building Better APIs", ["api"]),
      ];
      const profile: PromptProfile = { focusTopics: ["code search", "embeddings"] };
      const result = rerankWithPrompt(items, profile);

      expect(result[0].id).toBe("1");
    });

    it("should re-sort items by adjusted score", () => {
      const items = [
        createMockItem("1", "Random article", ["misc"]),
        createMockItem("2", "Code Search Deep Dive", ["code-search"]),
      ];
      const profile: PromptProfile = { focusTopics: ["code-search"] };
      const result = rerankWithPrompt(items, profile);

      // Item 2 should be first after re-ranking
      expect(result[0].id).toBe("2");
    });

    it("should preserve baseline ranking dominance", () => {
      const highScoreItem = createMockItem("1", "Unrelated article", ["misc"]);
      highScoreItem.finalScore = 0.99;

      const lowScoreItem = createMockItem("2", "Code Search Article", ["code-search"]);
      lowScoreItem.finalScore = 0.1;

      const items = [lowScoreItem, highScoreItem];
      const profile: PromptProfile = { focusTopics: ["code-search"] };
      const result = rerankWithPrompt(items, profile);

      // High score item should still rank higher
      expect(result[0].id).toBe("1");
    });
  });

  describe("filterByExclusions", () => {
    it("should not filter if profile is null", () => {
      const items = [
        createMockItem("1", "Research article", ["research"]),
        createMockItem("2", "Code article", ["code"]),
      ];
      const result = filterByExclusions(items, null);
      expect(result).toEqual(items);
    });

    it("should not filter if excludeTopics is empty", () => {
      const items = [createMockItem("1", "Article", ["research"])];
      const profile: PromptProfile = { focusTopics: [], excludeTopics: [] };
      const result = filterByExclusions(items, profile);
      expect(result).toEqual(items);
    });

    it("should filter items by excluded topics", () => {
      const items = [
        createMockItem("1", "Research Paper on ML", ["research", "ml"]),
        createMockItem("2", "Code Search Tools", ["code-search"]),
      ];
      const profile: PromptProfile = {
        focusTopics: [],
        excludeTopics: ["research"],
      };
      const result = filterByExclusions(items, profile);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("2");
    });

    it("should filter by tag matches", () => {
      const items = [
        createMockItem("1", "Article", ["off-topic"]),
        createMockItem("2", "Article", ["on-topic"]),
      ];
      const profile: PromptProfile = {
        focusTopics: [],
        excludeTopics: ["off-topic"],
      };
      const result = filterByExclusions(items, profile);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("2");
    });

    it("should be case-insensitive", () => {
      const items = [
        createMockItem("1", "Theory Paper", ["THEORY"]),
        createMockItem("2", "Code Article", ["practice"]),
      ];
      const profile: PromptProfile = {
        focusTopics: [],
        excludeTopics: ["theory"],
      };
      const result = filterByExclusions(items, profile);

      expect(result.length).toBe(1);
      expect(result[0].id).toBe("2");
    });
  });
});
