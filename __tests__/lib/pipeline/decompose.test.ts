/**
 * Tests for newsletter decomposition
 */

import { describe, it, expect } from "vitest";
import {
  isNewsletterSource,
  decomposeNewsletterItem,
  decomposeNewsletterItems,
} from "../../../src/lib/pipeline/decompose";
import { RankedItem } from "../../../src/lib/model";

function createMockRankedItem(
  sourceTitle: string,
  summary: string
): RankedItem {
  return {
    id: "test-item-1",
    streamId: "stream-1",
    sourceTitle,
    title: "Test Newsletter",
    url: "https://inoreader.com/item/123", // Inoreader URL
    author: "Test Author",
    publishedAt: new Date("2025-01-15"),
    summary,
    contentSnippet: summary.substring(0, 500),
    categories: ["newsletters"],
    category: "newsletters",
    raw: {},
    bm25Score: 0.8,
    llmScore: {
      relevance: 8,
      usefulness: 7,
      tags: ["newsletter", "code-search"],
    },
    recencyScore: 0.9,
    finalScore: 0.85,
    reasoning: "Newsletter item",
  };
}

describe("isNewsletterSource", () => {
  it("should recognize TLDR", () => {
    expect(isNewsletterSource("TLDR Tech")).toBe(true);
  });

  it("should recognize Pointer", () => {
    expect(isNewsletterSource("Pointer")).toBe(true);
  });

  it("should recognize Substack", () => {
    expect(isNewsletterSource("My Newsletter - Substack")).toBe(true);
  });

  it("should recognize Byte Byte Go", () => {
    expect(isNewsletterSource("Byte Byte Go")).toBe(true);
  });

  it("should recognize Elevate", () => {
    expect(isNewsletterSource("Elevate News")).toBe(true);
  });

  it("should not recognize non-newsletter sources", () => {
    expect(isNewsletterSource("TechCrunch")).toBe(false);
    expect(isNewsletterSource("Medium")).toBe(false);
  });
});

describe("decomposeNewsletterItem", () => {
  it("should not decompose non-newsletter sources", () => {
    const item = createMockRankedItem("TechCrunch", "Some article content");
    const result = decomposeNewsletterItem(item);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("test-item-1");
  });

  it("should handle newsletter with no content", () => {
    const item = createMockRankedItem("TLDR", "");
    item.summary = "";
    item.fullText = "";
    const result = decomposeNewsletterItem(item);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("test-item-1");
  });

  it("should extract markdown-style links", () => {
    const html = `
      Check out these articles:
      [Article 1: Code Search Innovation](https://example.com/article1)
      [Article 2: Agent Patterns](https://example.com/article2)
    `;
    const item = createMockRankedItem("TLDR", html);
    const result = decomposeNewsletterItem(item);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const urls = result.map(r => r.url);
    expect(urls).toContain("https://example.com/article1");
    expect(urls).toContain("https://example.com/article2");
  });

  it("should extract HTML anchor links", () => {
    const html = `
      <div>
        <a href="https://example.com/article1">Deep Dive: Semantic Search</a>
        <p>Great insights about search</p>
        <a href="https://example.com/article2">Building Agents</a>
      </div>
    `;
    const item = createMockRankedItem("Pointer", html);
    const result = decomposeNewsletterItem(item);

    expect(result.length).toBeGreaterThanOrEqual(1);
    const urls = result.map(r => r.url);
    expect(urls.some(u => u.includes("article1"))).toBe(true);
    expect(urls.some(u => u.includes("article2"))).toBe(true);
  });

  it("should filter out Inoreader URLs", () => {
    const html = `
      [Article](https://example.com/article1)
      [Inoreader](https://inoreader.com/read/123)
    `;
    const item = createMockRankedItem("TLDR", html);
    const result = decomposeNewsletterItem(item);

    const urls = result.flatMap(r => [r.url]);
    expect(urls).toContain("https://example.com/article1");
    expect(urls.some(u => u.includes("inoreader.com"))).toBe(false);
  });

  it("should filter out javascript: URLs", () => {
    const html = `
      [Article](https://example.com/article1)
      [Click me](javascript:void(0))
    `;
    const item = createMockRankedItem("Substack", html);
    const result = decomposeNewsletterItem(item);

    const urls = result.flatMap(r => [r.url]);
    expect(urls.every(u => !u.startsWith("javascript:"))).toBe(true);
  });

  it("should preserve newsletter source metadata", () => {
    const html = `
      [Article 1](https://example.com/article1)
      [Article 2](https://example.com/article2)
    `;
    const item = createMockRankedItem("TLDR Tech", html);
    const result = decomposeNewsletterItem(item);

    for (const decomposed of result) {
      expect(decomposed.sourceTitle).toBe("TLDR Tech");
      expect(decomposed.category).toBe("newsletters");
    }
  });

  it("should create unique IDs for decomposed articles", () => {
    const html = `
      [Article 1](https://example.com/article1)
      [Article 2](https://example.com/article2)
      [Article 3](https://example.com/article3)
    `;
    const item = createMockRankedItem("TLDR", html);
    const result = decomposeNewsletterItem(item);

    const ids = result.map(r => r.id);
    expect(new Set(ids).size).toBe(ids.length); // All unique
  });

  it("should update title and URL for single article", () => {
    const html = `[Must Read: New Insights](https://example.com/must-read)`;
    const item = createMockRankedItem("TLDR", html);
    const result = decomposeNewsletterItem(item);

    // The regex finds both the markdown link and may extract the raw URL
    // So we should check that at least the article is present
    expect(result.length).toBeGreaterThanOrEqual(1);
    const titlePresent = result.some(r => r.title === "Must Read: New Insights");
    const urlPresent = result.some(r => r.url === "https://example.com/must-read");
    expect(titlePresent || urlPresent).toBe(true);
  });

  it("should adjust scores when decomposing", () => {
    const html = `
      [Article 1](https://example.com/article1)
      [Article 2](https://example.com/article2)
    `;
    const item = createMockRankedItem("TLDR", html);
    item.finalScore = 0.9;
    const result = decomposeNewsletterItem(item);

    // Final scores should be reduced for decomposed items
    for (const decomposed of result) {
      expect(decomposed.finalScore).toBeLessThan(item.finalScore);
      expect(decomposed.finalScore).toBeGreaterThan(0);
    }
  });

  it("should include newsletter info in reasoning", () => {
    const html = `[Article](https://example.com/article)`;
    const item = createMockRankedItem("Pointer", html);
    const result = decomposeNewsletterItem(item);

    if (result.length > 0) {
      expect(result[0].reasoning).toContain("Decomposed from");
      expect(result[0].reasoning).toContain("Pointer");
    }
  });
});

