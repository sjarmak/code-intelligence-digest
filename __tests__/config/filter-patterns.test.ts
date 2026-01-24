/**
 * Tests for content filter patterns
 */

import { describe, it, expect } from "vitest";
import {
  BAD_URL_PATTERNS,
  BAD_TITLE_PATTERNS,
  BAD_URL_DOMAINS,
  filterLowQualityItem,
  type FilterResult,
} from "../../src/config/filter-patterns";
import type { FeedItem } from "../../src/lib/model";

/**
 * Helper to create a minimal FeedItem for testing
 */
function createTestItem(overrides: Partial<FeedItem>): FeedItem {
  return {
    id: "test-id",
    streamId: "test-stream",
    sourceTitle: "Test Source",
    title: "A valid test article title that is long enough",
    url: "https://example.com/valid-article",
    publishedAt: new Date(),
    categories: [],
    category: "tech_articles",
    raw: {},
    ...overrides,
  };
}

describe("BAD_TITLE_PATTERNS", () => {
  describe("positive examples (should match)", () => {
    const titlesToFilter = [
      // Promotional/advertising titles
      "advertise",
      "Advertise",
      "ADVERTISE",
      "sponsor",
      "Sponsor",
      "advertisement",
      "promotional content",
      "sponsored content",
      "sponsored",

      // Subscription/call-to-action titles
      "subscribe",
      "Subscribe",
      "join",
      "sign up",
      "subscribe to",
      "Subscribe to our newsletter",
      "join our",
      "Join our community",
      "sign up for",
      "Sign up for updates",

      // Generic placeholder/empty titles
      "untitled",
      "Untitled",
      "no title",
      "n/a",
      "N/A",
      "null",
      "click here",
      "Click Here",
      "read more",
      "learn more",
      "view",
      "link",
    ];

    it.each(titlesToFilter)(
      "should match bad title pattern: '%s'",
      (title) => {
        const matched = BAD_TITLE_PATTERNS.some((pattern) =>
          pattern.test(title)
        );
        expect(matched).toBe(true);
      }
    );
  });

  describe("negative examples (should NOT match)", () => {
    const validTitles = [
      // Legitimate article titles
      "How to Build a Newsletter System",
      "The Sponsor's Guide to Open Source",
      "Why You Should Subscribe to Code Reviews",
      "Joining Forces: Team Collaboration Tips",
      "10 Tips for Better Code Sign-off Procedures",
      "Understanding Advertisement Technology",
      "Untitled Memory: A Deep Dive into Memory Management",
      "Click-through Rates: A Data Science Perspective",
      "Learning More About Machine Learning",
      "The View from Engineering Leadership",
      "New Link Between AI and Productivity Found",
      "The Future of Software Development",
      "AI Code Assistants: A Comprehensive Review",
    ];

    it.each(validTitles)(
      "should NOT match valid title: '%s'",
      (title) => {
        const matched = BAD_TITLE_PATTERNS.some((pattern) =>
          pattern.test(title)
        );
        expect(matched).toBe(false);
      }
    );
  });
});

