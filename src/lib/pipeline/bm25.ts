/**
 * BM25 ranking pipeline
 * Scores items using domain-aware term matching
 */

import { Category } from "../model";

/**
 * Domain term categories with weights
 * Weights are multipliers applied during scoring
 */
const DOMAIN_TERMS = {
  code_search: {
    weight: 1.6,
    terms: [
      "code search",
      "symbol search",
      "codebase search",
      "code navigation",
      "cross-reference",
      "symbol indexing",
      "code indexing",
      "function lookup",
      "variable tracking",
      "semantic code",
    ],
  },
  ir: {
    weight: 1.5,
    terms: [
      "semantic search",
      "rag",
      "retrieval augmented",
      "vector database",
      "embeddings",
      "similarity search",
      "dense retrieval",
      "information retrieval",
      "relevance ranking",
      "corpus",
    ],
  },
  context: {
    weight: 1.5,
    terms: [
      "context window",
      "token budget",
      "context length",
      "compression",
      "summarization",
      "chunking",
      "prompt optimization",
      "context management",
      "long context",
      "token limit",
    ],
  },
  agentic: {
    weight: 1.4,
    terms: [
      "agent",
      "agentic",
      "tool use",
      "planning",
      "orchestration",
      "workflow",
      "multi-step",
      "reasoning loop",
      "agent framework",
      "tool calling",
    ],
  },
  enterprise: {
    weight: 1.3,
    terms: [
      "monorepo",
      "monolithic",
      "dependency management",
      "modularization",
      "enterprise scale",
      "large codebase",
      "legacy system",
      "refactoring",
      "migration",
      "scalability",
    ],
  },
  devtools: {
    weight: 1.2,
    terms: [
      "ide",
      "debugging",
      "profiling",
      "linter",
      "formatter",
      "test framework",
      "ci/cd",
      "devops",
      "automation",
      "developer experience",
    ],
  },
  llm_code: {
    weight: 1.2,
    terms: [
      "llm",
      "transformer",
      "fine-tuning",
      "function calling",
      "code generation",
      "code completion",
      "neural",
      "reasoning pattern",
      "training data",
      "model architecture",
    ],
  },
  sdlc: {
    weight: 1.0,
    terms: [
      "code review",
      "testing",
      "test suite",
      "unit test",
      "integration test",
      "deployment",
      "release",
      "version control",
      "git",
      "pull request",
    ],
  },
};

/**
 * Category-specific BM25 queries built from domain terms
 * Each category gets a weighted combination of relevant domain terms
 */
const CATEGORY_QUERIES: Record<Category, { terms: string[]; weight: number }[]> = {
  newsletters: [
    { terms: DOMAIN_TERMS.code_search.terms, weight: 1.6 },
    { terms: DOMAIN_TERMS.ir.terms, weight: 1.5 },
    { terms: DOMAIN_TERMS.devtools.terms, weight: 1.2 },
  ],
  podcasts: [
    { terms: DOMAIN_TERMS.agentic.terms, weight: 1.4 },
    { terms: DOMAIN_TERMS.code_search.terms, weight: 1.6 },
    { terms: DOMAIN_TERMS.devtools.terms, weight: 1.2 },
  ],
  tech_articles: [
    { terms: DOMAIN_TERMS.code_search.terms, weight: 1.6 },
    { terms: DOMAIN_TERMS.ir.terms, weight: 1.5 },
    { terms: DOMAIN_TERMS.context.terms, weight: 1.5 },
    { terms: DOMAIN_TERMS.agentic.terms, weight: 1.4 },
  ],
  ai_news: [
    { terms: DOMAIN_TERMS.llm_code.terms, weight: 1.2 },
    { terms: DOMAIN_TERMS.agentic.terms, weight: 1.4 },
    { terms: DOMAIN_TERMS.ir.terms, weight: 1.5 },
  ],
  product_news: [
    { terms: DOMAIN_TERMS.devtools.terms, weight: 1.2 },
    { terms: DOMAIN_TERMS.code_search.terms, weight: 1.6 },
    { terms: DOMAIN_TERMS.enterprise.terms, weight: 1.3 },
  ],
  community: [
    { terms: DOMAIN_TERMS.code_search.terms, weight: 1.6 },
    { terms: DOMAIN_TERMS.agentic.terms, weight: 1.4 },
    { terms: DOMAIN_TERMS.devtools.terms, weight: 1.2 },
  ],
  research: [
    { terms: DOMAIN_TERMS.ir.terms, weight: 1.5 },
    { terms: DOMAIN_TERMS.llm_code.terms, weight: 1.2 },
    { terms: DOMAIN_TERMS.context.terms, weight: 1.5 },
  ],
};