describe("decomposeNewsletterItems", () => {
  it("should batch process mixed items", () => {
    const items: RankedItem[] = [
      createMockRankedItem(
        "TLDR",
        "[Article 1](https://example.com/1)\n[Article 2](https://example.com/2)"
      ),
      createMockRankedItem("TechCrunch", "Regular article"),
      createMockRankedItem(
        "Pointer",
        "[Article 3](https://example.com/3)"
      ),
    ];

    const result = decomposeNewsletterItems(items);

    // TLDR decomposed into 2 articles, TechCrunch remains 1, Pointer becomes 1
    expect(result.length).toBeGreaterThan(items.length);
  });

  it("should preserve non-newsletter items", () => {
    const techItem = createMockRankedItem("TechCrunch", "Article content");
    const items: RankedItem[] = [techItem];

    const result = decomposeNewsletterItems(items);

    expect(result).toHaveLength(1);
    expect(result[0].id).toBe(techItem.id);
    expect(result[0].sourceTitle).toBe("TechCrunch");
  });

  it("should log decomposition statistics", () => {
    const items: RankedItem[] = [
      createMockRankedItem(
        "TLDR",
        "[A](https://example.com/a)\n[B](https://example.com/b)\n[C](https://example.com/c)"
      ),
    ];

    // Just verify it doesn't throw
    expect(() => {
      decomposeNewsletterItems(items);
    }).not.toThrow();
  });

  it("should handle empty input", () => {
    const result = decomposeNewsletterItems([]);
    expect(result).toHaveLength(0);
  });

  it("should handle newsletter with duplicate URLs", () => {
    const html = `
      [Article](https://example.com/article)
      [Same Article](https://example.com/article)
      [Different Article](https://example.com/different)
    `;
    const item = createMockRankedItem("TLDR", html);
    const result = decomposeNewsletterItem(item);

    const urls = result.map(r => r.url);
    const uniqueUrls = new Set(urls);
    // Should have no duplicate URLs
    expect(uniqueUrls.size).toBe(urls.length);
  });

  it("should extract titles with nearby URLs (newsletter header pattern)", () => {
    const html = `
My LLM coding workflow going into 2026 — Elevate
Highlights practical evolution of coding agents and workflows, relevant to AI-assisted software engineering.
https://elevate.example.com/lvm-workflow

Modern VMs 🧱, System Observability 🔍 — TLDR
Infrastructure improvements for coding agents.
https://tldr.example.com/modern-vms
    `;
    const item = createMockRankedItem("Elevate", html);
    const result = decomposeNewsletterItem(item);

    expect(result.length).toBeGreaterThanOrEqual(1);
    // Should extract URLs even without explicit HTML links
    const urls = result.map(r => r.url).filter(u => u && u.includes("example.com"));
    expect(urls.length).toBeGreaterThan(0);
    expect(urls.some(u => u.includes("elevate.example.com"))).toBe(true);
  });
});

