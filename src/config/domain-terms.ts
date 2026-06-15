/**
 * Consolidated domain term configuration
 *
 * Single source of truth for the domain vocabulary used to build per-category
 * BM25 query term lists. Terms are grouped into categories.
 *
 * The BM25 scorer (src/lib/pipeline/bm25.ts) is a unigram lexical scorer that
 * applies NO per-term weighting — every query term contributes via IDF/TF only.
 * There are intentionally no per-term or per-category weights here: relevance
 * weighting is handled downstream by the LLM scorer and the category-level
 * llm/bm25 blend (see src/config/categories.ts).
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
  | "control_plane"
  | "sdlc";

/**
 * A domain term and the category it belongs to
 */
export interface DomainTerm {
  term: string;
  category: DomainCategory;
}

/**
 * Category metadata
 */
export interface DomainCategoryConfig {
  category: DomainCategory;
  description: string;
}

/**
 * Domain category configurations with descriptions
 */
export const DOMAIN_CATEGORIES: readonly DomainCategoryConfig[] = [
  {
    category: "code_search",
    description: "Code search and navigation capabilities",
  },
  {
    category: "ir",
    description: "Information retrieval and vector search",
  },
  {
    category: "context",
    description: "Context window and token management",
  },
  {
    category: "agentic",
    description: "Agentic workflows and tool use",
  },
  {
    category: "enterprise",
    description: "Enterprise codebase patterns",
  },
  {
    category: "devtools",
    description: "Developer tools and productivity",
  },
  {
    category: "llm_code",
    description: "LLM architecture for code",
  },
  {
    category: "control_plane",
    description: "Control plane within software development: code review, documentation, onboarding, vulnerability tracing, batch changes, monitoring",
  },
  {
    category: "sdlc",
    description: "Software development lifecycle",
  },
] as const;

/**
 * Consolidated domain terms, grouped by category.
 */
