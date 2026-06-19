/**
 * dv0.5.5: generate.ts must never produce a non-semantic vector. Previously a
 * missing OpenAI client / API failure / empty text degraded to a hash-pseudo
 * (padded 768->1536) or a zero vector, which still passed every caller's
 * length===1536 guard and got persisted — poisoning cosine results. The
 * contract is now: generateEmbedding THROWS EmbeddingUnavailableError, and
 * generateEmbeddingsBatch OMITS items it could not embed (never inserts a
 * fabricated vector). The OpenAI generation path itself is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const { clientMock } = vi.hoisted(() => ({ clientMock: vi.fn() }));

vi.mock("@/src/lib/llm/client", () => ({
  getOpenAICompatibleClient: () => clientMock(),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  generateEmbedding,
  generateEmbeddingsBatch,
  generateQueryEmbedding,
} from "@/src/lib/embeddings/generate";
import { EmbeddingUnavailableError } from "@/src/lib/embeddings/provenance";

/** A fake OpenAI-compatible client whose embeddings.create returns 1536d vectors. */
function fakeClient(vectorFor: (input: string) => number[] | null) {
  return {
    embeddings: {
      create: vi.fn(async ({ input }: { input: string | string[] }) => {
        const inputs = Array.isArray(input) ? input : [input];
        return { data: inputs.map((t) => ({ embedding: vectorFor(t) ?? [] })) };
      }),
    },
  };
}

const realVec = () => Array.from({ length: 1536 }, () => 0.01);

beforeEach(() => {
  clientMock.mockReset();
});

describe("generateEmbedding — no fabricated vectors", () => {
  it("returns the genuine OpenAI vector when the client succeeds", async () => {
    clientMock.mockReturnValue(fakeClient(() => realVec()));
    const vec = await generateEmbedding("hello world");
    expect(vec).toHaveLength(1536);
  });

  it("throws (no pseudo) when no OpenAI client is configured", async () => {
    clientMock.mockReturnValue(null);
    await expect(generateEmbedding("hello world")).rejects.toBeInstanceOf(
      EmbeddingUnavailableError,
    );
  });

  it("throws (no pseudo) when the OpenAI call fails", async () => {
    const client = fakeClient(() => realVec());
    client.embeddings.create = vi.fn(async () => {
      throw new Error("429 rate limited");
    });
    clientMock.mockReturnValue(client);
    await expect(generateEmbedding("hello world")).rejects.toBeInstanceOf(
      EmbeddingUnavailableError,
    );
  });

  it("throws (no zero vector) on empty text", async () => {
    clientMock.mockReturnValue(fakeClient(() => realVec()));
    await expect(generateEmbedding("   ")).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });

  it("generateQueryEmbedding propagates the unavailable error", async () => {
    clientMock.mockReturnValue(null);
    await expect(generateQueryEmbedding("q")).rejects.toBeInstanceOf(EmbeddingUnavailableError);
  });
});

describe("generateEmbeddingsBatch — omits, never fabricates", () => {
  it("returns an empty map when no client is configured (no zero/pseudo rows)", async () => {
    clientMock.mockReturnValue(null);
    const out = await generateEmbeddingsBatch([
      { id: "a", text: "alpha" },
      { id: "b", text: "beta" },
    ]);
    expect(out.size).toBe(0);
  });

  it("omits only the items the API could not embed, keeping the rest genuine", async () => {
    // Returns a real vector for everything except "beta" (empty embedding).
    clientMock.mockReturnValue(fakeClient((t) => (t.includes("beta") ? null : realVec())));
    const out = await generateEmbeddingsBatch([
      { id: "a", text: "alpha" },
      { id: "b", text: "beta" },
      { id: "c", text: "gamma" },
    ]);

    expect(out.has("a")).toBe(true);
    expect(out.has("c")).toBe(true);
    expect(out.has("b")).toBe(false); // omitted, not a zero vector
    for (const vec of out.values()) {
      expect(vec).toHaveLength(1536);
      expect(vec.some((x) => x !== 0)).toBe(true); // never an all-zero fabrication
    }
  });
});
