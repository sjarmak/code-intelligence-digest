import { describe, it, expect } from "vitest";
import { formatMarketBriefMarkdown, formatContentIdeasMarkdown } from "../../../src/lib/agents/format-structured-reports";

describe("format-structured-reports", () => {
  describe("period label", () => {
    it("includes Period: last N days in market brief when periodDays is set", () => {
      const md = formatMarketBriefMarkdown("Market Brief", {
        brief_date: "2026-03-01",
        playbook_version: "2026-02-15",
        periodDays: 14,
        executive_delta: [],
        watch_items: [],
        invalidations_to_monitor: [],
        noisy_items_suppressed: [],
      });
      expect(md).toContain("Period: last 14 days");
    });

    it("omits period line in market brief when periodDays is undefined", () => {
      const md = formatMarketBriefMarkdown("Market Brief", {
        brief_date: "2026-03-01",
        playbook_version: "2026-02-15",
        executive_delta: [],
        watch_items: [],
        invalidations_to_monitor: [],
        noisy_items_suppressed: [],
      });
      expect(md).not.toContain("Period: last");
    });

    it("includes Period: last N days in content ideas when periodDays is set", () => {
      const md = formatContentIdeasMarkdown("Content Ideas", {
        generated_at: "2026-03-01",
        playbook_version: "2026-02-15",
        periodDays: 30,
        ideas: [],
      });
      expect(md).toContain("Period: last 30 days");
    });

    it("omits period line in content ideas when periodDays is undefined", () => {
      const md = formatContentIdeasMarkdown("Content Ideas", {
        generated_at: "2026-03-01",
        playbook_version: "2026-02-15",
        ideas: [],
      });
      expect(md).not.toContain("Period: last");
    });
  });
});
