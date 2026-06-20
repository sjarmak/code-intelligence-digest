/**
 * buildItemText is the single canonical doc-side text for embedding an item
 * (dv0.5.2, architect C1). It is frozen into source_hash, so its exact output
 * is a contract — these tests pin the exact string.
 */
import { describe, it, expect } from "vitest";
import { buildItemText } from "@/src/lib/embeddings/item-text";
import type { FeedItem } from "@/src/lib/model";

function item(partial: Partial<FeedItem>): FeedItem {
  return {
    id: "i1",
    streamId: "s1",
    sourceTitle: "Some Source",
    title: "T",
    url: "https://x",
    publishedAt: new Date(0),
    categories: [],
    category: "ai-ml" as FeedItem["category"],
    raw: null,
    ...partial,
  };
}

describe("buildItemText", () => {
  it("joins title + summary + contentSnippet + fullText (NO sourceTitle)", () => {
    const text = buildItemText(
      item({
        title: "Cursor 2.0",
        sourceTitle: "TechBlog",
        summary: "A new IDE",
        contentSnippet: "snippet",
        fullText: "body",
      }),
    );
    expect(text).toBe("Cursor 2.0 A new IDE snippet body");
    expect(text).not.toContain("TechBlog"); // sourceTitle excluded by contract
  });

  it("truncates fullText to 2000 chars", () => {
    const text = buildItemText(
      item({ title: "T", summary: "", contentSnippet: "", fullText: "x".repeat(3000) }),
    );
    expect(text).toBe(`T ${"x".repeat(2000)}`);
  });

  it("caps total length so a pathological summary/snippet can't OOM the encoder", () => {
    // A ~50K-char summary (the dv0.5.8 stall) becomes a ~13K-token sequence;
    // O(n^2) attention then OOMs the batch. The total must stay bounded.
    const text = buildItemText(item({ title: "T", summary: "s".repeat(50_000) }));
    expect(text.length).toBe(8000);
    expect(text.startsWith("T sss")).toBe(true);
  });

  it("handles missing optional fields without leaking undefined", () => {
    expect(buildItemText(item({ title: "Only Title" }))).toBe("Only Title");
  });

  it("returns empty string when there is no usable text", () => {
    expect(buildItemText(item({ title: "", summary: "", contentSnippet: "", fullText: "" }))).toBe(
      "",
    );
  });
});
