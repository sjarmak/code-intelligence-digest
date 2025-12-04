/**
 * BM25 scoring implementation
 * Hybrid scoring pipeline uses BM25 for term-based relevance
 */

import { FeedItem } from "../model";

interface BM25Config {
  k1?: number; // Term frequency saturation (default: 1.5)
  b?: number; // Length normalization (default: 0.75)
}

/**
 * Simple BM25 implementation
 */
export class BM25Index {
  private docs: { id: string; text: string }[] = [];
  private docFreq: Map<string, Set<string>> = new Map(); // term -> set of doc IDs
  private termFreq: Map<string, Map<string, number>> = new Map(); // docId -> (term -> count)
  private docLengths: Map<string, number> = new Map(); // docId -> token count
  private avgDocLength: number = 0;
  private k1: number;
  private b: number;

  constructor(config: BM25Config = {}) {
    this.k1 = config.k1 ?? 1.5;
    this.b = config.b ?? 0.75;
  }

  /**
   * Tokenize and normalize text
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .match(/\b\w+\b/g)
      ?.map((t) => t.trim())
      .filter((t) => t.length > 0) ?? [];
  }

  /**
   * Add documents to the index
   */
  addDocuments(items: FeedItem[]): void {
    let totalLength = 0;

    for (const item of items) {
      const docId = item.id;
      const docText = `${item.title} ${item.summary || ""} ${item.sourceTitle} ${item.categories.join(" ")}`;
      const tokens = this.tokenize(docText);

      this.docs.push({ id: docId, text: docText });
      this.docLengths.set(docId, tokens.length);
      totalLength += tokens.length;

      // Build term frequency map for this document
      const tfMap = new Map<string, number>();
      for (const token of tokens) {
        tfMap.set(token, (tfMap.get(token) ?? 0) + 1);
      }
      this.termFreq.set(docId, tfMap);

      // Update document frequency
      const uniqueTerms = new Set(tokens);
      for (const term of uniqueTerms) {
        if (!this.docFreq.has(term)) {
          this.docFreq.set(term, new Set());
        }
        this.docFreq.get(term)!.add(docId);
      }
    }

    if (this.docs.length > 0) {
      this.avgDocLength = totalLength / this.docs.length;
    }
  }

  /**
   * Score documents against a query
   */
  score(query: string): Map<string, number> {
    const scores = new Map<string, number>();
    const N = this.docs.length;

    if (N === 0) return scores;

    const queryTokens = this.tokenize(query);
    const uniqueQueryTerms = new Set(queryTokens);

    for (const docId of this.docLengths.keys()) {
      let docScore = 0;
      const docLen = this.docLengths.get(docId) ?? 0;
      const tfMap = this.termFreq.get(docId) ?? new Map();

      for (const term of uniqueQueryTerms) {
        const tf = tfMap.get(term) ?? 0;
        const df = this.docFreq.get(term)?.size ?? 0;

        if (df === 0) continue; // Term not in any doc

        // BM25 formula
        const idf = Math.log((N - df + 0.5) / (df + 0.5) + 1);
        const normLen = 1 - this.b + this.b * (docLen / this.avgDocLength);
        const numerator = tf * (this.k1 + 1);
        const denominator = tf + this.k1 * normLen;

        docScore += idf * (numerator / denominator);
      }

      if (docScore > 0) {
        scores.set(docId, docScore);
      }
    }

    return scores;
  }

  /**
   * Normalize scores to [0, 1]
   */
  normalizeScores(scores: Map<string, number>): Map<string, number> {
    const maxScore = Math.max(...scores.values(), 1);
    const normalized = new Map<string, number>();

    for (const [id, score] of scores) {
      normalized.set(id, Math.min(1, score / maxScore));
    }

    return normalized;
  }
}
