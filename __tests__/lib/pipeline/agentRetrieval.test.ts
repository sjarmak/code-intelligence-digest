/**
 * Tests for agent retrieval merge and helpers
 */

import { describe, it, expect } from "vitest";
import {
  mergeRetrievedDocs,
  effectivePublishedAtForFiltering,
} from "../../../src/lib/pipeline/agentRetrieval";
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

  describe("effectivePublishedAtForFiltering", () => {
    it("prefers inferred older date over fresher provider date", () => {
      const result = effectivePublishedAtForFiltering(
        doc({
          title: "GitHub - codemod/codemod",
          snippet: "Published 2026-03-06",
          publishedAt: new Date("2026-03-19T12:00:00.000Z"),
        }),
      );
      expect(result?.toISOString().slice(0, 10)).toBe("2026-03-06");
    });

    it("keeps provider date when inferred date is newer", () => {
      const result = effectivePublishedAtForFiltering(
        doc({
          title: "Update note",
          snippet: "Updated 2026-03-19",
          publishedAt: new Date("2026-03-12T00:00:00.000Z"),
        }),
      );
      expect(result?.toISOString()).toBe("2026-03-12T00:00:00.000Z");
    });

    it("ignores older dates mentioned only in content body", () => {
      const result = effectivePublishedAtForFiltering(
        doc({
          title: "Weekly product roundup",
          snippet: "Fresh release notes and launch summary.",
          content: "This post references the 2026-03-06 benchmark results for comparison.",
          publishedAt: new Date("2026-03-19T00:00:00.000Z"),
        }),
      );
      expect(result?.toISOString()).toBe("2026-03-19T00:00:00.000Z");
    });
  });
});
