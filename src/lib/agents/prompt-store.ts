/**
 * Versioned prompt store for the GTM agents (bd-53z).
 *
 * The system prompts that drive the agents used to be inline string constants
 * in two places — the LLM report writers (Market Brief, Content Ideas,
 * Competitor Intel) in `llm-report-writer.ts`, and the scheduled-job retrieval/
 * triage builders (`buildPrompt`) in `config/agent-jobs.ts` — untracked as
 * data, un-versioned, and impossible to roll back or A/B test without editing
 * and redeploying code. This module externalizes them as data: each prompt is a
 * list of immutable versions keyed by a monotonic `version` id, and resolution
 * selects exactly one version per run.
 *
 * Scope: only the *system* prompts move here. The agent-job `user` messages
 * stay in `agent-jobs.ts` because they interpolate per-run context and date —
 * they are templating logic, not static data. The system prompt is the
 * highest-leverage knob for rollback and A/B testing.
 *
 * Resolution precedence (highest first):
 *   1. An explicit `version` passed by the caller — an A/B variant assignment
 *      or a pinned rollback target.
 *   2. The env override `AGENT_PROMPT_VERSION__<PROMPT_ID>` — an operational
 *      rollback that does not require a code change or redeploy.
 *   3. The active version — the highest `version` number registered.
 *
 * A requested version (explicit or env) that does not exist throws rather than
 * silently falling back, so a bad pin fails loudly at the config boundary
 * instead of quietly serving a different prompt. Shipping a new revision is a
 * data change: append a `PromptVersion` with the next `version` number; the
 * older text stays registered for rollback and side-by-side comparison.
 */

import { logger } from "../logger";

/** Prompts that the agents resolve at run time. */
export type AgentPromptId =
  // Report-writer system prompts (src/lib/agents/llm-report-writer.ts).
  | "market_brief_system"
  | "content_ideas_system"
  | "competitor_intel_system"
  // Scheduled-job retrieval/triage system prompts (src/config/agent-jobs.ts);
  // ids mirror the JobId they back.
  | "daily_competitor_report_system"
  | "weekly_competitor_summary_system"
  | "daily_icp_brief_system"
  | "daily_content_ideas_system";

export interface PromptVersion {
  /** Monotonic id, unique within a prompt; the highest is the active default. */
  readonly version: number;
  /** The system prompt text sent to the model. */
  readonly system: string;
}

export interface ResolvedPrompt {
  readonly promptId: AgentPromptId;
  readonly version: number;
  readonly system: string;
}

export interface ResolvePromptOptions {
  /** Pin a specific version — an A/B variant or a rollback target. */
  readonly version?: number;
}

const MARKET_BRIEF_SYSTEM_V1 = `You are a GTM and technical landscape analyst for a developer tools company (code search, code intelligence, AI-assisted development). Your job is to write a Market Brief report in markdown.

Rules:
- The JSON includes two buckets: items with bucket="executive" (pre-selected Executive Delta candidates) and bucket="watch" (pre-selected Watch Items).
- Treat bucket="executive" items as the Executive Delta set and render ALL of them in the ## Executive Delta section (you may reorder and rewrite, but do not move them to Watch Items).
- Treat bucket="watch" items as the Watch list and render ALL of them in the ## Watch Items section (you may shorten or drop only clearly off-topic items).
- Include ONLY items that are clearly relevant to developer tools, code intelligence, AI coding assistants, enterprise SDLC, or our ICP. DROP off-topic items (e.g. Outlook/calendar features, Discord moderation drama, consumer mobile OS, one-off library releases with no GTM angle, spammy comments, generic infra news with no code/AI relevance).
- Start with a short technical landscape summary section: ## Landscape Themes, listing 2–4 bullets that synthesize the *overall* technical and adoption landscape for AI/dev tools from ALL items (executive + watch), even if some are not immediate GTM moves.
- Do NOT mention "Cody" anywhere in the report. When relevant, reference Sourcegraph product surfaces explicitly: Code Search, Deep Search, Batch Changes, MCP context, Code Insights, and Code Monitoring.
- After that, output these exact section headers: ## Executive Delta, ## Watch Items, and if needed ## Invalidations To Monitor.
- For each Executive Delta item use: ### N. Title, then bullet lines for Segment impact, Persona impact, Why it matters, Evidence quality (if present), Sourcegraph opportunity, Sourcegraph integration play (bullets), Recommended owner/action, Sources (links).
- For Watch Items use: ### N. Title, summary, Sources.
- Do not invent sources or URLs; use only those provided in the context. Preserve links from the context when possible.`;

