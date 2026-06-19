/**
 * Tests for embedding provenance + metric-space guards (PRD M0).
 * Pure functions — no DB, no network. These encode the norm-based provenance
 * rules the backfill and cosine guard both rely on.
 */

import { describe, it, expect } from "vitest";
import {
  CURRENT_EMBEDDING,
  PSEUDO_FALLBACK_MODEL,
  EmbeddingProvenanceError,
  embeddingNorm,
  classifyEmbeddingProvenance,
  isQueryEmbeddingValid,
  assertQueryEmbeddingProvenance,
} from "../../../src/lib/embeddings/provenance";

const DIM = CURRENT_EMBEDDING.dimensions; // 1536

/** Build a `dim`-length vector with every component = `value`. norm = value*sqrt(dim). */
function constVec(value: number, dim = DIM): number[] {
  return new Array(dim).fill(value);
}

/** A genuine unit vector: one component 1, rest 0 → norm exactly 1. */
function unitVec(dim = DIM): number[] {
  const v = new Array(dim).fill(0);
  v[0] = 1;
  return v;
}

/** The hash-pseudo signature: 1536 components ≈0.561 → norm ≈ 22 (audit measured 21.9). */
function pseudoVec(dim = DIM): number[] {
  return constVec(0.561, dim);
}

describe("embeddingNorm", () => {
  it("computes exact L2 norm", () => {
    expect(embeddingNorm([3, 4])).toBeCloseTo(5, 10);
    expect(embeddingNorm(unitVec())).toBeCloseTo(1, 10);
    expect(embeddingNorm(constVec(0, DIM))).toBe(0);
  });

  it("flags the pseudo-embedding signature near 22", () => {
    expect(embeddingNorm(pseudoVec())).toBeGreaterThan(20);
  });
});

describe("classifyEmbeddingProvenance", () => {
  it("labels a unit-norm 1536-dim vector as the real model", () => {
    const p = classifyEmbeddingProvenance(1.0, DIM);
    expect(p.model).toBe(CURRENT_EMBEDDING.model);
    expect(p.normalized).toBe(true);
    expect(p.dimensions).toBe(DIM);
    expect(p.version).toBe(CURRENT_EMBEDDING.version);
  });

  it("labels a pseudo (norm ~22) vector as pseudo-fallback / hash-pseudo", () => {
    const p = classifyEmbeddingProvenance(21.9, DIM);
    expect(p.model).toBe(PSEUDO_FALLBACK_MODEL);
    expect(p.normalized).toBe(false);
    expect(p.version).toBe("hash-pseudo");
  });

  it("labels a zero vector as pseudo-fallback / zero-vector", () => {
    const p = classifyEmbeddingProvenance(0, DIM);
    expect(p.model).toBe(PSEUDO_FALLBACK_MODEL);
    expect(p.normalized).toBe(false);
    expect(p.version).toBe("zero-vector");
  });

  it("rejects a unit-norm vector of the wrong dimension", () => {
    const p = classifyEmbeddingProvenance(1.0, 768);
    expect(p.model).toBe(PSEUDO_FALLBACK_MODEL);
    expect(p.normalized).toBe(false);
  });
});

describe("isQueryEmbeddingValid", () => {
  it("accepts a real unit-norm 1536-dim vector", () => {
    expect(isQueryEmbeddingValid(unitVec())).toBe(true);
  });

  it("rejects pseudo, zero, and wrong-dim vectors", () => {
    expect(isQueryEmbeddingValid(pseudoVec())).toBe(false);
    expect(isQueryEmbeddingValid(constVec(0, DIM))).toBe(false);
    expect(isQueryEmbeddingValid(unitVec(768))).toBe(false);
  });
});

describe("assertQueryEmbeddingProvenance", () => {
  it("passes a real unit-norm query vector", () => {
    expect(() => assertQueryEmbeddingProvenance(unitVec())).not.toThrow();
  });

  it("throws EmbeddingProvenanceError on a pseudo-fallback vector", () => {
    try {
      assertQueryEmbeddingProvenance(pseudoVec());
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EmbeddingProvenanceError);
      expect((e as EmbeddingProvenanceError).norm).toBeGreaterThan(20);
      expect((e as EmbeddingProvenanceError).dimensions).toBe(DIM);
    }
  });

  it("throws on a zero vector (empty-text fallback)", () => {
    expect(() => assertQueryEmbeddingProvenance(constVec(0, DIM))).toThrow(
      EmbeddingProvenanceError
    );
  });

  it("throws on a wrong-dimension vector before any cosine", () => {
    try {
      assertQueryEmbeddingProvenance(unitVec(768));
      throw new Error("expected throw");
    } catch (e) {
      expect(e).toBeInstanceOf(EmbeddingProvenanceError);
      expect((e as EmbeddingProvenanceError).dimensions).toBe(768);
    }
  });
});
