/**
 * Tests for the keyset-paginated item loader + the shared row->FeedItem mapper
 * (dv0.5.3). The driver and url-curation are mocked so these are deterministic
 * and need no live Postgres.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { queryMock } = vi.hoisted(() => ({ queryMock: vi.fn() }));

vi.mock("@/src/lib/db/driver", () => ({
  getDbClient: vi.fn(async () => ({ driver: "postgres", query: queryMock, run: vi.fn() })),
}));

const { resolveMock } = vi.hoisted(() => ({ resolveMock: vi.fn() }));
vi.mock("@/src/lib/url-curation", () => ({
  tryResolveToArticleUrl: resolveMock,
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { mapItemRow, loadItemsPage, type ItemRow } from "@/src/lib/db/items";

function row(over: Partial<ItemRow> = {}): ItemRow {
  return {
    id: "i1",
    stream_id: "s1",
    source_title: "Src",
    title: "Title",
    url: "https://example.com/a",
    author: "auth",
    published_at: 1_700_000_000,
    summary: "sum",
    content_snippet: "snip",
    categories: '["ai-ml"]',
    category: "ai-ml",
    full_text: "body",
    extracted_url: null,
    ...over,
  };
}

beforeEach(() => {
  queryMock.mockReset();
  resolveMock.mockReset().mockImplementation((u: string) => u); // identity by default
});

describe("mapItemRow", () => {
  it("maps a DB row to a FeedItem", () => {
    const item = mapItemRow(row());
    expect(item).not.toBeNull();
    expect(item).toMatchObject({
      id: "i1",
      streamId: "s1",
      sourceTitle: "Src",
      title: "Title",
      url: "https://example.com/a",
      author: "auth",
      summary: "sum",
      contentSnippet: "snip",
      categories: ["ai-ml"],
      category: "ai-ml",
      fullText: "body",
    });
    expect((item as { publishedAt: Date }).publishedAt).toEqual(new Date(1_700_000_000 * 1000));
  });

  it("returns null when the URL cannot be resolved to an article", () => {
    resolveMock.mockReturnValue(null);
    expect(mapItemRow(row())).toBeNull();
  });

  it("prefers extracted_url when the stored url is an inoreader link", () => {
    mapItemRow(row({ url: "https://www.inoreader.com/x", extracted_url: "https://real.com/post" }));
    expect(resolveMock).toHaveBeenCalledWith("https://real.com/post");
  });
});

describe("loadItemsPage", () => {
  it("keyset-paginates by id (WHERE id > $1 ORDER BY id LIMIT $2)", async () => {
    queryMock.mockResolvedValue({ rows: [row({ id: "i2" }), row({ id: "i3" })], rowCount: 2 });
    const page = await loadItemsPage("i1", 2);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("FROM items");
    expect(sql).toContain("WHERE id > $1");
    expect(sql).toContain("ORDER BY id");
    expect(sql).toContain("LIMIT $2");
    expect(params).toEqual(["i1", 2]);
    expect(page.items.map((i) => i.id)).toEqual(["i2", "i3"]);
    // full page (rows === limit) → more may exist → cursor is the last RAW id
    expect(page.nextCursor).toBe("i3");
  });

  it("applies a recency filter when sinceEpoch is given", async () => {
    queryMock.mockResolvedValue({ rows: [row({ id: "i2" })], rowCount: 1 });
    await loadItemsPage("i1", 100, 1_700_000_000);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("published_at >= $2");
    expect(sql).toContain("LIMIT $3");
    expect(params).toEqual(["i1", 1_700_000_000, 100]);
  });

  it("omits the recency filter when sinceEpoch is undefined", async () => {
    queryMock.mockResolvedValue({ rows: [], rowCount: 0 });
    await loadItemsPage("i1", 50);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).not.toContain("published_at >="); // no recency filter in WHERE
    expect(params).toEqual(["i1", 50]);
  });

  it("nextCursor is null on a partial page (corpus exhausted)", async () => {
    queryMock.mockResolvedValue({ rows: [row({ id: "i2" })], rowCount: 1 });
    const page = await loadItemsPage("i1", 100);
    expect(page.nextCursor).toBeNull();
  });

  it("advances the cursor by the last RAW row even when rows are filtered out", async () => {
    resolveMock.mockImplementation((u: string) => (u.includes("bad") ? null : u));
    queryMock.mockResolvedValue({
      rows: [row({ id: "ok", url: "https://good.com" }), row({ id: "zlast", url: "https://bad.com" })],
      rowCount: 2,
    });
    const page = await loadItemsPage("", 2);
    expect(page.items.map((i) => i.id)).toEqual(["ok"]); // bad URL dropped
    expect(page.nextCursor).toBe("zlast"); // ...but cursor still advances past it
    expect(page.rawCount).toBe(2); // raw rows counted before filtering (for --limit budget)
  });
});
