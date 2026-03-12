/**
 * Tests for podcast and audio digest transcript generation.
 * Focus: transcript output should not contain inline (ref: item-X) markers.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../src/lib/llm/completion", () => ({
  createChatCompletion: vi.fn(),
}));
vi.mock("../../../src/lib/llm/config", () => ({
  hasLLMConfigured: vi.fn(),
}));

import { createChatCompletion } from "../../../src/lib/llm/completion";
import { hasLLMConfigured } from "../../../src/lib/llm/config";
import { generatePodcastContent } from "../../../src/lib/pipeline/podcast";
import { generateAudioDigestTranscript, type ItemWithHighlights } from "../../../src/lib/pipeline/audioDigest";
import type { RankedItem } from "../../../src/lib/model";

const mockCreate = vi.mocked(createChatCompletion);
const mockHasLLM = vi.mocked(hasLLMConfigured);

describe("podcast", () => {
  beforeEach(() => {
    mockHasLLM.mockReset();
    mockCreate.mockReset();
    mockHasLLM.mockReturnValue(true);
  });

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

  it("strips inline refs from podcast transcript output", async () => {
    const items = [createMockItem("1"), createMockItem("2")];

    mockCreate.mockResolvedValue({
      content: `[INTRO MUSIC]

Host: Opening context (ref: item-0).

## SEGMENT: Signals
Host: Key update (ref: item-1).

[OUTRO MUSIC]`,
    } as Awaited<ReturnType<typeof createChatCompletion>>);

    const result = await generatePodcastContent(
      items,
      "week",
      ["podcasts"],
      null,
      "conversational",
    );

    expect(result.transcript).not.toContain("(ref:");
    expect(result.transcript).not.toContain(items[1].title);
    expect(result.segments[0]?.itemsReferenced[0]?.id).toBe(items[1].id);
  });

  it("strips inline refs from audio digest transcript output", async () => {
    const items = [createMockItem("1"), createMockItem("2")];
    const itemsWithHighlights: ItemWithHighlights[] = items.map((item) => ({
      item,
      highlights: [
        {
          text: `${item.title} key point`,
          excerpt: "Important excerpt",
          sourceName: item.title,
        },
      ],
    }));

    mockCreate.mockResolvedValue({
      content: `[INTRO MUSIC]

HOST: Today we're covering several updates (ref: item-0).

## SEGMENT: Tooling
HOST: Another useful update (ref: item-1).

[OUTRO MUSIC]`,
    } as Awaited<ReturnType<typeof createChatCompletion>>);

    const result = await generateAudioDigestTranscript(
      itemsWithHighlights,
      "week",
      ["podcasts"],
      "",
    );

    expect(result.transcript).not.toContain("(ref:");
    expect(result.transcript).not.toContain(items[1].title);
    expect(result.segments[0]?.itemsReferenced[0]?.id).toBe(items[1].id);
  });
});