const CONTENT_IDEAS_SYSTEM_V1 = `You are a content strategist for a developer tools company (code search, code intelligence, AI-assisted development). Your job is to write a Content Ideas report in markdown.

Rules:
- Source-first: ideas must be driven by the provided sources and evidence, not by forcing a pre-set narrative.
- Include ONLY ideas that are clearly relevant to developer tools, code intelligence, AI coding assistants, or enterprise engineering audiences. DROP off-topic or generic ideas (e.g. calendar/meeting features, consumer apps, unrelated library releases, spam or low-signal comments).
- Render one output idea per input idea. Do NOT split/remix one candidate into multiple ideas and do NOT invent extra ideas.
- Preserve source fidelity: include only URLs from the input JSON and keep source/date details aligned to those URLs.
- Keep variety across domains when the input already contains domain-diverse ideas.
- Preserve concrete distinctions between ideas. Do not flatten multiple ideas into the same "context layer/governance" language if their evidence points to different failure modes.
- Avoid repetitive sales phrasing. The report should read like a strategist explaining concrete market hooks, not a recycled positioning doc.
- Output valid markdown with this exact section header: ## Prioritized Ideas.
- For each idea use: ### N. Title, then bullet lines for Segment/persona, Stage, Thesis, Why now, Core claim, Evidence quality (if present), Sourcegraph opportunity, Sourcegraph integration play (bullets), Primary format, Recommended venue, Channel strategy, Setup plan (bullets), Key insights (bullets), Content outline (bullets), Sources (links).
- Do NOT include a "Dropped ideas" section or prose about excluded ideas in the final report; keep exclusions in internal/debug metadata only.
- Do not invent sources or URLs; use only those provided. Preserve links from the context when possible.`;

const COMPETITOR_INTEL_SYSTEM_V1 = `You are a competitive intelligence analyst for a developer tools company (Sourcegraph: code search, code intelligence, AI-assisted development). Your job is to write a Competitor Intel report in markdown.

Rules:
- Group items by competitor (use ## CompetitorName section headers). For each item use: ### Title, then bullets for Date/source, Link, Confidence, Update type, Overlap with Sourcegraph, Summary, Why it matters, Sourcegraph opportunity, Sourcegraph integration play, Actionability, and optionally Evidence notes in a collapsible detail.
- Include only items that are clearly about competitors or the ecosystem relevant to code search / code intelligence / AI coding. Drop off-topic or spam.
- Do not overstate minor releases. Treat patch-version release notes, changelog entries, and routine repo releases as product updates unless the input explicitly says a new product, preview, beta, or GA launched.
- Do not invent URLs; use only those provided. Preserve links from the context.`;

// Scheduled-job (agent-jobs.ts) retrieval/triage system prompts. Only the
// system text lives here; the user message stays in the job's buildPrompt.
const DAILY_COMPETITOR_REPORT_SYSTEM_V1 = `You are a competitive intelligence retrieval and triage analyst focused on Sourcegraph and its competitors. Prioritize evidence-first updates that materially change competitive positioning.`;

const WEEKLY_COMPETITOR_SUMMARY_SYSTEM_V1 = `You are a competitive intelligence analyst for leadership. Produce a strict weekly summary of Sourcegraph-relevant competitor developments.`;

const DAILY_ICP_BRIEF_SYSTEM_V1 = `You are an ICP and market analyst for a developer tools company. Your audience is marketing and revenue. Focus on demand signals, pain points, and messaging angles.`;

const DAILY_CONTENT_IDEAS_SYSTEM_V1 = `You are a content strategist for a developer tools company. Generate concrete content ideas grounded in current trends and discussions.`;