/**
 * Simple BM25 implementation
 * Based on the standard BM25 algorithm
 */
export class BM25Index {
  private documents: Map<string, string> = new Map(); // id -> text
  private docFreq: Map<string, Set<string>> = new Map(); // term -> set of doc ids
  private docLengths: Map<string, number> = new Map();
  private avgDocLength: number = 0;
  private totalDocs: number = 0;

  private readonly K1 = 1.5; // saturation parameter
  private readonly B = 0.75; // length normalization

  /**
   * Add documents to the index
   */
  addDocuments(items: Array<{ id: string; title?: string; summary?: string; sourceTitle?: string; categories?: string[] }>) {
    this.documents.clear();
    this.docFreq.clear();
    this.docLengths.clear();

    for (const item of items) {
      const id = item.id;
      const doc = this.itemToDocument(item);
      this.documents.set(id, doc);

      const tokens = this.tokenize(doc);
      this.docLengths.set(id, tokens.length);

      const uniqueTokens = new Set(tokens);
      for (const token of uniqueTokens) {
        if (!this.docFreq.has(token)) {
          this.docFreq.set(token, new Set());
        }
        this.docFreq.get(token)!.add(id);
      }
    }

    this.totalDocs = items.length;
    const totalLength = Array.from(this.docLengths.values()).reduce(
      (a, b) => a + b,
      0
    );
    this.avgDocLength =
      totalLength / Math.max(this.totalDocs, 1);
  }

  /**
   * Score items for a query
   */
  score(queryTerms: string[]): Map<string, number> {
    const scores = new Map<string, number>();

    for (const docId of this.documents.keys()) {
      scores.set(docId, 0);
    }

    for (const term of queryTerms) {
      const idf = this.idf(term);
      const docsWithTerm = this.docFreq.get(term.toLowerCase()) || new Set();

      for (const docId of docsWithTerm) {
        const docText = this.documents.get(docId)!;
        const docTokens = this.tokenize(docText);
        const termFreq = docTokens.filter((t) => t === term.toLowerCase()).length;
        const docLen = this.docLengths.get(docId) || 0;

        // BM25 formula
        const numerator = termFreq * (this.K1 + 1);
        const denominator =
          termFreq +
          this.K1 *
            (1 -
              this.B +
              this.B * (docLen / this.avgDocLength));

        const currentScore = scores.get(docId) || 0;
        scores.set(docId, currentScore + idf * (numerator / denominator));
      }
    }

    return scores;
  }

  /**
   * Normalize scores to [0, 1]
   */
  normalizeScores(scores: Map<string, number>): Map<string, number> {
    const values = Array.from(scores.values());
    const max = Math.max(...values, 1);
    const normalized = new Map<string, number>();

    for (const [id, score] of scores) {
      normalized.set(id, Math.min(score / max, 1.0));
    }

    return normalized;
  }

  /**
   * Convert item to searchable document text
   */
  private itemToDocument(item: { title?: string; summary?: string; sourceTitle?: string; categories?: string[] }): string {
    const parts = [
      item.title || "",
      item.summary || "",
      item.sourceTitle || "",
      (item.categories || []).join(" "),
    ];
    return parts.filter((p) => p).join(" ");
  }

  /**
   * Tokenize text into lowercase terms
   */
  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .match(/\b\w+\b/g)
      ?.filter((t) => t.length > 2) || [];
  }

  /**
   * Inverse document frequency
   */
  private idf(term: string): number {
    const n = this.docFreq.get(term.toLowerCase())?.size || 0;
    return Math.log((this.totalDocs - n + 0.5) / (n + 0.5) + 1);
  }
}

/**
 * Get domain term query for a category
 */
export function getQueryForCategory(category: Category): string[] {
  const queries = CATEGORY_QUERIES[category] || [];
  return queries.flatMap((q) => q.terms);
}
