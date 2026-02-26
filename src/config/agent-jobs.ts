/**
 * GTM / Marketing agent workflows: job definitions with schedule, scope, and prompts.
 * Agents run as scheduled jobs (daily/weekly), not conversation.
 */

import type { Category } from "../lib/model";

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
}

const COMPETITIVE_INTEL_REPORT_PROMPT = (
  context: string,
  date: string
): { system: string; user: string } => ({
  system: `You are a competitive intelligence analyst for a developer tools company. Your audience is marketing and revenue teams. Produce a concise, actionable daily report.`,
  user: `Based on the following recent items (from ${date}), write a 1–2 page competitive intel report in markdown.

Include:
1. **Headlines**: Key competitor or market moves (product launches, positioning, partnerships).
2. **Implications**: What this means for our GTM and positioning.
3. **Sources**: Reference specific items by title or source where relevant.

Be specific and cite the content. Avoid generic filler.

Sources:
${context}`,
});

const COMPETITIVE_INTEL_WEEKLY_PROMPT = (
  context: string,
  date: string
): { system: string; user: string } => ({
  system: `You are a competitive intelligence analyst. Produce a condensed weekly summary for leadership.`,
  user: `Based on the following items from the past week (through ${date}), write a short weekly competitive summary in markdown: key themes, top 3–5 competitor/market developments, and one sentence of recommended action. Be concise.

Sources:
${context}`,
});

const ICP_BRIEF_PROMPT = (context: string, date: string): { system: string; user: string } => ({
  system: `You are an ICP and market analyst for a developer tools company. Your audience is marketing and revenue. Focus on demand signals, pain points, and messaging angles.`,
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
  system: `You are a content strategist for a developer tools company. Generate concrete content ideas grounded in current trends and discussions.`,
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
      categories: ["product_news"],
      competitorsOnly: true,
    },
    maxItems: 25,
    periodDays: 3,
    webSearchQueries: (date) => [
      `AI coding assistant product updates ${date}`,
      "Cursor IDE Windsurf Claude Code competitor news 2025",
      "developer tools competitive landscape",
    ],
    buildPrompt: COMPETITIVE_INTEL_REPORT_PROMPT,
  },
  {
    agentId: "competitive_intel",
    jobId: "weekly_competitor_summary",
    name: "Weekly competitor summary",
    schedule: "weekly",
    scope: {
      categories: ["product_news"],
      competitorsOnly: true,
    },
    maxItems: 40,
    periodDays: 7,
    webSearchQueries: (date) => [
      "AI coding agents market weekly roundup",
      "developer tools competitor moves",
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
    webSearchQueries: (date) => [
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
    periodDays: 3,
    webSearchQueries: (date) => [
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
