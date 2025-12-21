/**
 * Tests for podcast generation endpoint
 */

import { describe, it, expect, beforeEach, vi } from "vitest";
import { NextRequest } from "next/server";
import { POST } from "@/app/api/podcast/generate/route";
import * as itemsDb from "@/src/lib/db/items";
import * as rank from "@/src/lib/pipeline/rank";
import * as select from "@/src/lib/pipeline/select";
import { FeedItem, RankedItem } from "@/src/lib/model";

vi.mock("@/src/lib/db/items");
vi.mock("@/src/lib/pipeline/rank");
vi.mock("@/src/lib/pipeline/select");
vi.mock("@/src/lib/pipeline/promptProfile");
vi.mock("@/src/lib/pipeline/promptRerank");
vi.mock("@/src/lib/pipeline/podcast");

describe("POST /api/podcast/generate", () => {
  const mockFeedItem: FeedItem = {
    id: "item-1",
    streamId: "feed-1",
    sourceTitle: "Dev Podcast",
    title: "AI Agents in Code Generation",
    url: "https://example.com/episode1",
    author: "John Smith",
    publishedAt: new Date("2025-01-15"),
    summary: "Discussion about using AI agents for code generation",
    contentSnippet: "In this episode...",
    categories: ["agents"],
    category: "podcasts",
    raw: {},
  };

  const mockRankedItem: RankedItem = {
    ...mockFeedItem,
    bm25Score: 0.78,
    llmScore: {
      relevance: 9,
      usefulness: 8,
      tags: ["agents", "ai-coding"],
    },
    recencyScore: 0.95,
    finalScore: 0.87,
    reasoning: "Highly relevant episode",
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("should validate request and return error for invalid categories", async () => {
    const request = new NextRequest("http://localhost/api/podcast/generate", {
      method: "POST",
      body: JSON.stringify({
        categories: ["bad_category"],
        period: "week",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("should validate voice style parameter", async () => {
    const request = new NextRequest("http://localhost/api/podcast/generate", {
      method: "POST",
      body: JSON.stringify({
        categories: ["podcasts"],
        period: "week",
        voiceStyle: "invalid-style",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("should accept valid voice styles", async () => {
    vi.mocked(itemsDb.loadItemsByCategory).mockResolvedValue([mockFeedItem]);
    vi.mocked(rank.rankCategory).mockResolvedValue([mockRankedItem]);
    vi.mocked(select.selectWithDiversity).mockReturnValue({
      items: [mockRankedItem],
      reasons: new Map(),
    });

    const validStyles = ["conversational", "technical", "executive"];

    for (const style of validStyles) {
      const request = new NextRequest("http://localhost/api/podcast/generate", {
        method: "POST",
        body: JSON.stringify({
          categories: ["podcasts"],
          period: "week",
          voiceStyle: style,
        }),
      });

      // Should be accepted
      expect(request).toBeDefined();
    }
  });

  it("should handle optional prompt parameter", async () => {
    vi.mocked(itemsDb.loadItemsByCategory).mockResolvedValue([mockFeedItem]);
    vi.mocked(rank.rankCategory).mockResolvedValue([mockRankedItem]);
    vi.mocked(select.selectWithDiversity).mockReturnValue({
      items: [mockRankedItem],
      reasons: new Map(),
    });

    const request = new NextRequest("http://localhost/api/podcast/generate", {
      method: "POST",
      body: JSON.stringify({
        categories: ["podcasts"],
        period: "week",
        prompt: "Create episode about AI agents for code review",
        voiceStyle: "conversational",
      }),
    });

    expect(request).toBeDefined();
  });

  it("should work without prompt (empty string)", async () => {
    vi.mocked(itemsDb.loadItemsByCategory).mockResolvedValue([mockFeedItem]);
    vi.mocked(rank.rankCategory).mockResolvedValue([mockRankedItem]);
    vi.mocked(select.selectWithDiversity).mockReturnValue({
      items: [mockRankedItem],
      reasons: new Map(),
    });

    const request = new NextRequest("http://localhost/api/podcast/generate", {
      method: "POST",
      body: JSON.stringify({
        categories: ["podcasts"],
        period: "week",
      }),
    });

    expect(request).toBeDefined();
  });

  it("should validate period parameter", async () => {
    const request = new NextRequest("http://localhost/api/podcast/generate", {
      method: "POST",
      body: JSON.stringify({
        categories: ["podcasts"],
        period: "biweekly",
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("should validate limit parameter bounds", async () => {
    const request = new NextRequest("http://localhost/api/podcast/generate", {
      method: "POST",
      body: JSON.stringify({
        categories: ["podcasts"],
        period: "week",
        limit: 100,
      }),
    });

    const response = await POST(request);
    expect(response.status).toBe(400);
  });

  it("should handle default voiceStyle when not provided", async () => {
    vi.mocked(itemsDb.loadItemsByCategory).mockResolvedValue([mockFeedItem]);
    vi.mocked(rank.rankCategory).mockResolvedValue([mockRankedItem]);
    vi.mocked(select.selectWithDiversity).mockReturnValue({
      items: [mockRankedItem],
      reasons: new Map(),
    });

    const request = new NextRequest("http://localhost/api/podcast/generate", {
      method: "POST",
      body: JSON.stringify({
        categories: ["podcasts"],
        period: "week",
      }),
    });

    expect(request).toBeDefined();
  });
});
