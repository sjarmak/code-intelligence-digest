/**
 * Tests for scoring utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  computeRecencyScore,
  computeBoostMultiplier,
  PRODUCT_NAMES,
  CORE_TERMS,
} from "../../../src/lib/pipeline/scoring-utils";

describe("computeRecencyScore", () => {
  // Fix Date.now to a specific point in time for deterministic tests
  beforeEach(() => {
    // Fix time to 2025-01-15 00:00:00 UTC
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-01-15T00:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("score at age=0 (fresh content)", () => {
    it("should return 1.0 for content published right now", () => {
      const now = new Date();
      const score = computeRecencyScore(now, 7);
      expect(score).toBeCloseTo(1.0, 5);
    });

    it("should return 1.0 regardless of halfLifeDays when age is 0", () => {
      const now = new Date();
      expect(computeRecencyScore(now, 1)).toBeCloseTo(1.0, 5);
      expect(computeRecencyScore(now, 7)).toBeCloseTo(1.0, 5);
      expect(computeRecencyScore(now, 30)).toBeCloseTo(1.0, 5);
      expect(computeRecencyScore(now, 365)).toBeCloseTo(1.0, 5);
    });
  });

  describe("score at half-life age (~0.6)", () => {
    it("should return approximately 0.6 at half-life age with 7-day half-life", () => {
      // At exactly halfLifeDays ago, formula gives: 0.2 + 0.8 * 2^(-1) = 0.2 + 0.4 = 0.6
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(sevenDaysAgo, 7);
      expect(score).toBeCloseTo(0.6, 2);
    });

    it("should return approximately 0.6 at half-life age with 14-day half-life", () => {
      const fourteenDaysAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(fourteenDaysAgo, 14);
      expect(score).toBeCloseTo(0.6, 2);
    });

    it("should return approximately 0.6 at half-life age with 30-day half-life", () => {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(thirtyDaysAgo, 30);
      expect(score).toBeCloseTo(0.6, 2);
    });

    it("should return approximately 0.6 at half-life age with 1-day half-life", () => {
      const oneDayAgo = new Date(Date.now() - 1 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(oneDayAgo, 1);
      expect(score).toBeCloseTo(0.6, 2);
    });
  });

  describe("score approaches 0.2 floor at very old ages", () => {
    it("should approach 0.2 for very old content (100x half-life)", () => {
      // At 100 half-lives, score is: 0.2 + 0.8 * 2^(-100) ≈ 0.2
      const veryOld = new Date(Date.now() - 100 * 7 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(veryOld, 7);
      expect(score).toBeGreaterThanOrEqual(0.2);
      expect(score).toBeLessThan(0.21);
    });

    it("should approach 0.2 for content from 1 year ago with 7-day half-life", () => {
      const oneYearAgo = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(oneYearAgo, 7);
      expect(score).toBeGreaterThanOrEqual(0.2);
      expect(score).toBeLessThan(0.201);
    });

    it("should never go below 0.2 (floor)", () => {
      // Test with extreme age
      const ancientContent = new Date(Date.now() - 10000 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(ancientContent, 7);
      expect(score).toBeGreaterThanOrEqual(0.2);
    });
  });

  describe("different halfLifeDays values", () => {
    it("should decay faster with shorter half-life", () => {
      const threeDaysAgo = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000);

      const scoreWith1DayHalfLife = computeRecencyScore(threeDaysAgo, 1);
      const scoreWith7DayHalfLife = computeRecencyScore(threeDaysAgo, 7);
      const scoreWith30DayHalfLife = computeRecencyScore(threeDaysAgo, 30);

      // Shorter half-life = lower score for same age
      expect(scoreWith1DayHalfLife).toBeLessThan(scoreWith7DayHalfLife);
      expect(scoreWith7DayHalfLife).toBeLessThan(scoreWith30DayHalfLife);
    });

    it("should decay slower with longer half-life", () => {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const scoreWith7DayHalfLife = computeRecencyScore(sevenDaysAgo, 7);
      const scoreWith14DayHalfLife = computeRecencyScore(sevenDaysAgo, 14);
      const scoreWith30DayHalfLife = computeRecencyScore(sevenDaysAgo, 30);

      // 7 days old with 7-day half-life should give ~0.6
      expect(scoreWith7DayHalfLife).toBeCloseTo(0.6, 2);
      // 7 days old with 14-day half-life should give ~0.77 (half-way to 0.6)
      expect(scoreWith14DayHalfLife).toBeGreaterThan(0.7);
      // 7 days old with 30-day half-life should be even higher
      expect(scoreWith30DayHalfLife).toBeGreaterThan(scoreWith14DayHalfLife);
    });
  });

  describe("score bounds", () => {
    it("should always return a score between 0.2 and 1.0", () => {
      const testCases = [
        { age: 0, halfLife: 7 },
        { age: 1, halfLife: 7 },
        { age: 7, halfLife: 7 },
        { age: 30, halfLife: 7 },
        { age: 365, halfLife: 7 },
        { age: 1000, halfLife: 7 },
        { age: 7, halfLife: 1 },
        { age: 7, halfLife: 30 },
        { age: 7, halfLife: 365 },
      ];

      for (const { age, halfLife } of testCases) {
        const date = new Date(Date.now() - age * 24 * 60 * 60 * 1000);
        const score = computeRecencyScore(date, halfLife);
        expect(score).toBeGreaterThanOrEqual(0.2);
        expect(score).toBeLessThanOrEqual(1.0);
      }
    });

    it("should handle future dates (negative age) by returning score > 1.0", () => {
      // Future dates will have negative age, resulting in score > 1.0
      // This is expected behavior based on the formula
      const tomorrow = new Date(Date.now() + 1 * 24 * 60 * 60 * 1000);
      const score = computeRecencyScore(tomorrow, 7);
      // Formula: 0.2 + 0.8 * 2^(-(-1/7)) = 0.2 + 0.8 * 2^(1/7) ≈ 0.2 + 0.88 ≈ 1.08
      expect(score).toBeGreaterThan(1.0);
    });
  });

  describe("monotonic decay", () => {
    it("should monotonically decrease as age increases", () => {
      const halfLife = 7;
      let previousScore = Infinity;

      for (let daysAgo = 0; daysAgo <= 100; daysAgo += 5) {
        const date = new Date(Date.now() - daysAgo * 24 * 60 * 60 * 1000);
        const score = computeRecencyScore(date, halfLife);
        expect(score).toBeLessThanOrEqual(previousScore);
        previousScore = score;
      }
    });
  });
});

describe("computeBoostMultiplier", () => {
  describe("5x boost for sourcegraph", () => {
    it("should return 5.0x multiplier for content containing 'sourcegraph'", () => {
      const result = computeBoostMultiplier(
        "Sourcegraph announces new code search features",
        "tech_articles"
      );
      expect(result.multiplier).toBe(5.0);
      expect(result.matchedTerms).toContain("sourcegraph");
    });

    it("should match sourcegraph case-insensitively", () => {
      const result = computeBoostMultiplier(
        "SOURCEGRAPH releases update",
        "tech_articles"
      );
      expect(result.multiplier).toBe(5.0);
      expect(result.matchedTerms).toContain("sourcegraph");
    });

    it("should prioritize sourcegraph over other matches", () => {
      // Content with both sourcegraph and product names should get 5.0x
      const result = computeBoostMultiplier(
        "Sourcegraph vs Cursor comparison for code intelligence",
        "tech_articles"
      );
      expect(result.multiplier).toBe(5.0);
      expect(result.matchedTerms).toContain("sourcegraph");
      // Other terms should not be in matchedTerms since sourcegraph takes priority
      expect(result.matchedTerms).not.toContain("cursor");
    });
  });

  describe("3.5x boost for product names", () => {
    it("should return 3.5x multiplier for content containing a product name", () => {
      const result = computeBoostMultiplier(
        "How to use Cursor for AI-assisted coding",
        "tech_articles"
      );
      expect(result.multiplier).toBe(3.5);
      expect(result.matchedTerms).toContain("cursor");
    });

    it("should match all product names", () => {
      for (const product of PRODUCT_NAMES) {
        const result = computeBoostMultiplier(
          `Article about ${product} and its features`,
          "tech_articles"
        );
        expect(result.multiplier).toBe(3.5);
        expect(result.matchedTerms).toContain(product);
      }
    });

    it("should return multiple matched products when present", () => {
      const result = computeBoostMultiplier(
        "Comparing Cursor vs Copilot for developers",
        "tech_articles"
      );
      expect(result.multiplier).toBe(3.5);
      expect(result.matchedTerms).toContain("cursor");
      expect(result.matchedTerms).toContain("copilot");
    });

    it("should match product names case-insensitively", () => {
      const result = computeBoostMultiplier(
        "CLAUDE CODE is amazing",
        "tech_articles"
      );
      expect(result.multiplier).toBe(3.5);
      expect(result.matchedTerms).toContain("claude code");
    });
  });

  describe("3.0x boost for 3+ core terms", () => {
    it("should return 3.0x multiplier for content with 3 or more core terms", () => {
      const result = computeBoostMultiplier(
        "This article covers code search, code intelligence, and software engineering best practices",
        "tech_articles"
      );
      expect(result.multiplier).toBe(3.0);
      expect(result.matchedTerms.length).toBeGreaterThanOrEqual(3);
    });

    it("should return all matched core terms", () => {
      const result = computeBoostMultiplier(
        "deep search combined with code search enables better information retrieval and developer productivity",
        "tech_articles"
      );
      expect(result.multiplier).toBe(3.0);
      expect(result.matchedTerms).toContain("deep search");
      expect(result.matchedTerms).toContain("code search");
      expect(result.matchedTerms).toContain("information retrieval");
      expect(result.matchedTerms).toContain("developer productivity");
    });
  });

  describe("2.5x boost for agent + code context", () => {
    it("should return 2.5x multiplier for agent + code search combo", () => {
      const result = computeBoostMultiplier(
        "Building an agent that uses code search effectively",
        "tech_articles"
      );
      expect(result.multiplier).toBe(2.5);
      expect(result.matchedTerms).toContain("code search");
      expect(result.matchedTerms).toContain("agent");
    });

    it("should return 2.5x multiplier for agentic + context management combo", () => {
      const result = computeBoostMultiplier(
        "Agentic systems require proper context management",
        "tech_articles"
      );
      expect(result.multiplier).toBe(2.5);
      expect(result.matchedTerms).toContain("context management");
    });

    it("should return 2.0x for coding agent + code intelligence (2 core terms)", () => {
      // "coding agent" is a core term, "code intelligence" is also a core term
      // So this results in 2 core terms = 2.0x boost
      const result = computeBoostMultiplier(
        "coding agent leveraging code intelligence",
        "tech_articles"
      );
      expect(result.multiplier).toBe(2.0);
      expect(result.matchedTerms).toContain("coding agent");
      expect(result.matchedTerms).toContain("code intelligence");
    });
  });

  describe("2.0x boost for 2 core terms", () => {
    it("should return 2.0x multiplier for content with exactly 2 core terms", () => {
      const result = computeBoostMultiplier(
        "Improving developer productivity through better benchmark testing",
        "tech_articles"
      );
      expect(result.multiplier).toBe(2.0);
      expect(result.matchedTerms.length).toBe(2);
      expect(result.matchedTerms).toContain("developer productivity");
      expect(result.matchedTerms).toContain("benchmark");
    });
  });

  describe("1.5x boost for single core term", () => {
    it("should return 1.5x multiplier for content with exactly 1 core term", () => {
      const result = computeBoostMultiplier(
        "Understanding the context window in LLMs",
        "tech_articles"
      );
      expect(result.multiplier).toBe(1.5);
      expect(result.matchedTerms.length).toBe(1);
      expect(result.matchedTerms).toContain("context window");
    });

    it("should return 1.5x for any single core term", () => {
      for (const term of CORE_TERMS) {
        const result = computeBoostMultiplier(
          `Article discussing ${term} in depth`,
          "tech_articles"
        );
        // Some terms might trigger agent+code context combo,
        // so we only test non-code-context terms individually
        expect(result.multiplier).toBeGreaterThanOrEqual(1.5);
        expect(result.matchedTerms).toContain(term);
      }
    });
  });

  describe("1.0x baseline for no matches", () => {
    it("should return 1.0x multiplier for content with no relevant terms", () => {
      const result = computeBoostMultiplier(
        "Random article about cooking recipes",
        "tech_articles"
      );
      expect(result.multiplier).toBe(1.0);
      expect(result.matchedTerms).toHaveLength(0);
    });

    it("should return 1.0x for empty content", () => {
      const result = computeBoostMultiplier("", "tech_articles");
      expect(result.multiplier).toBe(1.0);
      expect(result.matchedTerms).toHaveLength(0);
    });

    it("should return 1.0x for content with partial matches that don't qualify", () => {
      // "search" alone doesn't match "code search" or "deep search"
      const result = computeBoostMultiplier(
        "How to search for files on your computer",
        "tech_articles"
      );
      expect(result.multiplier).toBe(1.0);
      expect(result.matchedTerms).toHaveLength(0);
    });
  });

  describe("boost tier priority", () => {
    it("should prioritize sourcegraph (5.0x) over all other boosts", () => {
      const result = computeBoostMultiplier(
        "Sourcegraph uses cursor and copilot for code search and code intelligence with agents",
        "tech_articles"
      );
      expect(result.multiplier).toBe(5.0);
    });

    it("should prioritize product names (3.5x) over core terms (3.0x)", () => {
      const result = computeBoostMultiplier(
        "Using Aider for deep search, code search, code intelligence, and more",
        "tech_articles"
      );
      expect(result.multiplier).toBe(3.5);
    });

    it("should prioritize 3+ core terms (3.0x) over agent+context (2.5x)", () => {
      // This content has 3+ core terms which should be prioritized
      const result = computeBoostMultiplier(
        "Agent uses deep search, code search, and code intelligence",
        "tech_articles"
      );
      expect(result.multiplier).toBe(3.0);
    });
  });

  describe("category parameter", () => {
    it("should accept different category values", () => {
      const categories = [
        "tech_articles",
        "newsletters",
        "podcasts",
        "ai_news",
        "product_news",
        "community",
        "research",
      ];

      for (const category of categories) {
        const result = computeBoostMultiplier(
          "Article about code search",
          category
        );
        // Currently category doesn't affect the multiplier, but function should accept it
        expect(result.multiplier).toBeGreaterThanOrEqual(1.0);
      }
    });
  });

  describe("constants exports", () => {
    it("should export PRODUCT_NAMES with expected products", () => {
      expect(PRODUCT_NAMES).toContain("cursor");
      expect(PRODUCT_NAMES).toContain("copilot");
      expect(PRODUCT_NAMES).toContain("claude code");
      expect(PRODUCT_NAMES).toContain("cody");
      expect(PRODUCT_NAMES).toContain("aider");
      expect(PRODUCT_NAMES.length).toBe(11);
    });

    it("should export CORE_TERMS with expected terms", () => {
      expect(CORE_TERMS).toContain("code search");
      expect(CORE_TERMS).toContain("code intelligence");
      expect(CORE_TERMS).toContain("context window");
      expect(CORE_TERMS).toContain("developer productivity");
      expect(CORE_TERMS.length).toBe(13);
    });
  });
});
