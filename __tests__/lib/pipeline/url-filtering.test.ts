/**
 * Test URL filtering in newsletter decomposition
 */

import { describe, it, expect } from "vitest";
import { decomposeNewsletterItem } from "../../../src/lib/pipeline/decompose.js";
import type { RankedItem } from "../../../src/lib/model.js";

function createMockNewsletterItem(
  title: string,
  htmlContent: string
): RankedItem {
  return {
    id: "test-item",
    streamId: "test",
    sourceTitle: "Programming Digest",
    title,
    url: "https://inoreader.com/test",
    author: "Test",
    publishedAt: new Date(),
    summary: htmlContent,
    contentSnippet: htmlContent.substring(0, 200),
    categories: ["tech_articles"],
    category: "tech_articles",
    raw: htmlContent,
    fullText: htmlContent,
    bm25Score: 0.5,
    llmScore: { tags: ["code-search"], relevance: 5, usefulness: 5 },
    recencyScore: 0.8,
    engagementScore: 0.5,
    finalScore: 0.7,
    reasoning: "test",
  };
}

describe("URL filtering in newsletter decomposition", () => {
  it("should exclude newsletter collection pages", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://programmingdigest.net/newsletters">All Newsletters</a>
          <a href="https://programmingdigest.net/issues">Back Issues</a>
          <a href="https://programmingdigest.net/archive">Archive</a>
          <a href="https://example.com/article">Good Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    // Should only have the good article, not the collection pages
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/article");
    expect(decomposed[0].title).toContain("Good Article");
  });

  it("should exclude advertise/sponsor links", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://programmingdigest.net/advertise">Advertise</a>
          <a href="https://example.com/sponsor">Sponsor Us</a>
          <a href="https://example.com/advertising">Advertising Info</a>
          <a href="https://example.com/good-article">Good Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/good-article");
  });

  it("should exclude privacy/terms/unsubscribe links", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://example.com/privacy">Privacy Policy</a>
          <a href="https://example.com/terms">Terms of Service</a>
          <a href="https://example.com/unsubscribe">Unsubscribe</a>
          <a href="https://example.com/preferences">Manage Preferences</a>
          <a href="https://example.com/media-kit">Media Kit</a>
          <a href="https://example.com/article">Good Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/article");
  });

  it("should exclude RSS/subscribe/signup links", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://example.com/feed">RSS Feed</a>
          <a href="https://example.com/subscribe">Subscribe</a>
          <a href="https://example.com/signup">Sign Up</a>
          <a href="https://example.com/article">Good Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/article");
  });

  it("should exclude digest-specific index pages", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://csharpdigest.com/newsletters">C# Digest</a>
          <a href="https://leadershipintech.com/issues">Leadership Issues</a>
          <a href="https://reactdigest.com/archive">React Archive</a>
          <a href="https://example.com/real-article">Real Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/real-article");
  });

  it("should allow individual programming digest articles", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://programmingdigest.net/newsletters">All Issues</a>
          <a href="https://example.com/engineering-dogmas">Engineering Dogmas It's Time to Retire</a>
          <a href="https://another.com/article">Another Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    // Should have 2 articles (the two good ones, not the newsletter index)
    expect(decomposed).toHaveLength(2);
    const urls = decomposed.map(d => d.url).sort();
    expect(urls).toContain("https://example.com/engineering-dogmas");
    expect(urls).toContain("https://another.com/article");
  });

  it("should handle multiple good articles mixed with bad links", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://example.com/article-1">Article 1</a>
          <a href="https://programmingdigest.net/advertise">Advertise</a>
          <a href="https://example.com/article-2">Article 2</a>
          <a href="https://example.com/unsubscribe">Unsubscribe</a>
          <a href="https://example.com/article-3">Article 3</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    // Should have 3 articles, filtering out advertise and unsubscribe
    expect(decomposed).toHaveLength(3);
    const urls = decomposed.map(d => d.url).sort();
    expect(urls).toContain("https://example.com/article-1");
    expect(urls).toContain("https://example.com/article-2");
    expect(urls).toContain("https://example.com/article-3");
  });

  it("should exclude Reddit aggregator links that aren't article links", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://reddit.com/r/programming">r/programming subreddit</a>
          <a href="https://reddit.com/u/someuser">user page</a>
          <a href="https://example.com/good-article">Good Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    // Should only have the good article
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/good-article");
  });

  it("should exclude all digest domain collection pages regardless of path", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://csharpdigest.com/">C# Digest Home</a>
          <a href="https://csharpdigest.com/issues/123">C# Digest Issue 123</a>
          <a href="https://leadershipintech.com/">Leadership Index</a>
          <a href="https://reactdigest.com/latest">React Latest</a>
          <a href="https://example.com/real-article">Real Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    // Should only have the good article, all digest domain pages should be filtered
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/real-article");
  });

  it("should exclude advertise pages from digest domains", () => {
    const item = createMockNewsletterItem(
      "Weekly Digest",
      `
        <html>
          <a href="https://programmingdigest.net/advertise">Advertise with us</a>
          <a href="https://csharpdigest.com/sponsors">Sponsor</a>
          <a href="https://example.com/good-article">Good Article</a>
        </html>
      `
    );

    const decomposed = decomposeNewsletterItem(item);
    
    expect(decomposed).toHaveLength(1);
    expect(decomposed[0].url).toBe("https://example.com/good-article");
  });
});
