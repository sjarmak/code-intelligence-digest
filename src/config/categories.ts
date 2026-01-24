/**
 * Category configuration and metadata
 * Defines scoring parameters, half-lives, query strings, and weights per category
 */

import { Category } from "../lib/model";
import { buildTermWeightMap } from "./domain-terms";

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
 *
 * Generated from the shared domain-terms.ts module
 */
export const DOMAIN_TERM_WEIGHTS: Record<string, number> = Object.fromEntries(
  buildTermWeightMap()
);
