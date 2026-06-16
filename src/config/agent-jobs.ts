/**
 * GTM / Marketing agent workflows: job definitions with schedule, scope, and prompts.
 * Agents run as scheduled jobs (daily/weekly), not conversation.
 */

import type { Category } from "../lib/model";
import { resolveAgentPrompt } from "../lib/agents/prompt-store";

export type AgentId = "competitive_intel" | "icp_market" | "gtm_content";
export type JobId =
  | "daily_competitor_report"
  | "weekly_competitor_summary"
  | "daily_icp_brief"
  | "daily_content_ideas";

export type JobSchedule = "daily" | "weekly";

export interface AgentJobScope {
  /** Categories to pull items from (e.g. product_news, marketing). */
  categories: Category[];
  /** If true, only include items that mention competitor products. */
  competitorsOnly?: boolean;
}

export interface AgentJobConfig {
  agentId: AgentId;
  jobId: JobId;
  name: string;
  schedule: JobSchedule;
  scope: AgentJobScope;
  /** Max items to include in context (by recency). */
  maxItems?: number;
  /** Period in days for loading items. */
  periodDays?: number;
  /** Optional web search queries for grounding (e.g. competitor updates, GTM trends). */
  webSearchQueries?: (date: string) => string[];
  /** Builds the system + user prompt given context string and optional date. */
  buildPrompt: (context: string, date: string) => { system: string; user: string };
}

export interface AgentConfig {
  id: AgentId;
  name: string;
  description: string;
  jobs: AgentJobConfig[];
  /**
   * Optional soft cap on LLM tokens per run (bd-zso). When set, a run whose
   * total token usage exceeds it logs a warning — observability, not
   * enforcement; a completed run is never discarded. Unset means no budget.
   */
  tokenBudgetPerRun?: number;
}

const COMPETITIVE_INTEL_REPORT_PROMPT = (
  context: string,
  date: string
): { system: string; user: string } => ({
  system: resolveAgentPrompt("daily_competitor_report_system").system,
  user: `Based on the following recent items (from ${date}), write a concise competitor intel report in markdown.

Priorities:
- code understanding for humans and agents
- deep/natural-language code search
- MCP and agent context infrastructure
- large codebase navigation, refactoring, remediation, and migration
- insights, monitoring, governance, and enterprise control

For each key update:
1. what changed
2. overlap with Sourcegraph surface(s)
3. impact on sales/product/messaging/exec awareness
4. threat level (high/medium/low/negative)
5. evidence (source URL/title)

Deprioritize generic funding/hiring/thought-leadership unless it changes product reach or buying motion.

Sources:
${context}`,
});

const COMPETITIVE_INTEL_WEEKLY_PROMPT = (
  context: string,
  date: string
): { system: string; user: string } => ({
  system: resolveAgentPrompt("weekly_competitor_summary_system").system,
  user: `Based on the following items from the past week (through ${date}), write a short weekly competitive summary in markdown:
- key themes (2-4)
- top 3-5 developments with explicit Sourcegraph overlap
- one recommended action per development (sales/product/messaging/exec)
- explicitly call out uncertainty when sources conflict

Sources:
${context}`,
});

const ICP_BRIEF_PROMPT = (context: string, date: string): { system: string; user: string } => ({
  system: resolveAgentPrompt("daily_icp_brief_system").system,
  user: `Using the following recent content (from ${date}), write a daily ICP/market brief in markdown.

Include:
1. **Demand signals**: What topics or problems are showing up in content and discussions?
2. **Pain points**: Recurring frustrations or needs of developers/technical leaders.
3. **Messaging angles**: Suggested positioning or proof points we could use.

Ground each point in the sources. Keep to 1–2 pages.

Sources:
${context}`,
});

const CONTENT_IDEAS_PROMPT = (context: string, date: string): { system: string; user: string } => ({
  system: resolveAgentPrompt("daily_content_ideas_system").system,
  user: `Based on the following recent items (from ${date}), produce a list of content ideas in markdown.

Format:
## Blog / long-form
- Title or topic (1 line each) with a brief why-now or angle.

## Social / short-form
- 3–5 tweet/LinkedIn post ideas with a hook.

## Demand gen / campaigns
- 2–3 campaign or asset ideas (webinars, guides, etc.) with target audience.

Each idea should be actionable and tied to something in the sources. No generic ideas.

Sources:
${context}`,
});