export const DOMAIN_TERMS: readonly DomainTerm[] = [
  // Code Search - Primary focus area
  { term: "code search", category: "code_search" },
  { term: "symbol search", category: "code_search" },
  { term: "codebase search", category: "code_search" },
  { term: "code navigation", category: "code_search" },
  { term: "cross-reference", category: "code_search" },
  { term: "cross-references", category: "code_search" },
  { term: "symbol indexing", category: "code_search" },
  { term: "code indexing", category: "code_search" },
  { term: "codebase indexing", category: "code_search" },
  { term: "indexing", category: "code_search" },
  { term: "function lookup", category: "code_search" },
  { term: "variable tracking", category: "code_search" },
  { term: "semantic code", category: "code_search" },
  { term: "symbols", category: "code_search" },
  { term: "code understanding", category: "code_search" },
  { term: "codebase understanding", category: "code_search" },
  { term: "code graph", category: "code_search" },

  // Information Retrieval - Core AI/ML concepts
  { term: "semantic search", category: "ir" },
  { term: "rag", category: "ir" },
  { term: "RAG", category: "ir" },
  { term: "retrieval augmented", category: "ir" },
  { term: "vector database", category: "ir" },
  { term: "vector databases", category: "ir" },
  { term: "vector search", category: "ir" },
  { term: "embeddings", category: "ir" },
  { term: "similarity search", category: "ir" },
  { term: "dense retrieval", category: "ir" },
  { term: "information retrieval", category: "ir" },
  { term: "relevance ranking", category: "ir" },
  { term: "corpus", category: "ir" },

  // Context Management - Context window handling
  { term: "context window", category: "context" },
  { term: "context management", category: "context" },
  { term: "token budget", category: "context" },
  { term: "context length", category: "context" },
  { term: "compression", category: "context" },
  { term: "summarization", category: "context" },
  { term: "chunking", category: "context" },
  { term: "prompt optimization", category: "context" },
  { term: "long context", category: "context" },
  { term: "token limit", category: "context" },
  { term: "memory", category: "context" },
  { term: "persistent context", category: "context" },
  { term: "context retrieval", category: "context" },
  { term: "context injection", category: "context" },

  // Agentic Workflows - Emerging paradigm
  { term: "agent", category: "agentic" },
  { term: "agents", category: "agentic" },
  { term: "agentic", category: "agentic" },
  { term: "tool use", category: "agentic" },
  { term: "planning", category: "agentic" },
  { term: "orchestration", category: "agentic" },
  { term: "workflow", category: "agentic" },
  { term: "multi-step", category: "agentic" },
  { term: "reasoning loop", category: "agentic" },
  { term: "agent framework", category: "agentic" },
  { term: "tool calling", category: "agentic" },
  { term: "mcp", category: "agentic" },
  { term: "model context protocol", category: "agentic" },
  { term: "computer use", category: "agentic" },
  { term: "browser automation", category: "agentic" },
  { term: "coding agent", category: "agentic" },
  { term: "ai coding", category: "agentic" },
  { term: "vibe coding", category: "agentic" },
  { term: "ai pair programming", category: "agentic" },

  // Enterprise Codebases - Scale and complexity
  { term: "monorepo", category: "enterprise" },
  { term: "monolithic", category: "enterprise" },
  { term: "dependency management", category: "enterprise" },
  { term: "modularization", category: "enterprise" },
  { term: "enterprise scale", category: "enterprise" },
  { term: "scale", category: "enterprise" },
  { term: "large codebase", category: "enterprise" },
  { term: "legacy system", category: "enterprise" },
  { term: "legacy systems", category: "enterprise" },
  { term: "refactoring", category: "enterprise" },
  { term: "migration", category: "enterprise" },
  { term: "scalability", category: "enterprise" },

  // Developer Tools - Supporting topics
  { term: "ide", category: "devtools" },
  { term: "IDE", category: "devtools" },
  { term: "debugging", category: "devtools" },
  { term: "profiling", category: "devtools" },
  { term: "linter", category: "devtools" },
  { term: "formatter", category: "devtools" },
  { term: "test framework", category: "devtools" },
  { term: "ci/cd", category: "devtools" },
  { term: "CI/CD", category: "devtools" },
  { term: "devops", category: "devtools" },
  { term: "automation", category: "devtools" },
  { term: "developer experience", category: "devtools" },
  { term: "dev productivity", category: "devtools" },

  // LLM Code Architecture - Model internals
  { term: "llm", category: "llm_code" },
  { term: "transformer", category: "llm_code" },
  { term: "transformers", category: "llm_code" },
  { term: "fine-tuning", category: "llm_code" },
  { term: "function calling", category: "llm_code" },
  { term: "code generation", category: "llm_code" },
  { term: "code completion", category: "llm_code" },
  { term: "neural", category: "llm_code" },
  { term: "reasoning pattern", category: "llm_code" },
  { term: "reasoning", category: "llm_code" },
  { term: "training data", category: "llm_code" },
  { term: "model architecture", category: "llm_code" },

  // Control Plane - Code review, documentation, onboarding, vulnerability, batch changes, monitoring
  { term: "code review", category: "control_plane" },
  { term: "pr review", category: "control_plane" },
  { term: "pull request review", category: "control_plane" },
  { term: "documentation", category: "control_plane" },
  { term: "code documentation", category: "control_plane" },
  { term: "runbook", category: "control_plane" },
  { term: "onboarding", category: "control_plane" },
  { term: "ramp-up", category: "control_plane" },
  { term: "knowledge transfer", category: "control_plane" },
  { term: "institutional knowledge", category: "control_plane" },
  { term: "vulnerability", category: "control_plane" },
  { term: "vulnerability tracing", category: "control_plane" },
  { term: "vulnerability remediation", category: "control_plane" },
  { term: "remediation", category: "control_plane" },
  { term: "batch changes", category: "control_plane" },
  { term: "bulk change", category: "control_plane" },
  { term: "monitoring", category: "control_plane" },
  { term: "observability", category: "control_plane" },

  // SDLC Processes - General development
  { term: "testing", category: "sdlc" },
  { term: "test suite", category: "sdlc" },
  { term: "unit test", category: "sdlc" },
  { term: "integration test", category: "sdlc" },
  { term: "deployment", category: "sdlc" },
  { term: "release", category: "sdlc" },
  { term: "version control", category: "sdlc" },
  { term: "git", category: "sdlc" },
  { term: "pull request", category: "sdlc" },
  { term: "change management", category: "sdlc" },
] as const;

/**
 * Get all terms for a specific category
 */
export function getTermsForCategory(category: DomainCategory): readonly DomainTerm[] {
  return DOMAIN_TERMS.filter((t) => t.category === category);
}

/**
 * Group terms by category for BM25 query construction.
 * Returns unique terms per category (plural/duplicate forms collapsed).
 */
export function getTermsByCategory(): Record<DomainCategory, { terms: string[] }> {
  const result: Record<DomainCategory, { terms: string[] }> = {
    code_search: { terms: [] },
    ir: { terms: [] },
    context: { terms: [] },
    agentic: { terms: [] },
    enterprise: { terms: [] },
    devtools: { terms: [] },
    llm_code: { terms: [] },
    control_plane: { terms: [] },
    sdlc: { terms: [] },
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
