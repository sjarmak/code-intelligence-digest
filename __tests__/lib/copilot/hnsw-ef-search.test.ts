/**
 * Tests for the HNSW recall knob resolver used by the copilot serve pools
 * (P2.2). Guards the env → hnsw.ef_search mapping: a small nomic store defaults
 * higher than pgvector's 40, invalid input falls back to the pgvector default
 * (null), and absurd values are clamped.
 */
import { describe, it, expect } from "vitest";
import { resolveHnswEfSearch } from "@/src/lib/copilot/mirror-context";

describe("resolveHnswEfSearch", () => {
  it("defaults to 100 when unset or blank", () => {
    expect(resolveHnswEfSearch(undefined)).toBe(100);
    expect(resolveHnswEfSearch("")).toBe(100);
    expect(resolveHnswEfSearch("   ")).toBe(100);
  });

  it("uses a valid positive integer", () => {
    expect(resolveHnswEfSearch("40")).toBe(40);
    expect(resolveHnswEfSearch("250")).toBe(250);
  });

  it("floors fractional values", () => {
    expect(resolveHnswEfSearch("64.9")).toBe(64);
  });

  it("clamps absurd values to 1000", () => {
    expect(resolveHnswEfSearch("99999")).toBe(1000);
  });

  it("returns null (pgvector default) for invalid input", () => {
    expect(resolveHnswEfSearch("0")).toBeNull();
    expect(resolveHnswEfSearch("-5")).toBeNull();
    expect(resolveHnswEfSearch("abc")).toBeNull();
  });
});