describe("BAD_URL_PATTERNS", () => {
  describe("positive examples (should match)", () => {
    const urlsToFilter = [
      // Newsletter collection/digest pages
      "https://example.com/newsletters",
      "https://example.com/newsletter/",
      "https://example.com/newsletters?page=2",
      "https://example.com/issues",
      "https://example.com/issue/",
      "https://example.com/archive",
      "https://example.com/archive/",

      // Meta/admin pages
      "https://example.com/advertise",
      "https://example.com/sponsor",
      "https://example.com/advertising",
      "https://example.com/partnership",
      "https://example.com/adservice",
      "https://example.com/privacy",
      "https://example.com/terms",
      "https://example.com/policies",
      "https://example.com/legal",
      "https://example.com/media-kit",
      "https://example.com/press",
      "https://example.com/about",
      "https://example.com/contact",
      "https://example.com/feeds",
      "https://example.com/rss",
      "https://example.com/subscribe",
      "https://example.com/signup",
      "https://example.com/login",

      // Account management pages
      "https://example.com/unsubscribe",
      "https://example.com/preferences",
      "https://example.com/settings",
      "https://example.com/manage",
      "https://example.com/opt-out",

      // Social aggregators
      "https://reddit.com/r/programming",
      "https://www.reddit.com/r/javascript",
      "https://reddit.com/user/someuser",
      "https://reddit.com/u/someuser",

      // Tracking/redirect URLs
      "https://linktrak.io/abc123",
      "https://click.linksynergy.com/redirect",
      "https://news.google.com/rss/articles/abc123",

      // Event pages (pattern requires dot before eventbrite.com, e.g. www.)
      "https://www.eventbrite.com/e/some-event",
      "https://www.eventbrite.com/",

      // Known digest domains
      "https://csharpdigest.com/issues/123",
      "https://leadershipintech.com/newsletter",
      "https://reactdigest.com/",
      "https://programmingdigest.net/issues",
    ];

    it.each(urlsToFilter)(
      "should match bad URL pattern: '%s'",
      (url) => {
        const matched = BAD_URL_PATTERNS.some((pattern) => pattern.test(url));
        expect(matched).toBe(true);
      }
    );
  });

  describe("negative examples (should NOT match)", () => {
    const validUrls = [
      // Legitimate article URLs
      "https://blog.example.com/2024/01/ai-code-assistants",
      "https://techblog.com/article/machine-learning-tutorial",
      "https://dev.to/post/understanding-async-await",
      "https://medium.com/@author/react-best-practices",
      "https://substack.com/p/my-great-article",
      "https://news.ycombinator.com/item?id=12345",

      // URLs that contain pattern words but as part of article paths
      "https://example.com/blog/why-advertise-on-podcasts",
      "https://example.com/articles/the-privacy-debate",
      "https://example.com/posts/newsletter-best-practices",
      "https://example.com/2024/subscribe-to-events-api",

    ];

    it.each(validUrls)(
      "should NOT match valid URL: '%s'",
      (url) => {
        const matched = BAD_URL_PATTERNS.some((pattern) => pattern.test(url));
        expect(matched).toBe(false);
      }
    );
  });
});

describe("BAD_URL_DOMAINS", () => {
  describe("positive examples (should match)", () => {
    const badDomains = [
      "csharpdigest.com",
      "leadershipintech.com",
      "reactdigest.com",
      "programmingdigest.net",
      "newsletter-digest",
      "bonobopress.com",
    ];

    it("should contain all expected bad domains", () => {
      for (const domain of badDomains) {
        expect(BAD_URL_DOMAINS).toContain(domain);
      }
    });

    it("should have the expected number of domains", () => {
      expect(BAD_URL_DOMAINS.length).toBe(6);
    });
  });

  describe("domain matching in URLs", () => {
    it("should match URLs containing bad domains", () => {
      const badUrls = [
        "https://csharpdigest.com/issues/123",
        "https://www.leadershipintech.com/article",
        "https://reactdigest.com",
        "https://programmingdigest.net/newsletter",
        "https://bonobopress.com/post/something",
      ];

      for (const url of badUrls) {
        const matched = BAD_URL_DOMAINS.some((domain) =>
          url.toLowerCase().includes(domain.toLowerCase())
        );
        expect(matched).toBe(true);
      }
    });
  });
});

