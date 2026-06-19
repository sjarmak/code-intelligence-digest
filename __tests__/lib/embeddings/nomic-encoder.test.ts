/**
 * Real-model integration test for NomicEncoder (dv0.5.2, architect H4).
 *
 * Gated behind RUN_ENCODER_INTEGRATION=1 because it downloads the nomic ONNX
 * model from Hugging Face (~hundreds of MB) and runs onnxruntime-node — not
 * viable in CI / a no-network sandbox. THIS IS THE ONLY automated check of the
 * real encoder's pooling/normalize/dim; run it (locally or on the Render box)
 * before relying on the encoder for the dv0.5.3 backfill.
 *
 *   RUN_ENCODER_INTEGRATION=1 npx vitest run __tests__/lib/embeddings/nomic-encoder.test.ts
 */
import { describe, it, expect } from "vitest";
import { NomicEncoder } from "@/src/lib/embeddings/nomic-encoder";
import { embeddingNorm, NOMIC_EMBED } from "@/src/lib/embeddings/provenance";

const RUN = process.env.RUN_ENCODER_INTEGRATION === "1";

describe.skipIf(!RUN)("NomicEncoder (real model)", () => {
  it("produces 768d unit-norm vectors, one per input", async () => {
    const enc = new NomicEncoder();
    const vecs = await enc.embedDocuments([
      `${enc.documentPrefix}the quick brown fox`,
      `${enc.documentPrefix}a totally different sentence about databases`,
    ]);
    expect(vecs).toHaveLength(2);
    for (const v of vecs) {
      expect(v).toHaveLength(NOMIC_EMBED.dimensions);
      expect(embeddingNorm(v)).toBeCloseTo(1, 2);
    }
  }, 120_000);

  it("is prefix-sensitive (document vs query prefix → different vectors)", async () => {
    const enc = new NomicEncoder();
    const [doc] = await enc.embedDocuments(["search_document: machine learning"]);
    const [query] = await enc.embedDocuments(["search_query: machine learning"]);
    expect(doc).not.toEqual(query);
  }, 120_000);
});
