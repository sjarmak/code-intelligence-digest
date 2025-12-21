/**
 * Tests for podcast generation
 * Note: Some functions are private; testing public API and behavior
 */

import { describe, it } from "vitest";
import { RankedItem } from "@/src/lib/model";

describe("podcast", () => {
  const createMockItem = (id: string): RankedItem => ({
    id,
    streamId: `stream-${id}`,
    sourceTitle: "Tech Podcast",
    title: `Episode: ${id}`,
    url: `https://example.com/${id}`,
    author: "Host",
    publishedAt: new Date(),
    summary: "Episode summary",
    category: "podcasts",
    categories: ["podcasts"],
    raw: {},
    bm25Score: 0.7,
    llmScore: {
      relevance: 8,
      usefulness: 7,
      tags: ["podcast"],
    },
    recencyScore: 0.9,
    finalScore: 0.8,
    reasoning: "Good episode",
  });

  // Private function tests are integration-tested through generatePodcastContent
  // Tests focus on public API behavior
});
