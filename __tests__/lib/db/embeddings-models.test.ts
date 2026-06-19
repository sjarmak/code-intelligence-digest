/**
 * Tests for the blue-green multi-model embedding store (dv0.5.1).
 *
 * The DB driver is mocked (per oauth-tokens.test.ts) so these are deterministic
 * and need no live Postgres. They pin the storage contract the encoder (dv0.5.2)
 * and backfill (dv0.5.3) beads depend on: composite-PK upsert, honest
 * provenance from measured norm, and a model-scoped source hash.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import { createHash } from "node:crypto";

const { queryMock, runMock } = vi.hoisted(() => ({
  queryMock: vi.fn(),
  runMock: vi.fn(),
}));

vi.mock("@/src/lib/db/driver", () => ({
  getDbClient: vi.fn(async () => ({
    driver: "postgres",
    query: queryMock,
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

import {
  computeSourceHash,
  saveModelEmbeddingsBatch,
  getModelEmbeddingsCount,
  getModelSourceHashes,
  getModelEmbeddingCoverage,
} from "@/src/lib/db/embeddings-models";
import { NOMIC_EMBED } from "@/src/lib/embeddings/provenance";
import { TABLES_SQL, INDEXES_SQL } from "@/src/lib/db/schema-postgres";

/** A genuine unit vector of length `dim`: one component 1, rest 0 → norm 1. */
function unitVec(dim = 768): number[] {
  const v = new Array(dim).fill(0);
  v[0] = 1;
  return v;
}

beforeEach(() => {
  queryMock.mockReset();
  runMock.mockReset().mockResolvedValue({ changes: 1 });
  warnMock.mockReset();
  infoMock.mockReset();
  errorMock.mockReset();
});

describe("computeSourceHash", () => {
  it("is sha256 over model_name + NUL + encoderInput (exact value)", () => {
    const expected = createHash("sha256")
      .update("nomic-embed-text-v1.5\u0000search_document: hello world")
      .digest("hex");
    expect(
      computeSourceHash("nomic-embed-text-v1.5", "search_document: hello world"),
    ).toBe(expected);
  });

  it("is deterministic for the same (model, input)", () => {
    const a = computeSourceHash("m", "search_document: x");
    const b = computeSourceHash("m", "search_document: x");
    expect(a).toBe(b);
  });

  it("is model-scoped: same input, different model → different hash", () => {
    expect(computeSourceHash("model-a", "search_document: x")).not.toBe(
      computeSourceHash("model-b", "search_document: x"),
    );
  });

  it("covers the encoder input: changing the prefix changes the hash", () => {
    expect(computeSourceHash("m", "search_document: x")).not.toBe(
      computeSourceHash("m", "search_query: x"),
    );
  });
});

