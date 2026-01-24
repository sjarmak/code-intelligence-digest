/**
 * Consolidated domain term configuration
 *
 * This module provides a single source of truth for domain-specific terms
 * used in BM25 scoring and relevance calculations. Terms are categorized
 * and weighted to boost relevance when they appear in content.
 *
 * Weight tiers:
 * - 1.6x: Code Search - primary focus area
 * - 1.5x: Information Retrieval & Context Management - core AI/ML concepts
 * - 1.4x: Agentic Workflows - emerging paradigm
 * - 1.3x: Enterprise Codebases - scale and complexity
 * - 1.2x: Developer Tools & LLM Architecture - supporting topics
 * - 1.0x: SDLC Processes - general development
 */

/**
 * Domain term category identifiers
 */
export type DomainCategory =
  | "code_search"
  | "ir"
  | "context"
  | "agentic"
  | "enterprise"
  | "devtools"
  | "llm_code"
  | "sdlc";

/**
 * A domain term with its weight and category
 */
export interface DomainTerm {
  term: string;
  weight: number;
  category: DomainCategory;
}

/**
 * Category metadata including description and default weight
 */
export interface DomainCategoryConfig {
  category: DomainCategory;
  description: string;
  weight: number;
}

/**
 * Domain category configurations with descriptions and weights
 */
export const DOMAIN_CATEGORIES: readonly DomainCategoryConfig[] = [
  {
    category: "code_search",
    description: "Code search and navigation capabilities",
    weight: 1.6,
  },
  {
    category: "ir",
    description: "Information retrieval and vector search",
    weight: 1.5,
  },
  {
    category: "context",
    description: "Context window and token management",
    weight: 1.5,
  },
  {
    category: "agentic",
    description: "Agentic workflows and tool use",
    weight: 1.4,
  },
  {
    category: "enterprise",
    description: "Enterprise codebase patterns",
    weight: 1.3,
  },
  {
    category: "devtools",
    description: "Developer tools and productivity",
    weight: 1.2,
  },
  {
    category: "llm_code",
    description: "LLM architecture for code",
    weight: 1.2,
  },
  {
    category: "sdlc",
    description: "Software development lifecycle",
    weight: 1.0,
  },
] as const;

/**
 * Consolidated domain terms from bm25.ts and categories.ts
 *
 * Terms are merged from both sources with weights resolved to a single value.
 * When conflicts exist, the higher weight is used (more specific term).
 */
