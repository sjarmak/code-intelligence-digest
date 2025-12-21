/**
 * Category configuration and metadata
 * Defines scoring parameters, half-lives, query strings, and weights per category
 */

import { Category } from "../lib/model";

export interface CategoryConfig {
  name: string;
  description: string;
  query: string; // BM25 query string for domain terms
  halfLifeDays: number; // Recency decay half-life
  maxItems: number; // Max items per digest
  minRelevance: number; // Min LLM relevance score (0-10)
  weights: {
    llm: number;
    bm25: number;
    recency: number;
    engagement?: number; // For community only
  };
}

export const CATEGORY_CONFIG: Record<Category, CategoryConfig> = {
  newsletters: {
    name: "Newsletters",
    description: "Curated newsletters and columns on code intelligence and developer tools",
    query:
      "code search semantic search codebase intelligence agents code review devtools IDE",
    halfLifeDays: 3,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.45,
      bm25: 0.35,
      recency: 0.2,
    },
  },

  podcasts: {
    name: "Podcasts",
    description: "Podcast episodes about AI, coding, and developer tools",
    query:
      "AI coding podcast agents code search LLM developer productivity tools infrastructure",
    halfLifeDays: 7,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.5,
      bm25: 0.3,
      recency: 0.2,
    },
  },

  tech_articles: {
    name: "Tech Articles",
    description: "In-depth technical articles and essays on code and development",
    query:
      "code search semantic search codebase refactoring agents code intelligence testing CI/CD architecture patterns",
    halfLifeDays: 5,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.4,
      bm25: 0.4,
      recency: 0.2,
    },
  },

  ai_news: {
    name: "AI News",
    description: "AI model releases, research, and infrastructure news relevant to developers",
    query:
      "LLM transformer model reasoning AI inference coding agents foundation models context window",
    halfLifeDays: 2,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.45,
      bm25: 0.35,
      recency: 0.2,
    },
  },

  product_news: {
    name: "Product News",
    description: "Tool releases, feature announcements, and changelogs for dev tools",
    query:
      "release feature announcement changelog IDE debugger code review tool productivity integrations",
    halfLifeDays: 4,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.45,
      bm25: 0.35,
      recency: 0.2,
    },
  },

  community: {
    name: "Community",
    description: "Discussions and posts from Reddit, forums, and community channels",
    query:
      "code search agents devtools codebase refactoring code review testing CI/CD best practices",
    halfLifeDays: 3,
    maxItems: 10,
    minRelevance: 4,
    weights: {
      llm: 0.4,
      bm25: 0.35,
      recency: 0.15,
      engagement: 0.1,
    },
  },

  research: {
    name: "Research",
    description: "Academic papers on software engineering, IR, PL, and ML for code",
    query:
      "semantic search code search program synthesis AST machine learning software engineering empirical study",
    halfLifeDays: 10,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.5,
      bm25: 0.3,
      recency: 0.2,
    },
  },
};

/**
 * Get category config by name
 */
export function getCategoryConfig(category: Category): CategoryConfig {
  return CATEGORY_CONFIG[category];
}

/**
 * Domain term categories and weights for BM25 query construction
 * These are used to boost relevance when domain-specific terms appear
 */
export const DOMAIN_TERM_WEIGHTS: Record<string, number> = {
  // Information Retrieval (1.5x)
  "semantic search": 1.5,
  embeddings: 1.5,
  RAG: 1.5,
  "vector databases": 1.5,
  "vector search": 1.5,

  // Context Management (1.5x)
  "context window": 1.5,
  "context management": 1.5,
  "token budget": 1.5,
  compression: 1.5,
  summarization: 1.5,

  // Code Search (1.6x)
  "code search": 1.6,
  "code navigation": 1.6,
  indexing: 1.6,
  symbols: 1.6,
  "cross-references": 1.6,

  // Agentic Workflows (1.4x)
  agents: 1.4,
  agentic: 1.4,
  "tool use": 1.4,
  orchestration: 1.4,
  planning: 1.4,

  // Enterprise Codebases (1.3x)
  monorepo: 1.3,
  "dependency management": 1.3,
  modularization: 1.3,
  scale: 1.3,
  "legacy systems": 1.3,

  // Developer Tools (1.2x)
  IDE: 1.2,
  debugging: 1.2,
  refactoring: 1.2,
  "dev productivity": 1.2,
  "CI/CD": 1.2,

  // LLM Code Architecture (1.2x)
  transformers: 1.2,
  "fine-tuning": 1.2,
  "function calling": 1.2,
  reasoning: 1.2,

  // SDLC Processes (1.0x)
  "code review": 1.0,
  testing: 1.0,
  "change management": 1.0,
  deployment: 1.0,
};