describe("saveModelEmbeddingsBatch", () => {
  it("no-ops on an empty batch (no DB call)", async () => {
    const result = await saveModelEmbeddingsBatch([]);
    expect(result).toEqual({ saved: 0 });
    expect(runMock).not.toHaveBeenCalled();
  });

  it("upserts on the composite PK (item_id, model_name) with honest provenance", async () => {
    const result = await saveModelEmbeddingsBatch([
      {
        itemId: "item-1",
        modelName: NOMIC_EMBED.model,
        embedding: unitVec(768),
        version: NOMIC_EMBED.version,
        sourceHash: "hash-1",
      },
    ]);

    expect(result.saved).toBe(1);
    expect(runMock).toHaveBeenCalledTimes(1);
    const [sql, params] = runMock.mock.calls[0];
    expect(sql).toContain("INSERT INTO item_model_embeddings");
    expect(sql).toContain("ON CONFLICT (item_id, model_name) DO UPDATE");
    expect(sql).toContain("$3::vector");
    // params: itemId, modelName, vectorStr, sourceHash, dims, version, normalized
    expect(params[0]).toBe("item-1");
    expect(params[1]).toBe(NOMIC_EMBED.model);
    expect(params[2]).toBe(`[${unitVec(768).join(",")}]`);
    expect(params[3]).toBe("hash-1");
    expect(params[4]).toBe(768); // dimensions derived from the vector
    expect(params[5]).toBe(NOMIC_EMBED.version);
    expect(params[6]).toBe(true); // unit-norm → normalized
    expect(warnMock).not.toHaveBeenCalled();
  });

  it("stores embedding_normalized=false AND warns on an out-of-band norm", async () => {
    // 768 components of 0.561 → norm ≈ 15.5, far outside the unit band.
    const result = await saveModelEmbeddingsBatch([
      {
        itemId: "item-bad",
        modelName: NOMIC_EMBED.model,
        embedding: new Array(768).fill(0.561),
        version: NOMIC_EMBED.version,
        sourceHash: "hash-bad",
      },
    ]);

    expect(result.saved).toBe(1);
    const [, params] = runMock.mock.calls[0];
    expect(params[6]).toBe(false); // out-of-band → not normalized
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("is idempotent across re-runs (composite-PK upsert path)", async () => {
    const row = {
      itemId: "item-1",
      modelName: NOMIC_EMBED.model,
      embedding: unitVec(768),
      version: NOMIC_EMBED.version,
      sourceHash: "hash-1",
    };
    await saveModelEmbeddingsBatch([row]);
    await saveModelEmbeddingsBatch([row]);
    // Both calls take the ON CONFLICT DO UPDATE path — no dup, no error.
    for (const call of runMock.mock.calls) {
      expect(call[0]).toContain("ON CONFLICT (item_id, model_name) DO UPDATE");
    }
  });

  it("propagates DB errors instead of swallowing them (no silent data loss)", async () => {
    runMock.mockRejectedValueOnce(new Error("connection reset"));
    await expect(
      saveModelEmbeddingsBatch([
        {
          itemId: "item-1",
          modelName: NOMIC_EMBED.model,
          embedding: unitVec(768),
          version: NOMIC_EMBED.version,
          sourceHash: "hash-1",
        },
      ]),
    ).rejects.toThrow("connection reset");
  });
});

describe("getModelEmbeddingsCount", () => {
  it("counts rows scoped to a single model_name", async () => {
    queryMock.mockResolvedValue({ rows: [{ count: "42" }], rowCount: 1 });
    const count = await getModelEmbeddingsCount(NOMIC_EMBED.model);
    expect(count).toBe(42);
    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("FROM item_model_embeddings");
    expect(sql).toContain("WHERE model_name = $1");
    expect(params).toEqual([NOMIC_EMBED.model]);
  });
});

describe("getModelSourceHashes (resume read, dv0.5.2)", () => {
  it("returns a map of stored hashes, excluding non-normalized (poisoned) rows", async () => {
    queryMock.mockResolvedValue({
      rows: [
        { item_id: "a", source_hash: "ha" },
        { item_id: "b", source_hash: "hb" },
      ],
      rowCount: 2,
    });
    const map = await getModelSourceHashes(NOMIC_EMBED.model, ["a", "b", "c"]);
    expect(map.get("a")).toBe("ha");
    expect(map.get("b")).toBe("hb");
    expect(map.has("c")).toBe(false);

    const [sql, params] = queryMock.mock.calls[0];
    expect(sql).toContain("FROM item_model_embeddings");
    expect(sql).toContain("model_name = $1");
    // poisoned rows must be excluded so they re-embed (architect C2); the
    // column is NOT NULL so = TRUE is exact (vs IS NOT FALSE on the nullable old table)
    expect(sql).toContain("embedding_normalized = TRUE");
    expect(sql).toContain("item_id = ANY($2)");
    expect(params).toEqual([NOMIC_EMBED.model, ["a", "b", "c"]]);
  });

  it("no-ops on empty itemIds (no DB call)", async () => {
    const map = await getModelSourceHashes(NOMIC_EMBED.model, []);
    expect(map.size).toBe(0);
    expect(queryMock).not.toHaveBeenCalled();
  });

  it("propagates DB errors (a swallowed read would re-embed the whole corpus)", async () => {
    queryMock.mockRejectedValueOnce(new Error("read failed"));
    await expect(getModelSourceHashes(NOMIC_EMBED.model, ["a"])).rejects.toThrow("read failed");
  });
});

describe("getModelEmbeddingCoverage (dv0.5.3)", () => {
  it("reports totals + per-period coverage; completeness is embedded vs expected", async () => {
    // 1st call: totals; then one call per period (last_7d, last_30d).
    queryMock
      .mockResolvedValueOnce({
        rows: [{ total_items: 100, expected: 95, embedded: 90, not_normalized: 0 }],
      })
      .mockResolvedValueOnce({ rows: [{ items: 20, embedded: 19 }] })
      .mockResolvedValueOnce({ rows: [{ items: 50, embedded: 48 }] });

    const cov = await getModelEmbeddingCoverage(NOMIC_EMBED.model);

    expect(cov.totalItems).toBe(100);
    expect(cov.expected).toBe(95); // empty-text items excluded — the real denominator
    expect(cov.embedded).toBe(90);
    expect(cov.notNormalized).toBe(0);
    expect(cov.periods).toEqual([
      { label: "last_7d", items: 20, embedded: 19 },
      { label: "last_30d", items: 50, embedded: 48 },
    ]);

    const totalsSql = queryMock.mock.calls[0][0];
    expect(totalsSql).toContain("FROM items");
    expect(totalsSql).toContain("item_model_embeddings");
    expect(totalsSql).toContain("embedding_normalized = TRUE"); // embedded counts only good rows
    expect(queryMock.mock.calls[0][1]).toEqual([NOMIC_EMBED.model]);

    // per-period query uses LEFT JOIN so un-embedded items are not dropped
    const periodSql = queryMock.mock.calls[1][0];
    expect(periodSql).toContain("LEFT JOIN item_model_embeddings");
    expect(periodSql).toContain("published_at >= $2");
    expect(periodSql).toContain("FILTER (WHERE");
    expect(queryMock.mock.calls[1][1][0]).toBe(NOMIC_EMBED.model);
    expect(typeof queryMock.mock.calls[1][1][1]).toBe("number"); // epoch cutoff
  });

  it("propagates DB errors (coverage is a gate, not a best-effort number)", async () => {
    queryMock.mockRejectedValueOnce(new Error("coverage query failed"));
    await expect(getModelEmbeddingCoverage(NOMIC_EMBED.model)).rejects.toThrow(
      "coverage query failed",
    );
  });
});

describe("schema substrate (dv0.5.1)", () => {
  it("defines item_model_embeddings with a composite PK and 768d vector", () => {
    expect(TABLES_SQL).toContain("CREATE TABLE IF NOT EXISTS item_model_embeddings");
    expect(TABLES_SQL).toContain("PRIMARY KEY (item_id, model_name)");
    expect(TABLES_SQL).toContain("vector(768)");
    expect(TABLES_SQL).toContain("source_hash");
    expect(TABLES_SQL).toContain("embedding_normalized");
  });

  it("indexes model_name for coverage queries", () => {
    expect(INDEXES_SQL).toContain("item_model_embeddings(model_name)");
  });

  it("does NOT create an HNSW index on the empty table at init (deferred to backfill)", () => {
    // Building HNSW on an empty table then bulk-loading pays per-row maintenance
    // (architect C1). The index is created post-load in dv0.5.3. Check
    // per-statement so the existing item_embeddings HNSW does not false-trip.
    const statements = INDEXES_SQL.split(";");
    const modelTableIndexes = statements.filter((s) =>
      s.includes("item_model_embeddings"),
    );
    expect(modelTableIndexes.length).toBeGreaterThan(0);
    for (const stmt of modelTableIndexes) {
      // "USING hnsw" is the actual index-creation syntax; a comment mentioning
      // hnsw is fine, an index built with it is not.
      expect(stmt.toLowerCase()).not.toContain("using hnsw");
    }
  });
});
