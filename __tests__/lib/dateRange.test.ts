/**
 * Tests for date range formatting (digest/newsletter/podcast titles)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  formatDateRangeLabel,
  getDateRangeForPeriodDays,
  formatDateLong,
  formatDateShort,
} from "../../src/lib/dateRange";

describe("dateRange", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2025-02-18T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  describe("formatDateLong", () => {
    it("formats date as Month Day, Year", () => {
      const d = new Date(2025, 1, 18); // month is 0-indexed
      expect(formatDateLong(d)).toBe("February 18, 2025");
    });
  });

  describe("formatDateShort", () => {
    it("formats date as Mon Day, Year", () => {
      const d = new Date(2025, 1, 18);
      expect(formatDateShort(d)).toBe("Feb 18, 2025");
    });
  });

  describe("getDateRangeForPeriodDays", () => {
    it("returns end as today and start as N days ago", () => {
      const range = getDateRangeForPeriodDays(7);
      expect(range.end).toBe("2025-02-18");
      expect(range.start).toBe("2025-02-11");
    });
  });

  describe("formatDateRangeLabel", () => {
    it("formats same day as single date", () => {
      expect(
        formatDateRangeLabel({ start: "2025-02-18", end: "2025-02-18" })
      ).toBe("February 18, 2025");
    });

    it("formats week range as Mon Day–Day, Year", () => {
      expect(
        formatDateRangeLabel(
          { start: "2025-02-10", end: "2025-02-17" },
          "week"
        )
      ).toMatch(/Feb.*10–17.*2025/);
    });

    it("formats single month as Month Year", () => {
      expect(
        formatDateRangeLabel(
          { start: "2025-02-01", end: "2025-02-28" },
          "month"
        )
      ).toBe("February 2025");
    });
  });
});