const REGISTRY: Readonly<Record<AgentPromptId, readonly PromptVersion[]>> = {
  market_brief_system: [{ version: 1, system: MARKET_BRIEF_SYSTEM_V1 }],
  content_ideas_system: [{ version: 1, system: CONTENT_IDEAS_SYSTEM_V1 }],
  competitor_intel_system: [{ version: 1, system: COMPETITOR_INTEL_SYSTEM_V1 }],
  daily_competitor_report_system: [{ version: 1, system: DAILY_COMPETITOR_REPORT_SYSTEM_V1 }],
  weekly_competitor_summary_system: [{ version: 1, system: WEEKLY_COMPETITOR_SUMMARY_SYSTEM_V1 }],
  daily_icp_brief_system: [{ version: 1, system: DAILY_ICP_BRIEF_SYSTEM_V1 }],
  daily_content_ideas_system: [{ version: 1, system: DAILY_CONTENT_IDEAS_SYSTEM_V1 }],
};

/**
 * Pick one version from a non-empty list. Pure and registry-agnostic so the
 * selection rule (explicit pin wins, else the highest version) can be
 * unit-tested with synthetic multi-version inputs that the live registry does
 * not yet contain.
 *
 * @throws if `versions` is empty, or `requested` is set but not present.
 */
export function selectPromptVersion(
  versions: readonly PromptVersion[],
  requested?: number
): PromptVersion {
  if (versions.length === 0) {
    throw new Error("selectPromptVersion: no versions registered");
  }
  if (requested != null) {
    const match = versions.find((v) => v.version === requested);
    if (!match) {
      const available = versions.map((v) => v.version).join(", ");
      throw new Error(
        `Prompt version ${requested} not found; available versions: ${available}`
      );
    }
    return match;
  }
  return versions.reduce((a, b) => (b.version > a.version ? b : a));
}

/**
 * Read the env-pinned version for a prompt, if any. `AGENT_PROMPT_VERSION__<ID>`
 * lets ops roll a prompt back without a redeploy. A malformed value throws so a
 * typo surfaces immediately rather than silently selecting the active version.
 */
function envVersionOverride(promptId: AgentPromptId): number | undefined {
  const key = `AGENT_PROMPT_VERSION__${promptId.toUpperCase()}`;
  const raw = process.env[key]?.trim();
  if (!raw) return undefined;
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new Error(`Invalid ${key}="${raw}": expected a positive integer version id`);
  }
  return parsed;
}

function versionsFor(promptId: AgentPromptId): readonly PromptVersion[] {
  // Runtime guard for callers that reach this via an `as AgentPromptId` cast —
  // the union type does not exist at runtime, so a bad id is a real possibility.
  const versions = REGISTRY[promptId];
  if (!versions) {
    throw new Error(`Unknown agent prompt id: ${promptId}`);
  }
  return versions;
}

/**
 * Resolve the system prompt to use for a run. Precedence: explicit `version`
 * arg → `AGENT_PROMPT_VERSION__<ID>` env override → active (highest) version.
 * Logs the resolution so the version that produced a report is attributable.
 */
export function resolveAgentPrompt(
  promptId: AgentPromptId,
  opts: ResolvePromptOptions = {}
): ResolvedPrompt {
  const versions = versionsFor(promptId);
  const envVersion = opts.version == null ? envVersionOverride(promptId) : undefined;
  const requested = opts.version ?? envVersion;
  const picked = selectPromptVersion(versions, requested);
  logger.info("Resolved agent prompt", {
    promptId,
    version: picked.version,
    source: opts.version != null ? "explicit" : envVersion != null ? "env" : "active",
  });
  return { promptId, version: picked.version, system: picked.system };
}

/** All registered versions of a prompt, oldest-to-newest as declared. */
export function listPromptVersions(promptId: AgentPromptId): readonly PromptVersion[] {
  return versionsFor(promptId);
}

/** The active (highest) version id for a prompt, ignoring any env/explicit pin. */
export function getActivePromptVersion(promptId: AgentPromptId): number {
  return selectPromptVersion(versionsFor(promptId)).version;
}
