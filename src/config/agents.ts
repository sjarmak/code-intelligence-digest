/**
 * Agent goal configuration for specialized marketing agents.
 * Defines objectives, ICP, categories, retrieval mix, and ranking profile per goal.
 */

import type { Category } from "../lib/model.js";

export type AgentGoal = "content_ideas" | "market_brief" | "competitor_intel";

export interface RetrievalStrategy {
  postgresWeight: number;
  webWeight: number;
  maxPostgresDocs: number;
  maxWebDocs: number;
}

export interface RankingProfile {
  baseScoreWeight: number;
  competitorMatchWeight: number;
  icpMatchWeight: number;
  formatTypeWeight: number;
  recencyWeight: number;
  trendLandscapeWeight?: number;
}

export interface AgentGoalConfig {
  name: string;
  description: string;
  primaryCategories: Category[];
  icpDescription: string;
  timeHorizonDays: number;
  retrievalStrategies: RetrievalStrategy;
  rankingProfile: RankingProfile;
  /** Query terms for Postgres/BM25 when no free-text query is provided */
  postgresQueryTerms: string[];
  /** Query template parts for web search (combined with goal-specific keywords) */
  webQueryTemplates: string[];
  /** Domains to exclude from results (e.g. social, tracking wrappers) */
  blockedDomains?: string[];
  /** For competitor_intel: domains for "our" product to exclude from competitor list */
  excludeSelfDomains?: string[];
  /** Optional domains to explicitly include (e.g. our changelog/product for content_ideas). Web search runs extra queries restricted to these domains. */
  includeDomains?: string[];
  /** Query templates for the includeDomains pass (e.g. "Sourcegraph changelog", "Sourcegraph product features"). */
  includeDomainsQueryTemplates?: string[];
}

const ICP_DEFAULT =
  "Developers and tech leads at companies with large, complex codebases; teams adopting AI-assisted development and code intelligence tools.";

export const AGENT_GOAL_CONFIGS: Record<AgentGoal, AgentGoalConfig> = {
  content_ideas: {
    name: "Content Ideas",
    description:
      "Surfaces content ideas informed by market and industry research: webinars, blogs, case studies, and campaigns that align with our ICP and with the same research signals that inform the market brief. Research is inspired by ingested content but not limited to it—web discovery finds additional relevant signals.",
    primaryCategories: ["tech_articles", "product_news", "community", "newsletters"],
    icpDescription: ICP_DEFAULT,
    timeHorizonDays: 30,
    retrievalStrategies: {
      postgresWeight: 0.45,
      webWeight: 0.55,
      maxPostgresDocs: 45,
      maxWebDocs: 50,
    },
    rankingProfile: {
      // Favor goal features (ICP, format, competitor) over raw digest baseScore so generic ai_news does not dominate seeds.
      baseScoreWeight: 0.2,
      competitorMatchWeight: 0.15,
      icpMatchWeight: 0.3,
      formatTypeWeight: 0.3,
      recencyWeight: 0.05,
    },
    postgresQueryTerms: [
      "webinar",
      "white paper",
      "whitepaper",
      "tutorial",
      "case study",
      "blog",
      "video",
      "best practices",
      "code intelligence",
      "code search",
      "developer productivity",
    ],
    webQueryTemplates: [
      "webinar code intelligence developer tools",
      "white paper code search large codebase",
      "case study AI coding assistant enterprise",
      "best practices developer marketing content",
      "code intelligence adoption trends developer tools",
      "code search deep search market landscape content",
      "enterprise codebase tooling developer productivity",
      "AI coding assistant industry trends content marketing",
    ],
    blockedDomains: [
      "instagram.com",
      "tiktok.com",
      "facebook.com",
      "twitter.com",
      "x.com",
    ],
    includeDomains: ["sourcegraph.com", "docs.sourcegraph.com"],
    includeDomainsQueryTemplates: [
      "Sourcegraph changelog product updates features",
      "Sourcegraph code search deep search batch changes product",
    ],
  },

  market_brief: {
    name: "Market Brief",
    description:
      "Functions as a researcher: finds the most relevant content on industry state, adoption, and product-relevant signals so GTM and engineering can report on what matters for our positioning and product direction.",
    primaryCategories: ["product_news", "tech_articles", "ai_news", "community"],
    icpDescription: ICP_DEFAULT,
    timeHorizonDays: 14,
    retrievalStrategies: {
      postgresWeight: 0.45,
      webWeight: 0.55,
      maxPostgresDocs: 50,
      maxWebDocs: 55,
    },
    rankingProfile: {
      baseScoreWeight: 0.25,
      competitorMatchWeight: 0.15,
      icpMatchWeight: 0.2,
      formatTypeWeight: 0.1,
      recencyWeight: 0.2,
      trendLandscapeWeight: 0.1,
    },
    postgresQueryTerms: [
      "adoption",
      "trend",
      "market",
      "enterprise",
      "monorepo",
      "codebase",
      "developer productivity",
      "go to market",
      "landscape",
      "shift",
    ],
    webQueryTemplates: [
      "code intelligence adoption report",
      "developer productivity trends",
      "large monorepo tooling market",
      "AI coding tools enterprise adoption",
      "developer tools industry positioning enterprise codebase",
      "code search deep search market landscape",
      "enterprise codebase tooling trends",
      "AI coding assistant industry analysis developer tools",
    ],
    blockedDomains: [
      "link.mail.beehiiv.com",
      "refer.tldr.com",
      "advertise.tldr.com",
      "sparklp.co",
      "awstrack.me",
    ],
  },

  competitor_intel: {
    name: "Competitor Intel",
    description:
      "Tracks competitors and adjacent code-intelligence vendors with strict Sourcegraph-overlap triage: code search, MCP/context, enterprise controls, and large-scale code change.",
    primaryCategories: ["product_news", "tech_articles", "community", "research", "ai_news", "newsletters", "podcasts"],
    icpDescription: ICP_DEFAULT,
    timeHorizonDays: 90,
    retrievalStrategies: {
      postgresWeight: 0.5,
      webWeight: 0.5,
      maxPostgresDocs: 120,
      maxWebDocs: 50,
    },
    rankingProfile: {
      baseScoreWeight: 0.2,
      competitorMatchWeight: 0.4,
      icpMatchWeight: 0.2,
      formatTypeWeight: 0.05,
      recencyWeight: 0.15,
    },
    postgresQueryTerms: [
      "GitHub Copilot",
      "GitLab Duo",
      "Augment Code",
      "Moderne",
      "Cursor",
      "Windsurf",
      "Claude Code",
      "Atlassian Rovo Dev",
      "Qodo",
      "Greptile",
      "Semgrep",
      "CodeSee",
      "code search",
      "deep search",
      "MCP",
      "context engine",
      "bulk refactoring",
      "codemod",
      "enterprise governance",
    ],
    webQueryTemplates: [
      "code search deep search competitor launch",
      "MCP coding agent context engine enterprise",
      "bulk code remediation codemod migration platform",
      "enterprise code intelligence governance monitoring",
      "agentic code review full codebase context",
      "engineering knowledge base complex codebases",
    ],
    blockedDomains: [],
    excludeSelfDomains: ["sourcegraph.com"],
  },
};

export function getAgentGoalConfig(goal: AgentGoal): AgentGoalConfig {
  return AGENT_GOAL_CONFIGS[goal];
}

export function getAgentGoals(): AgentGoal[] {
  return ["content_ideas", "market_brief", "competitor_intel"];
}
