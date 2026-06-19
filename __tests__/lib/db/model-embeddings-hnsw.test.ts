import { describe, it, expect } from "vitest";
import {
  HNSW_INDEX_NAME,
  HNSW_TABLE,
  HNSW_COLUMN,
  DEFAULT_MAINTENANCE_WORK_MEM,
  createIndexSql,
  dropIndexSql,
  ensureModelEmbeddingsHnswIndex,
  type SqlRunner,
} from "../../../src/lib/db/model-embeddings-hnsw";

/**
 * A fake pg client that records every query and returns scripted validity rows
 * for the pg_index probe. `validitySequence` is consumed once per validity read
 * (null = relation absent, boolean = indisvalid).
 */
function makeFakeClient(validitySequence: Array<boolean | null>): SqlRunner & {
  calls: Array<{ sql: string; params?: unknown[] }>;
} {
  const calls: Array<{ sql: string; params?: unknown[] }> = [];
  let validityIdx = 0;
  return {
    calls,
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (sql.includes("indisvalid")) {
        if (validityIdx >= validitySequence.length) {
          throw new Error(`validity probed more than ${validitySequence.length} times`);
        }
        const v = validitySequence[validityIdx++];
        return { rows: v === null ? [] : [{ valid: v }] };
      }
      return { rows: [] };
    },
  };
}

describe("model-embeddings-hnsw DDL", () => {
  it("targets the right relation, column, and ops class", () => {
    const create = createIndexSql();
    expect(create).toContain(HNSW_INDEX_NAME);
    expect(create).toContain(HNSW_TABLE);
    expect(create).toContain(`hnsw (${HNSW_COLUMN} vector_cosine_ops)`);
  });

  it("builds CONCURRENTLY and idempotently (IF NOT EXISTS)", () => {
    expect(createIndexSql()).toContain("CONCURRENTLY");
    expect(createIndexSql()).toContain("IF NOT EXISTS");
  });

  it("drops CONCURRENTLY so a rebuild never blocks the live cron", () => {
    expect(dropIndexSql()).toContain("CONCURRENTLY");
    expect(dropIndexSql()).toContain("IF EXISTS");
    expect(dropIndexSql()).toContain(HNSW_INDEX_NAME);
  });
});

describe("ensureModelEmbeddingsHnswIndex", () => {
  it("disables statement_timeout and sets maintenance_work_mem on the session", async () => {
    const client = makeFakeClient([true]);
    await ensureModelEmbeddingsHnswIndex(client, { maintenanceWorkMem: "1GB" });

    const timeout = client.calls.find((c) => c.sql.includes("statement_timeout"));
    const workMem = client.calls.find((c) => c.sql.includes("maintenance_work_mem"));
    expect(timeout?.sql).toContain("'0'");
    expect(workMem?.params).toEqual(["1GB"]);
  });

  it("defaults maintenance_work_mem when unspecified", async () => {
    const client = makeFakeClient([true]);
    await ensureModelEmbeddingsHnswIndex(client);
    const workMem = client.calls.find((c) => c.sql.includes("maintenance_work_mem"));
    expect(workMem?.params).toEqual([DEFAULT_MAINTENANCE_WORK_MEM]);
  });

  it("creates once and does not drop when the build is valid", async () => {
    const client = makeFakeClient([true]);
    const result = await ensureModelEmbeddingsHnswIndex(client);

    expect(result).toEqual({ valid: true, retried: false });
    const creates = client.calls.filter((c) => c.sql.startsWith("CREATE INDEX"));
    const drops = client.calls.filter((c) => c.sql.startsWith("DROP INDEX"));
    expect(creates).toHaveLength(1);
    expect(drops).toHaveLength(0);
  });

  it("drops and rebuilds once when a prior build left an invalid index", async () => {
    // First probe: invalid. Second probe (after rebuild): valid.
    const client = makeFakeClient([false, true]);
    const result = await ensureModelEmbeddingsHnswIndex(client);

    expect(result).toEqual({ valid: true, retried: true });
    const drops = client.calls.filter((c) => c.sql.startsWith("DROP INDEX"));
    const creates = client.calls.filter((c) => c.sql.startsWith("CREATE INDEX"));
    expect(drops).toHaveLength(1);
    expect(creates).toHaveLength(2);
  });

  it("throws (does not swallow) when the index is still invalid after rebuild", async () => {
    const client = makeFakeClient([false, false]);
    await expect(ensureModelEmbeddingsHnswIndex(client)).rejects.toThrow(/still invalid/);
  });
});
