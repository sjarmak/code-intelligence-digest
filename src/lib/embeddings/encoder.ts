/**
 * Encoder abstraction for the local-embedding migration (dv0.5).
 *
 * The job orchestration (model-embed-job.ts) depends on this interface, not a
 * concrete model, so it is unit-testable with a fake encoder while the real
 * NomicEncoder runs ONNX it cannot execute in CI.
 */

/**
 * nomic-embed-text-v1.5 task-instruction prefixes. Both are pinned here as the
 * cross-bead contract: dv0.5.2 embeds documents with DOCUMENT_PREFIX; the
 * serve-flip (dv0.5.4) MUST embed queries with QUERY_PREFIX and the same model
 * config. A doc/query mismatch yields unit-norm 768d vectors that the norm+dim
 * provenance guard cannot detect — a silent metric skew.
 */
export const DOCUMENT_PREFIX = "search_document: ";
export const QUERY_PREFIX = "search_query: ";

export interface Encoder {
  /** Model identity stored in item_model_embeddings.model_name. */
  readonly modelName: string;
  /** Provenance version label stored in item_model_embeddings.embedding_version. */
  readonly version: string;
  /** Task prefix prepended to each document; part of the hashed encoder input. */
  readonly documentPrefix: string;
  /** Embed already-prefixed inputs verbatim — one vector per input, same order. */
  embedDocuments(texts: string[]): Promise<number[][]>;
}