/** All agent job definitions. */
export const AGENT_JOBS: AgentJobConfig[] = [
  {
    agentId: "competitive_intel",
    jobId: "daily_competitor_report",
    name: "Daily competitor report",
    schedule: "daily",
    scope: {
      categories: ["product_news", "tech_articles", "community", "research", "ai_news"],
      competitorsOnly: true,
    },
    maxItems: 25,
    periodDays: 3,
    webSearchQueries: (date) => [
      `AI coding agents competitor updates ${date}`,
      "GitHub Copilot GitLab Duo Augment Code Moderne release notes",
      "Cursor Windsurf Claude Code MCP enterprise update",
      "Qodo Greptile Semgrep CodeSee enterprise customer benchmark",
    ],
    buildPrompt: COMPETITIVE_INTEL_REPORT_PROMPT,
  },
  {
    agentId: "competitive_intel",
    jobId: "weekly_competitor_summary",
    name: "Weekly competitor summary",
    schedule: "weekly",
    scope: {
      categories: ["product_news", "tech_articles", "community", "research", "ai_news"],
      competitorsOnly: true,
    },
    maxItems: 40,
    periodDays: 7,
    webSearchQueries: (date) => [
      `AI coding agents market weekly roundup ${date}`,
      "code search deep search context engine enterprise updates",
      "MCP coding agents enterprise compliance security updates",
    ],
    buildPrompt: COMPETITIVE_INTEL_WEEKLY_PROMPT,
  },
  {
    agentId: "icp_market",
    jobId: "daily_icp_brief",
    name: "Daily ICP/market brief",
    schedule: "daily",
    scope: {
      categories: ["marketing", "product_news", "community"],
      competitorsOnly: false,
    },
    maxItems: 25,
    periodDays: 3,
    webSearchQueries: (_date) => [
      "developer tools GTM trends 2025",
      "technical buyer pain points B2B",
    ],
    buildPrompt: ICP_BRIEF_PROMPT,
  },
  {
    agentId: "gtm_content",
    jobId: "daily_content_ideas",
    name: "Daily content ideas",
    schedule: "daily",
    scope: {
      categories: ["marketing", "product_news"],
      competitorsOnly: false,
    },
    maxItems: 20,
    periodDays: 30,
    webSearchQueries: (_date) => [
      "developer marketing content trends",
      "demand gen for dev tools",
    ],
    buildPrompt: CONTENT_IDEAS_PROMPT,
  },
];

/** Agent metadata (name, description) and their jobs. */
export const AGENTS: AgentConfig[] = [
  {
    id: "competitive_intel",
    name: "Competitive Intel",
    description: "Competitor moves, positioning, and implications for GTM.",
    jobs: AGENT_JOBS.filter((j) => j.agentId === "competitive_intel"),
  },
  {
    id: "icp_market",
    name: "ICP & Market Needs",
    description: "Demand signals, pain points, and messaging angles for target profiles.",
    jobs: AGENT_JOBS.filter((j) => j.agentId === "icp_market"),
  },
  {
    id: "gtm_content",
    name: "GTM / Content",
    description: "Content ideas for blog, social, and demand gen.",
    jobs: AGENT_JOBS.filter((j) => j.agentId === "gtm_content"),
  },
];

export function getJobConfig(agentId: AgentId, jobId: JobId): AgentJobConfig | null {
  return AGENT_JOBS.find((j) => j.agentId === agentId && j.jobId === jobId) ?? null;
}

export function getAgentConfig(agentId: AgentId): AgentConfig | null {
  return AGENTS.find((a) => a.id === agentId) ?? null;
}

export function getJobsForSchedule(schedule: JobSchedule): AgentJobConfig[] {
  if (schedule === "daily") {
    return AGENT_JOBS.filter((j) => j.schedule === "daily");
  }
  return AGENT_JOBS.filter((j) => j.schedule === "weekly");
}
