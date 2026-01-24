/**
 * Tests for scoring utilities
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { computeRecencyScore } from "../../../src/lib/pipeline/scoring-utils";

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