describe("filterLowQualityItem", () => {
  describe("title length filtering", () => {
    it("should filter items with null title", () => {
      const item = createTestItem({ title: null as unknown as string });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title too short");
    });

    it("should filter items with empty title", () => {
      const item = createTestItem({ title: "" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title too short");
    });

    it("should filter items with title shorter than 10 chars", () => {
      const item = createTestItem({ title: "Short" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title too short");
      expect(result.reason).toContain("5 < 10");
    });

    it("should filter items with whitespace-only title", () => {
      const item = createTestItem({ title: "         " });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title too short");
    });

    it("should pass items with exactly 10 char title", () => {
      const item = createTestItem({ title: "1234567890" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(false);
    });

    it("should pass items with longer titles", () => {
      const item = createTestItem({
        title: "This is a valid article title about programming",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(false);
    });
  });

  describe("title pattern filtering", () => {
    it("should filter items with promotional titles", () => {
      // Use "advertisement" (13 chars) to pass length check first
      const item = createTestItem({ title: "advertisement" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title matches bad pattern");
    });

    it("should filter items with subscription CTA titles", () => {
      const item = createTestItem({ title: "Subscribe to our newsletter" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title matches bad pattern");
    });

    it("should filter items with placeholder titles", () => {
      const item = createTestItem({ title: "Click Here" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title matches bad pattern");
    });

    it("should pass items with titles containing pattern words as substrings", () => {
      const item = createTestItem({
        title: "How to Build an Advertisement Platform",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(false);
    });
  });

  describe("URL pattern filtering", () => {
    it("should filter items with newsletter collection URLs", () => {
      const item = createTestItem({ url: "https://example.com/newsletters" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("URL matches bad pattern");
    });

    it("should filter items with admin page URLs", () => {
      const item = createTestItem({ url: "https://example.com/privacy" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("URL matches bad pattern");
    });

    it("should filter items with Reddit URLs", () => {
      const item = createTestItem({
        url: "https://reddit.com/r/programming/comments/abc",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("URL matches bad pattern");
    });

    it("should filter items with tracking URLs", () => {
      const item = createTestItem({ url: "https://linktrak.io/track/abc123" });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("URL matches bad pattern");
    });

    it("should pass items with valid article URLs", () => {
      const item = createTestItem({
        url: "https://techblog.com/articles/understanding-ai-code-assistants",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(false);
    });

    it("should pass items with null URL", () => {
      const item = createTestItem({ url: null as unknown as string });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(false);
    });
  });

  describe("URL domain filtering", () => {
    it("should filter items from bad domains", () => {
      // Use bonobopress.com which doesn't match URL patterns, only domain list
      const item = createTestItem({
        url: "https://bonobopress.com/article/123",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("URL contains bad domain");
    });

    it("should filter items from bad domains case-insensitively", () => {
      // Use BONOBOPRESS.COM which doesn't match URL patterns, only domain list
      const item = createTestItem({
        url: "https://BONOBOPRESS.COM/article/something",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("URL contains bad domain");
    });
  });

  describe("filter order and early return", () => {
    it("should return title length error before checking patterns", () => {
      const item = createTestItem({
        title: "Ad", // Too short, but also matches "advertise" pattern start
        url: "https://example.com/newsletters",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title too short");
    });

    it("should return title pattern error before URL errors", () => {
      // Use "advertisement" (13 chars) to pass length check first
      const item = createTestItem({
        title: "advertisement",
        url: "https://example.com/newsletters",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("Title matches bad pattern");
    });

    it("should return URL pattern error before domain errors", () => {
      // csharpdigest.com also matches pattern for digest domains
      // The URL pattern should be checked first
      const item = createTestItem({
        url: "https://example.com/newsletters",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
      expect(result.reason).toContain("URL matches bad pattern");
    });
  });

  describe("end-to-end filtering", () => {
    it("should pass a fully valid item", () => {
      const item = createTestItem({
        title: "Understanding AI Code Assistants: A Deep Dive",
        url: "https://techblog.com/articles/ai-code-assistants",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(false);
      expect(result.reason).toBeUndefined();
    });

    it("should filter a newsletter index page", () => {
      const item = createTestItem({
        title: "Weekly Newsletter Archive",
        url: "https://newsletter.example.com/archive",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
    });

    it("should filter a promotional page", () => {
      const item = createTestItem({
        title: "Sponsor",
        url: "https://example.com/sponsor-us",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
    });

    it("should filter items from aggregator domains", () => {
      const item = createTestItem({
        title: "C# Weekly Issue #123",
        url: "https://csharpdigest.com/issues/123",
      });
      const result = filterLowQualityItem(item);
      expect(result.filtered).toBe(true);
    });
  });

  describe("FilterResult interface", () => {
    it("should return correct FilterResult structure for filtered item", () => {
      const item = createTestItem({ title: "Short" });
      const result: FilterResult = filterLowQualityItem(item);
      expect(result).toHaveProperty("filtered", true);
      expect(result).toHaveProperty("reason");
      expect(typeof result.reason).toBe("string");
    });

    it("should return correct FilterResult structure for passed item", () => {
      const item = createTestItem({
        title: "A valid article title about technology",
        url: "https://example.com/valid-article",
      });
      const result: FilterResult = filterLowQualityItem(item);
      expect(result).toHaveProperty("filtered", false);
      expect(result.reason).toBeUndefined();
    });
  });
});
