/**
 * Tests for the domain term configuration (src/config/domain-terms.ts)
 *
 * Regression guard for bd-2gp: the BM25 scorer (src/lib/pipeline/bm25.ts) is a
 * unigram lexical scorer that applies NO per-term weighting. The domain term
 * config must not advertise per-term or per-category weights that the scorer
 * silently ignores ("config lies about scorer behavior"). These tests lock in
 * that the weight fields stay removed.
 */

import { describe, it, expect } from "vitest";
import {
  DOMAIN_TERMS,
  DOMAIN_CATEGORIES,
  getTermsByCategory,
} from "../../src/config/domain-terms";

describe("domain-terms config", () => {
  it("defines terms with only term + category (no phantom weight)", () => {
    expect(DOMAIN_TERMS.length).toBeGreaterThan(0);
    for (const t of DOMAIN_TERMS) {
      expect(t).not.toHaveProperty("weight");
      expect(typeof t.term).toBe("string");
      expect(t.term.length).toBeGreaterThan(0);
      expect(typeof t.category).toBe("string");
    }
  });

  it("defines categories with description but no weight", () => {
    expect(DOMAIN_CATEGORIES.length).toBeGreaterThan(0);
    for (const c of DOMAIN_CATEGORIES) {
      expect(c).not.toHaveProperty("weight");
      expect(typeof c.category).toBe("string");
      expect(typeof c.description).toBe("string");
    }
  });

  it("groups terms by category as plain string lists, without weights", () => {
    const grouped = getTermsByCategory();
    const categories = Object.keys(grouped);
    expect(categories.length).toBeGreaterThan(0);
    for (const cat of categories) {
      const group = grouped[cat as keyof typeof grouped];
      expect(group).not.toHaveProperty("weight");
      expect(Array.isArray(group.terms)).toBe(true);
      expect(group.terms.every((t) => typeof t === "string")).toBe(true);
    }
  });
});
