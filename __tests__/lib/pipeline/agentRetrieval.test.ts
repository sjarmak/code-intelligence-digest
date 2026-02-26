/**
 * Tests for agent retrieval merge and helpers
 */

import { describe, it, expect } from "vitest";
import { mergeRetrievedDocs } from "../../../src/lib/pipeline/agentRetrieval";
import type { RetrievedDoc } from "../../../src/lib/pipeline/agentRetrieval";

function doc(overrides: Partial<RetrievedDoc>): RetrievedDoc {
  return {
    source: "postgres_items",
    title: "Test",
    metadata: {},
    ...overrides,
  };
}

describe("agentRetrieval", () => {
  describe("mergeRetrievedDocs", () => {
    it("deduplicates by id", () => {
      const postgres = [
        doc({ id: "a", title: "First", source: "postgres_items" }),
      ];
      const web = [
        doc({ id: "b", title: "Web", source: "web", url: "https://example.com/1" }),
      ];
      const merged = mergeRetrievedDocs(postgres, web, "content_ideas");
      expect(merged.length).toBe(2);
    });

    it("deduplicates by URL", () => {
      const postgres = [
        doc({ id: "a", url: "https://example.com/same", title: "P", source: "postgres_items" }),
      ];
      const web = [
        doc({ url: "https://example.com/same", title: "W", source: "web" }),
      ];
      const merged = mergeRetrievedDocs(postgres, web, "market_brief");
      expect(merged.length).toBe(1);
    });

    it("marks primarySource in metadata", () => {
      const postgres = [doc({ id: "x", source: "postgres_items" })];
      const web: RetrievedDoc[] = [];
      const merged = mergeRetrievedDocs(postgres, web, "competitor_intel");
      expect(merged[0].metadata.primarySource).toBe("postgres");
    });

    it("respects per-source caps from config", () => {
      const postgres = Array.from({ length: 100 }, (_, i) =>
        doc({ id: `p-${i}`, source: "postgres_items" })
      );
      const web = Array.from({ length: 50 }, (_, i) =>
        doc({ source: "web", url: `https://example.com/w${i}`, title: `W${i}` })
      );
      const merged = mergeRetrievedDocs(postgres, web, "content_ideas");
      expect(merged.length).toBeLessThanOrEqual(50 + 50);
    });

    it("filters out blocked domains for content_ideas", () => {
      const postgres = [
        doc({ id: "ok", url: "https://example.com/article", title: "OK", source: "postgres_items" }),
        doc({ id: "ig", url: "https://www.instagram.com/p/abc", title: "IG", source: "postgres_items" }),
      ];
      const web: RetrievedDoc[] = [];
      const merged = mergeRetrievedDocs(postgres, web, "content_ideas");
      expect(merged.length).toBe(1);
      expect(merged[0].title).toBe("OK");
    });

    it("filters out excludeSelfDomains for competitor_intel", () => {
      const postgres = [
        doc({ id: "sg", url: "https://sourcegraph.com/blog/post", title: "Sourcegraph", source: "postgres_items" }),
        doc({ id: "other", url: "https://augmentcode.com/blog", title: "Augment", source: "postgres_items" }),
      ];
      const web: RetrievedDoc[] = [];
      const merged = mergeRetrievedDocs(postgres, web, "competitor_intel");
      expect(merged.length).toBe(1);
      expect(merged[0].title).toBe("Augment");
    });
  });
});