export const DOMAIN_TERMS: readonly DomainTerm[] = [
  // Code Search (1.6x) - Primary focus area
  { term: "code search", weight: 1.6, category: "code_search" },
  { term: "symbol search", weight: 1.6, category: "code_search" },
  { term: "codebase search", weight: 1.6, category: "code_search" },
  { term: "code navigation", weight: 1.6, category: "code_search" },
  { term: "cross-reference", weight: 1.6, category: "code_search" },
  { term: "cross-references", weight: 1.6, category: "code_search" },
  { term: "symbol indexing", weight: 1.6, category: "code_search" },
  { term: "code indexing", weight: 1.6, category: "code_search" },
  { term: "indexing", weight: 1.6, category: "code_search" },
  { term: "function lookup", weight: 1.6, category: "code_search" },
  { term: "variable tracking", weight: 1.6, category: "code_search" },
  { term: "semantic code", weight: 1.6, category: "code_search" },
  { term: "symbols", weight: 1.6, category: "code_search" },

  // Information Retrieval (1.5x) - Core AI/ML concepts
  { term: "semantic search", weight: 1.5, category: "ir" },
  { term: "rag", weight: 1.5, category: "ir" },
  { term: "RAG", weight: 1.5, category: "ir" },
  { term: "retrieval augmented", weight: 1.5, category: "ir" },
  { term: "vector database", weight: 1.5, category: "ir" },
  { term: "vector databases", weight: 1.5, category: "ir" },
  { term: "vector search", weight: 1.5, category: "ir" },
  { term: "embeddings", weight: 1.5, category: "ir" },
  { term: "similarity search", weight: 1.5, category: "ir" },
  { term: "dense retrieval", weight: 1.5, category: "ir" },
  { term: "information retrieval", weight: 1.5, category: "ir" },
  { term: "relevance ranking", weight: 1.5, category: "ir" },
  { term: "corpus", weight: 1.5, category: "ir" },

  // Context Management (1.5x) - Context window handling
  { term: "context window", weight: 1.5, category: "context" },
  { term: "context management", weight: 1.5, category: "context" },
  { term: "token budget", weight: 1.5, category: "context" },
  { term: "context length", weight: 1.5, category: "context" },
  { term: "compression", weight: 1.5, category: "context" },
  { term: "summarization", weight: 1.5, category: "context" },
  { term: "chunking", weight: 1.5, category: "context" },
  { term: "prompt optimization", weight: 1.5, category: "context" },
  { term: "long context", weight: 1.5, category: "context" },
  { term: "token limit", weight: 1.5, category: "context" },

  // Agentic Workflows (1.4x) - Emerging paradigm
  { term: "agent", weight: 1.4, category: "agentic" },
  { term: "agents", weight: 1.4, category: "agentic" },
  { term: "agentic", weight: 1.4, category: "agentic" },
  { term: "tool use", weight: 1.4, category: "agentic" },
  { term: "planning", weight: 1.4, category: "agentic" },
  { term: "orchestration", weight: 1.4, category: "agentic" },
  { term: "workflow", weight: 1.4, category: "agentic" },
  { term: "multi-step", weight: 1.4, category: "agentic" },
  { term: "reasoning loop", weight: 1.4, category: "agentic" },
  { term: "agent framework", weight: 1.4, category: "agentic" },
  { term: "tool calling", weight: 1.4, category: "agentic" },

  // Enterprise Codebases (1.3x) - Scale and complexity
  { term: "monorepo", weight: 1.3, category: "enterprise" },
  { term: "monolithic", weight: 1.3, category: "enterprise" },
  { term: "dependency management", weight: 1.3, category: "enterprise" },
  { term: "modularization", weight: 1.3, category: "enterprise" },
  { term: "enterprise scale", weight: 1.3, category: "enterprise" },
  { term: "scale", weight: 1.3, category: "enterprise" },
  { term: "large codebase", weight: 1.3, category: "enterprise" },
  { term: "legacy system", weight: 1.3, category: "enterprise" },
  { term: "legacy systems", weight: 1.3, category: "enterprise" },
  { term: "refactoring", weight: 1.3, category: "enterprise" },
  { term: "migration", weight: 1.3, category: "enterprise" },
  { term: "scalability", weight: 1.3, category: "enterprise" },

  // Developer Tools (1.2x) - Supporting topics
  { term: "ide", weight: 1.2, category: "devtools" },
  { term: "IDE", weight: 1.2, category: "devtools" },
  { term: "debugging", weight: 1.2, category: "devtools" },
  { term: "profiling", weight: 1.2, category: "devtools" },
  { term: "linter", weight: 1.2, category: "devtools" },
  { term: "formatter", weight: 1.2, category: "devtools" },
  { term: "test framework", weight: 1.2, category: "devtools" },
  { term: "ci/cd", weight: 1.2, category: "devtools" },
  { term: "CI/CD", weight: 1.2, category: "devtools" },
  { term: "devops", weight: 1.2, category: "devtools" },
  { term: "automation", weight: 1.2, category: "devtools" },
  { term: "developer experience", weight: 1.2, category: "devtools" },
  { term: "dev productivity", weight: 1.2, category: "devtools" },

  // LLM Code Architecture (1.2x) - Model internals
  { term: "llm", weight: 1.2, category: "llm_code" },
  { term: "transformer", weight: 1.2, category: "llm_code" },
  { term: "transformers", weight: 1.2, category: "llm_code" },
  { term: "fine-tuning", weight: 1.2, category: "llm_code" },
  { term: "function calling", weight: 1.2, category: "llm_code" },
  { term: "code generation", weight: 1.2, category: "llm_code" },
  { term: "code completion", weight: 1.2, category: "llm_code" },
  { term: "neural", weight: 1.2, category: "llm_code" },
  { term: "reasoning pattern", weight: 1.2, category: "llm_code" },
  { term: "reasoning", weight: 1.2, category: "llm_code" },
  { term: "training data", weight: 1.2, category: "llm_code" },
  { term: "model architecture", weight: 1.2, category: "llm_code" },

  // SDLC Processes (1.0x) - General development
  { term: "code review", weight: 1.0, category: "sdlc" },
  { term: "testing", weight: 1.0, category: "sdlc" },
  { term: "test suite", weight: 1.0, category: "sdlc" },
  { term: "unit test", weight: 1.0, category: "sdlc" },
  { term: "integration test", weight: 1.0, category: "sdlc" },
  { term: "deployment", weight: 1.0, category: "sdlc" },
  { term: "release", weight: 1.0, category: "sdlc" },
  { term: "version control", weight: 1.0, category: "sdlc" },
  { term: "git", weight: 1.0, category: "sdlc" },
  { term: "pull request", weight: 1.0, category: "sdlc" },
  { term: "change management", weight: 1.0, category: "sdlc" },
] as const;

