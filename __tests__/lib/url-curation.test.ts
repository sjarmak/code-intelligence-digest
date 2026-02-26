/**
 * Test URL curation: subscription/plan URL detection and resolution to article URLs
 */

import { describe, it, expect } from "vitest";
import {
  tryResolveToArticleUrl,
  isSubscriptionOrPlanUrl,
} from "../../src/lib/url-curation.js";

describe("url-curation", () => {
  describe("isSubscriptionOrPlanUrl", () => {
    it("returns true for pricing path", () => {
      expect(isSubscriptionOrPlanUrl("https://anthropic.com/pricing")).toBe(true);
      expect(isSubscriptionOrPlanUrl("https://example.com/plans")).toBe(true);
    });
    it("returns true for subscribe/signup paths", () => {
      expect(isSubscriptionOrPlanUrl("https://news.example.com/subscribe")).toBe(true);
      expect(isSubscriptionOrPlanUrl("https://example.com/signup")).toBe(true);
    });
    it("returns false for article-like URLs", () => {
      expect(isSubscriptionOrPlanUrl("https://anthropic.com/news/claude-sonnet-4")).toBe(false);
      expect(isSubscriptionOrPlanUrl("https://example.com/p/some-article")).toBe(false);
    });
    it("returns false for undefined or empty", () => {
      expect(isSubscriptionOrPlanUrl(undefined)).toBe(false);
      expect(isSubscriptionOrPlanUrl("")).toBe(false);
    });
  });

  describe("tryResolveToArticleUrl", () => {
    it("returns null for subscription/plan URL with no extractable article", () => {
      expect(tryResolveToArticleUrl("https://anthropic.com/pricing")).toBe(null);
      expect(tryResolveToArticleUrl("https://example.com/plans")).toBe(null);
      expect(
        tryResolveToArticleUrl("https://example.com/subscribe")
      ).toBe(null);
    });
    it("returns article URL when subscription URL has next param with article", () => {
      const sub =
        "https://example.com/subscribe?next=" +
        encodeURIComponent("https://example.com/p/real-article");
      expect(tryResolveToArticleUrl(sub)).toBe("https://example.com/p/real-article");
    });
    it("returns decoded URL for normal article URLs", () => {
      const url = "https://anthropic.com/news/claude-sonnet-4";
      expect(tryResolveToArticleUrl(url)).toBe(url);
    });
    it("returns null for non-http URL", () => {
      expect(tryResolveToArticleUrl("ftp://example.com/file")).toBe(null);
      expect(tryResolveToArticleUrl(undefined)).toBe(null);
    });
  });
});
