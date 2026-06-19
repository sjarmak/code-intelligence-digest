/**
 * Regression test for the OpenAI (1536d) embedding lane (dv0.5.1, architect C2).
 *
 * saveEmbeddingsBatch previously PADDED any 768d input up to 1536d and wrote it
 * to item_embeddings under the default normalized=true label — a non-unit-norm
 * garbage vector that still passes the `embedding_normalized IS NOT FALSE` serve
 * filter and poisons cosine results. The blue-green migration makes a 768d input
 * to this function far more likely (local nomic vectors), so the lane must now
 * REJECT non-1536d input rather than fabricate a vector. 768d vectors belong in
 * item_model_embeddings, never here.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";

const { runMock } = vi.hoisted(() => ({ runMock: vi.fn() }));

vi.mock("@/src/lib/db/driver", () => ({
  getDbClient: vi.fn(async () => ({
    driver: "postgres",
    query: vi.fn(),
    run: runMock,
  })),
}));

const { warnMock, infoMock, errorMock } = vi.hoisted(() => ({
  warnMock: vi.fn(),
  infoMock: vi.fn(),
  errorMock: vi.fn(),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { warn: warnMock, info: infoMock, error: errorMock },
}));

import { saveEmbeddingsBatch } from "@/src/lib/db/embeddings";

beforeEach(() => {
  runMock.mockReset().mockResolvedValue({ changes: 1 });
  warnMock.mockReset();
  infoMock.mockReset();
  errorMock.mockReset();
});

describe("saveEmbeddingsBatch (OpenAI 1536d lane)", () => {
  it("stores a genuine 1536d vector", async () => {
    const vec = new Array(1536).fill(0);
    vec[0] = 1;
    await saveEmbeddingsBatch([{ itemId: "item-1", embedding: vec }]);
    expect(runMock).toHaveBeenCalledTimes(1);
    const [sql, params] = runMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO item_embeddings");
    expect(params[0]).toBe("item-1");
    expect(params[1]).toBe(`[${vec.join(",")}]`);
  });

  it("REJECTS a 768d vector (no padding, no write) and logs an error", async () => {
    const vec768 = new Array(768).fill(0.5);
    await saveEmbeddingsBatch([{ itemId: "item-768", embedding: vec768 }]);
    expect(runMock).not.toHaveBeenCalled();
    expect(errorMock).toHaveBeenCalledTimes(1);
  });

  it("skips the bad row but still writes the good one in a mixed batch", async () => {
    const good = new Array(1536).fill(0);
    good[0] = 1;
    await saveEmbeddingsBatch([
      { itemId: "bad", embedding: new Array(768).fill(0.5) },
      { itemId: "good", embedding: good },
    ]);
    expect(runMock).toHaveBeenCalledTimes(1);
    expect(runMock.mock.calls[0][1][0]).toBe("good");
  });
});
