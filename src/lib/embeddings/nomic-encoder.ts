/**
 * Local nomic-embed-text-v1.5 encoder (dv0.5.2) via Transformers.js (ONNX in
 * Node — no torch, no Python). fastembed-js does not ship nomic, so this is the
 * single-language path. The pipeline is loaded once (lazy singleton); it
 * downloads the model from Hugging Face on first use, so this runs on the larger
 * batch instance, never the 512MB web container.
 */
import { pipeline, type FeatureExtractionPipeline } from "@huggingface/transformers";
import { DOCUMENT_PREFIX, type Encoder } from "./encoder";
import { NOMIC_EMBED, embeddingNorm, NORM_MIN, NORM_MAX } from "./provenance";

const MODEL_ID = "nomic-ai/nomic-embed-text-v1.5";

// Per-input char cap — a cheap pre-filter so the tokenizer never sees a
// pathological multi-KB string. Slightly above buildItemText's 8000-char doc
// cap so the normal doc path is never double-trimmed; this only bites a direct/
// query caller that bypassed buildItemText.
const MAX_ENCODER_INPUT_CHARS = 8192;

// Hard TOKEN budget — the real OOM guard, since chars don't bound tokens for
// CJK/dense text. ~2000 tokens fits the English doc budget while bounding the
// O(n^2) attention tensor when batched.
const MAX_INPUT_TOKENS = 2048;

// Minimal view of the transformers.js tokenizer for token-level truncation.
// tok(text, {truncation, max_length}) returns input_ids as a [1, N] Tensor;
// .tolist()[0] is the id array, which decode() turns back into bounded text.
interface TruncatingTokenizer {
  (text: string, opts: { truncation: boolean; max_length: number }): {
    input_ids: { tolist(): number[][] };
  };
  decode(ids: number[], opts: { skip_special_tokens: boolean }): string;
}

// Pin the model revision for reproducibility: a re-download of a changed `main`
// would produce different vectors while source_hash (over the same input) still
// matches, so resume would silently SKIP re-embedding the drifted rows. The ops
// backfill (dv0.5.8) sets NOMIC_MODEL_REVISION to a specific commit SHA before
// the real run; unset = `main` (acceptable only for local experimentation).
const MODEL_REVISION = process.env.NOMIC_MODEL_REVISION || "main";

export class NomicEncoder implements Encoder {
  readonly modelName = NOMIC_EMBED.model;
  readonly version = NOMIC_EMBED.version;
  readonly documentPrefix = DOCUMENT_PREFIX;

  // Cache the in-flight Promise, not the resolved value, so concurrent callers
  // share one model load instead of racing two downloads/ONNX instances.
  private extractorPromise: Promise<FeatureExtractionPipeline> | null = null;

  private getExtractor(): Promise<FeatureExtractionPipeline> {
    if (!this.extractorPromise) {
      this.extractorPromise = pipeline("feature-extraction", MODEL_ID, {
        revision: MODEL_REVISION,
      }).catch((err) => {
        // Don't cache a rejected load — a transient HF/network failure would
        // otherwise permanently break a long-running process (e.g. the MCP
        // daemon). Reset so the next call retries the download.
        this.extractorPromise = null;
        throw err;
      });
    }
    return this.extractorPromise;
  }

  async embedDocuments(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }
    const extractor = await this.getExtractor();
    const tokenizer = extractor.tokenizer as unknown as TruncatingTokenizer;
    // Bound each input to MAX_INPUT_TOKENS *tokens* before the model sees it.
    // The tokenizer's model_max_length is 8192 and getter-only (can't lower it),
    // and CJK / HTML-dense text tokenizes ~1 token/char — so a char-capped
    // 8000-char item is still ~8000 tokens, and a batch of those makes the
    // encoder's O(n^2) attention allocate tens of GB at once and OOM-kill the
    // process (the dv0.5.8 Japanese-items stall). Truncating by tokens
    // (tokenize → decode) leaves short English items untouched while capping the
    // dense ones. The char cap is a cheap pre-filter so we never tokenize a
    // pathological multi-KB string.
    const bounded = texts.map((raw) => {
      const text = raw.length > MAX_ENCODER_INPUT_CHARS ? raw.substring(0, MAX_ENCODER_INPUT_CHARS) : raw;
      const ids = tokenizer(text, { truncation: true, max_length: MAX_INPUT_TOKENS }).input_ids.tolist()[0];
      return tokenizer.decode(ids, { skip_special_tokens: true });
    });
    // nomic is natively 768d, so mean-pooling + L2-normalize yields the final
    // unit vector with no Matryoshka truncation needed.
    const output = await extractor(bounded, { pooling: "mean", normalize: true });
    // Boundary cast: Tensor.tolist() is typed any[]; for a [batch, 768] pooled
    // tensor it is number[][]. The per-vector dim/norm checks below validate it.
    const vectors = output.tolist() as unknown as number[][];

    // Verify the metric-space contract AT THE SOURCE (architect H1): a
    // misconfigured pooling/normalize would otherwise be silently stored as
    // embedding_normalized=false by the lenient storage layer and skipped
    // forever on resume. Fail loudly instead.
    for (const v of vectors) {
      if (v.length !== NOMIC_EMBED.dimensions) {
        throw new Error(
          `NomicEncoder produced ${v.length} dims, expected ${NOMIC_EMBED.dimensions}`,
        );
      }
      const norm = embeddingNorm(v);
      if (norm < NORM_MIN || norm > NORM_MAX) {
        throw new Error(
          `NomicEncoder produced a non-unit vector (norm ${norm.toFixed(4)}, band [${NORM_MIN}, ${NORM_MAX}]) — ` +
            `pooling/normalize misconfigured`,
        );
      }
    }
    return vectors;
  }
}
