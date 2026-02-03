/**
 * Tests for TLDR Marketing routing into the marketing category
 */

import { describe, it, expect } from "vitest";
import { decomposeFeedItem } from "../../../src/lib/pipeline/decompose";
import { FeedItem } from "../../../src/lib/model";

function createBaseTldrNewsletter(overrides: Partial<FeedItem> = {}): FeedItem {
  return {
    id: "tldr-marketing-1",
    streamId: "stream-tldr",
    sourceTitle: "TLDR",
    title: "TLDR Newsletter",
    url: "https://tldr.tech/newsletter",
    author: "TLDR",
    publishedAt: new Date("2025-01-15"),
    createdAt: new Date("2025-01-15"),
    summary: "",
    contentSnippet: "",
    categories: ["newsletters"],
    category: "newsletters",
    raw: {},
    fullText: undefined,
    ...overrides,
  };
}

describe("AI Dev recategorization from newsletters", () => {
  it("routes TLDR articles about AI coding into ai_dev category", () => {
    const html = `
      [AI Pair Programming Best Practices](https://example.com/ai-pair-programming)
      [Cursor tips for productivity](https://example.com/cursor-tips)
    `;

    const item = createBaseTldrNewsletter({
      sourceTitle: "TLDR Dev",
      summary: html,
      contentSnippet: html,
      fullText: html,
    });

    const result = decomposeFeedItem(item);

    expect(result.length).toBeGreaterThan(0);
    const aiDevArticles = result.filter((a) => a.category === "ai_dev");
    expect(aiDevArticles.length).toBeGreaterThan(0);
  });

  it("keeps non-AI newsletter articles in newsletters category", () => {
    const html = `
      [Introduction to Kubernetes](https://example.com/k8s)
      [Database indexing explained](https://example.com/db-indexing)
    `;

    const item = createBaseTldrNewsletter({
      sourceTitle: "TLDR Dev",
      summary: html,
      contentSnippet: html,
      fullText: html,
    });

    const result = decomposeFeedItem(item);

    expect(result.length).toBeGreaterThan(0);
    const newsletterArticles = result.filter((a) => a.category === "newsletters");
    expect(newsletterArticles.length).toBeGreaterThan(0);
  });
});

describe("TLDR Marketing routing", () => {
  it("routes TLDR Marketing articles with utm_source=tldrmarketing into marketing category", () => {
    const html = `
      [Great Marketing Article](https://example.com/article?utm_source=tldrmarketing&utm_medium=email)
    `;

    const item = createBaseTldrNewsletter({
      sourceTitle: "TLDR",
      summary: html,
      contentSnippet: html,
      fullText: html,
    });

    const result = decomposeFeedItem(item);

    expect(result.length).toBeGreaterThan(0);
    for (const article of result) {
      expect(article.category).toBe("marketing");
    }
  });
});

