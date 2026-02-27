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
}

const ICP_DEFAULT =
  "Developers and tech leads at companies with large, complex codebases; teams adopting AI-assisted development and code intelligence tools.";

export const AGENT_GOAL_CONFIGS: Record<AgentGoal, AgentGoalConfig> = {
  content_ideas: {
    name: "Content Ideas",
    description:
      "Marketing expert that surfaces content ideas and best practices for marketing in the code intelligence space: webinars, blogs, videos, white papers, case studies, and tutorials that align with our ICP.",
    primaryCategories: ["tech_articles", "product_news", "community", "newsletters"],
    icpDescription: ICP_DEFAULT,
    timeHorizonDays: 30,
    retrievalStrategies: {
      postgresWeight: 0.6,
      webWeight: 0.4,
      maxPostgresDocs: 50,
      maxWebDocs: 30,
    },
    rankingProfile: {
      baseScoreWeight: 0.3,
      competitorMatchWeight: 0.1,
      icpMatchWeight: 0.25,
      formatTypeWeight: 0.25,
      recencyWeight: 0.1,
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
    ],
    blockedDomains: [
      "instagram.com",
      "tiktok.com",
      "facebook.com",
      "twitter.com",
      "x.com",
    ],
  },

  market_brief: {
    name: "Market Brief",
    description:
      "Identifies potential leads and provides insights on tech and market landscape shifts to inform go-to-market strategy: adoption trends, new categories, and signals from the market.",
    primaryCategories: ["product_news", "tech_articles", "ai_news", "community"],
    icpDescription: ICP_DEFAULT,
    timeHorizonDays: 14,
    retrievalStrategies: {
      postgresWeight: 0.55,
      webWeight: 0.45,
      maxPostgresDocs: 60,
      maxWebDocs: 40,
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
