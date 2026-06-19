/**
 * Orchestration tests for embedAndStoreItems (dv0.5.2). The encoder is injected,
 * so the job logic — resume-skip, prefixing, batching, empty-skip — is verified
 * with a deterministic fake encoder; the real nomic model is not needed here.
 *
 * embeddings-models is partially mocked: computeSourceHash stays REAL (the job's
 * hashing must match what the storage layer would compute), while
 * getModelSourceHashes and saveModelEmbeddingsBatch are stubbed to observe the
 * job's resume and write decisions.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { gmshMock, saveMock } = vi.hoisted(() => ({
  gmshMock: vi.fn(),
  saveMock: vi.fn(),
}));

vi.mock("@/src/lib/db/embeddings-models", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/src/lib/db/embeddings-models")>();
  return {
    ...actual,
    getModelSourceHashes: gmshMock,
    saveModelEmbeddingsBatch: saveMock,
  };
});

vi.mock("@/src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

import { embedAndStoreItems } from "@/src/lib/embeddings/model-embed-job";
import { buildItemText } from "@/src/lib/embeddings/item-text";
import { computeSourceHash, type ModelEmbeddingRow } from "@/src/lib/db/embeddings-models";
import { DOCUMENT_PREFIX } from "@/src/lib/embeddings/encoder";
import { NOMIC_EMBED } from "@/src/lib/embeddings/provenance";
import type { Encoder } from "@/src/lib/embeddings/encoder";
import type { FeedItem } from "@/src/lib/model";

function unitVec(dim = 768): number[] {
  const v = new Array(dim).fill(0);
  v[0] = 1;
  return v;
}

function item(id: string, title = `Title ${id}`): FeedItem {
  return {
    id,
    streamId: "s1",
    sourceTitle: "Src",
    title,
    url: "https://x",
    publishedAt: new Date(0),
    categories: [],
    category: "ai-ml" as FeedItem["category"],
    raw: null,
  };
}

let capturedInputs: string[][];
function makeFakeEncoder(): Encoder {
  capturedInputs = [];
  return {
    modelName: NOMIC_EMBED.model,
    version: NOMIC_EMBED.version,
    documentPrefix: DOCUMENT_PREFIX,
    embedDocuments: vi.fn(async (texts: string[]) => {
      capturedInputs.push(texts);
      return texts.map(() => unitVec(768));
    }),
  };
}

/** Hash the job WOULD compute for an item, to seed the resume map. */
function expectedHash(it: FeedItem): string {
  return computeSourceHash(NOMIC_EMBED.model, DOCUMENT_PREFIX + buildItemText(it));
}

beforeEach(() => {
  gmshMock.mockReset().mockResolvedValue(new Map());
  saveMock.mockReset().mockResolvedValue({ saved: 0 });
});

describe("embedAndStoreItems", () => {
  it("no-ops on empty input", async () => {
    const stats = await embedAndStoreItems([], makeFakeEncoder());
    expect(stats).toEqual({ total: 0, skipped: 0, embedded: 0, emptySkipped: 0 });
    expect(gmshMock).not.toHaveBeenCalled();
    expect(saveMock).not.toHaveBeenCalled();
  });

  it("embeds all items with the document prefix when nothing is stored", async () => {
    saveMock.mockResolvedValue({ saved: 2 });
    const items = [item("a"), item("b")];
    const enc = makeFakeEncoder();
    const stats = await embedAndStoreItems(items, enc);

    expect(stats.embedded).toBe(2);
    expect(stats.skipped).toBe(0);
    // every encoder input carries the document prefix
    expect(capturedInputs.flat().every((t) => t.startsWith(DOCUMENT_PREFIX))).toBe(true);
    // rows carry model identity + the same hash the storage layer would key on
    const rows: ModelEmbeddingRow[] = saveMock.mock.calls[0][0];
    expect(rows[0].modelName).toBe(NOMIC_EMBED.model);
    expect(rows[0].version).toBe(NOMIC_EMBED.version);
    expect(rows[0].sourceHash).toBe(expectedHash(items[0]));
  });

  it("skips items whose stored hash matches (resume) and re-embeds the rest", async () => {
    const items = [item("a"), item("b")];
    // 'a' already embedded with the matching hash; 'b' is new.
    gmshMock.mockResolvedValue(new Map([[items[0].id, expectedHash(items[0])]]));
    saveMock.mockResolvedValue({ saved: 1 });

    const stats = await embedAndStoreItems(items, makeFakeEncoder());
    expect(stats.skipped).toBe(1);
    expect(stats.embedded).toBe(1);
    const rows: ModelEmbeddingRow[] = saveMock.mock.calls[0][0];
    expect(rows.map((r) => r.itemId)).toEqual(["b"]);
  });

  it("re-embeds when the stored hash is stale (text changed)", async () => {
    const items = [item("a")];
    gmshMock.mockResolvedValue(new Map([[items[0].id, "stale-hash"]]));
    saveMock.mockResolvedValue({ saved: 1 });
    const stats = await embedAndStoreItems(items, makeFakeEncoder());
    expect(stats.skipped).toBe(0);
    expect(stats.embedded).toBe(1);
  });

  it("skips empty-text items without writing a zero vector", async () => {
    const empty = item("e", "");
    empty.summary = "";
    empty.contentSnippet = "";
    empty.fullText = "";
    saveMock.mockResolvedValue({ saved: 1 });
    const stats = await embedAndStoreItems([empty, item("a")], makeFakeEncoder());
    expect(stats.emptySkipped).toBe(1);
    const rows: ModelEmbeddingRow[] = saveMock.mock.calls[0][0];
    expect(rows.map((r) => r.itemId)).toEqual(["a"]); // empty item never reaches save
  });

  it("encodes in batches of the configured size", async () => {
    const items = ["a", "b", "c", "d", "e"].map((id) => item(id));
    const enc = makeFakeEncoder();
    saveMock.mockResolvedValue({ saved: 2 });
    await embedAndStoreItems(items, enc, { batchSize: 2 });
    // 5 items, batchSize 2 → 3 encoder calls (2,2,1)
    expect(capturedInputs.map((c) => c.length)).toEqual([2, 2, 1]);
  });
});
