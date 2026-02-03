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
  halfLifeDays: number; // Recency decay half-life (for display only, not used in scoring)
  maxItems: number; // Max items per digest
  minRelevance: number; // Min LLM relevance score (0-10)
  weights: {
    llm: number;
    bm25: number;
    engagement?: number; // For community only
    citations?: number; // For research only
    reads?: number; // For research only
  };
}

export const CATEGORY_CONFIG: Record<Category, CategoryConfig> = {
  newsletters: {
    name: "Newsletters",
    description:
      "Curated newsletters and columns on code intelligence and developer tools",
    query:
      "code search coding agent developer productivity AI tools context management information retrieval codebase intelligence agents code review devtools IDE",
    halfLifeDays: 3,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.6,
      bm25: 0.4,
    },
  },

  podcasts: {
    name: "Podcasts",
    description: "Podcast episodes about AI, coding, and developer tools",
    query:
      "code search coding agent developer productivity AI tools context management information retrieval codebase intelligence agents code review devtools IDE",
    halfLifeDays: 7,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.6,
      bm25: 0.4,
    },
  },

  tech_articles: {
    name: "Tech Articles",
    description:
      "In-depth technical articles and essays on code and development",
    query:
      "code search coding agent developer productivity AI tools context management information retrieval codebase intelligence agents code review devtools IDE",
    halfLifeDays: 5,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.6,
      bm25: 0.4,
    },
  },

  ai_news: {
    name: "AI News",
    description:
      "AI model releases, research, and infrastructure news relevant to developers",
    query:
      "AI model release acquisition breakthrough LLM transformer foundation model reasoning inference",
    halfLifeDays: 2,
    maxItems: 10,
    minRelevance: 4, // Relaxed for general AI updates
    weights: {
      llm: 0.65,
      bm25: 0.35,
    },
  },

  ai_dev: {
    name: "AI Dev",
    description:
      "Incorporating AI into developer workflows: tips, best practices, coding assistants, and productivity from TLDR, newsletters, tech blogs, and community",
    query:
      "AI coding assistant developer workflow productivity Cursor Copilot pair programming prompt engineering RAG agent devops automation code generation",
    halfLifeDays: 3,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.6,
      bm25: 0.4,
    },
  },

  product_news: {
    name: "Product News",
    description:
      "Tool releases, feature announcements, and changelogs for dev tools",
    query:
      "Augment Code Windsurf Cursor Claude Code Codex CLI Gemini CLI Antigravity codebase context coding agent release feature announcement changelog",
    halfLifeDays: 4,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.6,
      bm25: 0.4,
    },
  },

  community: {
    name: "Community",
    description:
      "Discussions and posts from Reddit, forums, and community channels",
    query:
      "coding agent AI developer workflow sentiment code search Sourcegraph discussion",
    halfLifeDays: 3,
    maxItems: 10,
    minRelevance: 4,
    weights: {
      llm: 0.5,
      bm25: 0.3,
      engagement: 0.2,
    },
  },

  research: {
    name: "Research",
    description:
      "Academic papers on software engineering, IR, PL, and ML for code",
    query:
      "coding agent code search context agent information retrieval codebase developer workflow benchmark",
    halfLifeDays: 10,
    maxItems: 10,
    minRelevance: 5,
    weights: {
      llm: 0.5,
      bm25: 0.3,
      citations: 0.1,
      reads: 0.1,
    },
  },

  marketing: {
    name: "Marketing",
    description:
      "Marketing strategies for developer and technical leader audiences, AI-leveraged approaches, and pipeline generation insights",
    query:
      "developer marketing developer relations devrel technical audience ICP pipeline generation demand generation B2B SaaS go-to-market content marketing developer experience AI marketing thought leadership technical decision maker engineering leader product-led growth developer advocacy",
    halfLifeDays: 7,
    maxItems: 10,
    minRelevance: 4,
    weights: {
      llm: 0.65,
      bm25: 0.35,
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
export const DOMAIN_TERM_WEIGHTS: Record<string, number> =
  Object.fromEntries(buildTermWeightMap());
