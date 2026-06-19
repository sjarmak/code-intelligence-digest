/**
 * The nomic task-instruction prefixes are a cross-bead contract (architect H2):
 * dv0.5.2 embeds documents with DOCUMENT_PREFIX; the serve-flip (dv0.5.4) must
 * embed queries with QUERY_PREFIX. A mismatch produces a silent metric skew the
 * norm+dim provenance guard cannot detect, so both are pinned here now.
 */
import { describe, it, expect } from "vitest";
import { DOCUMENT_PREFIX, QUERY_PREFIX } from "@/src/lib/embeddings/encoder";

describe("nomic task prefixes", () => {
  it("uses the nomic-specified document/query prefixes", () => {
    expect(DOCUMENT_PREFIX).toBe("search_document: ");
    expect(QUERY_PREFIX).toBe("search_query: ");
  });

  it("document and query prefixes differ (asymmetric retrieval)", () => {
    expect(DOCUMENT_PREFIX).not.toBe(QUERY_PREFIX);
  });
});