/**
 * Get all terms for a specific category
 */
export function getTermsForCategory(category: DomainCategory): readonly DomainTerm[] {
  return DOMAIN_TERMS.filter((t) => t.category === category);
}

/**
 * Get term weight by term string (case-insensitive lookup)
 * Returns 1.0 if term not found
 */
export function getTermWeight(term: string): number {
  const lowerTerm = term.toLowerCase();
  const found = DOMAIN_TERMS.find((t) => t.term.toLowerCase() === lowerTerm);
  return found?.weight ?? 1.0;
}

/**
 * Build a term-to-weight lookup map for efficient scoring
 * Keys are lowercase for case-insensitive matching
 */
export function buildTermWeightMap(): Map<string, number> {
  const map = new Map<string, number>();
  for (const { term, weight } of DOMAIN_TERMS) {
    const key = term.toLowerCase();
    // Keep the higher weight if duplicate
    const existing = map.get(key);
    if (!existing || weight > existing) {
      map.set(key, weight);
    }
  }
  return map;
}

/**
 * Group terms by category for BM25 query construction
 * Returns the same structure as the original DOMAIN_TERMS in bm25.ts
 */
export function getTermsByCategory(): Record<DomainCategory, { weight: number; terms: string[] }> {
  const result: Record<DomainCategory, { weight: number; terms: string[] }> = {
    code_search: { weight: 1.6, terms: [] },
    ir: { weight: 1.5, terms: [] },
    context: { weight: 1.5, terms: [] },
    agentic: { weight: 1.4, terms: [] },
    enterprise: { weight: 1.3, terms: [] },
    devtools: { weight: 1.2, terms: [] },
    llm_code: { weight: 1.2, terms: [] },
    sdlc: { weight: 1.0, terms: [] },
  };

  // Build unique terms per category (avoid duplicates from plural forms)
  const seenTerms = new Map<DomainCategory, Set<string>>();
  for (const cat of Object.keys(result) as DomainCategory[]) {
    seenTerms.set(cat, new Set());
  }

  for (const { term, category } of DOMAIN_TERMS) {
    const lowerTerm = term.toLowerCase();
    const seen = seenTerms.get(category)!;
    if (!seen.has(lowerTerm)) {
      seen.add(lowerTerm);
      result[category].terms.push(term);
    }
  }

  return result;
}
