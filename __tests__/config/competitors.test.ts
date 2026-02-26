/**
 * Tests for competitor and ecosystem configuration
 */

import { describe, it, expect } from "vitest";
import {
  COMPETITORS,
  COMPETITORS_BY_TYPE,
  getCompetitorKeywords,
  getCompetitorDomains,
  getCompetitorByName,
} from "../../src/config/competitors";

describe("competitors config", () => {
  it("should have direct and augmenting competitors", () => {
    expect(COMPETITORS_BY_TYPE.direct.length).toBeGreaterThan(0);
    expect(COMPETITORS_BY_TYPE.augmenting.length).toBeGreaterThan(0);
    expect(COMPETITORS.length).toBe(
      COMPETITORS_BY_TYPE.direct.length + COMPETITORS_BY_TYPE.augmenting.length
    );
  });

  it("getCompetitorKeywords returns non-empty deduplicated list", () => {
    const keywords = getCompetitorKeywords();
    expect(keywords.length).toBeGreaterThan(0);
    expect(new Set(keywords).size).toBe(keywords.length);
  });

  it("getCompetitorDomains returns list (may be empty for some entries)", () => {
    const domains = getCompetitorDomains();
    expect(Array.isArray(domains)).toBe(true);
    expect(new Set(domains).size).toBe(domains.length);
  });

  it("getCompetitorByName finds by name", () => {
    const c = getCompetitorByName("Cursor");
    expect(c).toBeDefined();
    expect(c?.type).toBe("augmenting");
    expect(c?.keywords.some((k) => k.includes("Cursor"))).toBe(true);
  });

  it("direct competitors include Augment and Moderne", () => {
    const names = COMPETITORS_BY_TYPE.direct.map((c) => c.name);
    expect(names).toContain("Augment Code");
    expect(names).toContain("Moderne");
  });
});
