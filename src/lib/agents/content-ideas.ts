import { retrieveForAgent, type AgentRetrievalTrace, type RetrievedDoc } from "../pipeline/agentRetrieval";
import { getAgentGoalConfig, type AgentGoal } from "../../config/agents";
import { rankForAgent, type AgentRankedDoc } from "../pipeline/agentRank";
import path from "node:path";
import JSON5 from "next/dist/compiled/json5";
import YAML from "yaml";
import {
  CURATOR_TRACE_SCHEMA_VERSION,
  createEmptyRankingTrace,
  rankingTraceToSteps,
  retrievalTraceToSteps,
  type AgentRankingTrace,
  type CuratorTraceStep,
} from "../retrieval/curator-trace";
import { loadPlaybookState, type PlaybookState } from "./playbook-state";
import { classifySourceTypeByDomain, getDomainFromUrl as getDomainFromUrlCompetitor } from "../../config/competitor-intel";
import {
  classifySourcegraphIntegrationOpportunity,
  type IntegrationOpportunityLevel,
} from "./sourcegraph-integration-opportunity";
import { AgentScoringDebugger } from "./agent-scoring-debug";
import { withLangSmithTraceable } from "../langsmith";
import { createChatCompletion } from "../llm/completion";
import { hasLLMConfigured, isClaudeModel } from "../llm/config";
import { logger } from "../logger";
import { isAgentLlmTimeoutError, withAgentLlmTimeout } from "./llm-timeout";
import { searchWeb } from "../retrieval/webSearch";

/**
 * Content ideas: when LLM is configured, "Generate reports" uses retrieve → rank → shortlist (LLM)
 * and formats the shortlist as ContentIdeasOutput. When no LLM is configured, this module's
 * heuristic scoring + templates are used. The quality model is also used for scheduled jobs (run-job.ts).
 */

export interface ContentIdea {
  title: string;
  thesis: string;
  target_segment: "Capital Markets" | "Banks" | "Diversified Financial Services" | "Insurance" | "Other";
  target_persona: "Head of Developer Platform" | "VP Engineering" | "Staff Engineer" | "Security/Compliance";
  funnel_stage: "awareness" | "validation" | "business_case" | "expansion";
  channel:
    | "whitepaper"
    | "webinar"
    | "event_talk"
    | "blog"
    | "SEO_page"
    | "case_study"
    | "email_sequence"
    | "sales_one_pager"
    | "long_video"
    | "short_video"
    | "ad_campaign";
  why_now: string;
  playbook_alignment: string[];
  sources: Array<{
    title: string;
    source: string;
    url: string;
    date: string;
  }>;
  core_claim: string;
  key_insights: string[];
  content_outline: string[];
  proof_required: string[];
  guardrails: string[];
  evidence_quality_note?: string;
  integration_opportunity: IntegrationOpportunityLevel;
  sourcegraph_integration_play: string[];
  distribution_plan: {
    primary_format: string;
    recommended_venue: string;
    channel_strategy: string;
    setup_steps: string[];
  };
  priority_score: number;
}

export interface ContentIdeasOutput {
  generated_at: string;
  playbook_version: string;
  /** When set, rendered as "Period: last N days" in the report body. */
  periodDays?: number;
  playbook_confidence_flags?: Record<string, "high" | "medium" | "low">;
  llm_debug?: {
    structured_synthesis_timed_out?: boolean;
    structured_synthesis?: {
      status: "success" | "timeout" | "error" | "parse_fallback" | "normalization_fallback" | "not_configured";
      provider?: "anthropic" | "openai";
      model?: string;
      error?: string;
    };
    report_writer?: {
      status: "success" | "timeout" | "error" | "skipped";
      provider?: "anthropic" | "openai";
      model?: string;
      error?: string;
    };
    final_output?: "llm_report_writer" | "template_markdown";
  };
  /**
   * End-to-end pipeline diagnostics: Postgres + web retrieval, merge/date gates, ranking pool, and ideation filters.
   * Only populated when `generateContentIdeas({ pipelineTrace: true })` or `GET /api/agents/content-ideas?trace=1`.
   */
  pipeline_trace?: ContentIdeasPipelineTrace;
  selection_debug?: {
    target_mix: {
      beachhead: number;
      adjacent: number;
      broader: number;
    };
    achieved_mix: {
      beachhead: number;
      adjacent: number;
      broader: number;
    };
    achieved_counts: {
      beachhead: number;
      adjacent: number;
      broader: number;
      total: number;
    };
    achieved_segment_counts: Record<string, number>;
    dropped_candidates?: string[];
  };
  ideas: ContentIdea[];
}

export interface ContentIdeasPipelineTrace {
  /** Aligns with `CURATOR_TRACE_SCHEMA_VERSION`. */
  schemaVersion?: number;
  focus?: string | null;
  retrieval: {
    market_brief: AgentRetrievalTrace;
    competitor_intel: AgentRetrievalTrace;
    content_pool?: AgentRetrievalTrace;
  };
  /** Top-N ranked docs with scores (content_ideas goal). */
  ranking: AgentRankingTrace;
  pool: {
    after_dedupe_urls: number;
    ranked_count: number;
  };
  candidate_gates: Array<{
    name: string;
    passed: number;
    dropped: number;
  }>;
  selection: {
    min_score_threshold: number;
    selection_pool_size: number;
    selected_top_urls: string[];
  };
  /** Counts after ranking → gates → ideation → final (for tuning downstream filters). */
  refinement_stages?: Array<{ stage: string; count: number }>;
  /** Ordered steps: retrieval (×2) → ranking sample → refinement — for UI / logs. */
  interpretable_steps?: CuratorTraceStep[];
}

function createEmptyAgentRetrievalTrace(goal: AgentGoal, periodDays: number): AgentRetrievalTrace {
  const cutoffMs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  return {
    goal,
    periodDays,
    postgres: { categories: [] },
    web: { queries: [] },
    merge: {
      postgresIn: 0,
      webIn: 0,
      mergedUnique: 0,
      postgresCappedTo: 0,
      webCappedTo: 0,
      blockedDropped: { postgres: 0, web: 0 },
      dedupedByIdOrUrl: 0,
    },
    date: {
      cutoffIso: new Date(cutoffMs).toISOString(),
      requirePublishedDate: periodDays <= 31,
      beforeFilter: 0,
      afterHydrate: 0,
      afterFilter: 0,
    },
  };
}

export type ContentSeedType = "case_study" | "blog_post" | "newsletter_feature" | "webinar" | "research_report" | "benchmark" | "other";

interface ScoredIdeaCandidate {
  doc: AgentRankedDoc;
  seedType: ContentSeedType;
  score: number;
  contentSeedScore: number;
  guardrailViolation: boolean;
  segment: ContentIdea["target_segment"];
  persona: ContentIdea["target_persona"];
  channel: ContentIdea["channel"];
}

type SegmentBucket = "beachhead" | "adjacent" | "broader";

const GTM_SIGNAL_TERMS = [
  "code search",
  "deep search",
  "cross-repo",
  "cross repo",
  "mcp",
  "context layer",
  "context engine",
  "batch changes",
  "migration",
  "remediation",
  "compliance",
  "self-hosted",
  "byok",
  "platform team",
];

const SOURCEGRAPH_PRODUCT_SUITE_SIGNALS = [
  "Code Search",
  "Deep Search",
  "Batch Changes",
  "Cody",
];

/**
 * True iff the doc is clearly relevant to GTM content ideas: developer tools, code intelligence,
 * enterprise dev, competitors, or control plane. Excludes web-search noise that has no real
 * relevance to our positioning or product.
 */
export function hasMinimumContentIdeasRelevance(doc: AgentRankedDoc): boolean {
  const text = textOf(doc);
  const title = (doc.title ?? "").toLowerCase();
  const snippet = text.slice(0, 1200);
  const canonicalUrl = canonicalizeUrl(doc.url);

  if (canonicalUrl && isGenericIdeaPage(canonicalUrl)) return false;

  const competitive =
    /(github|copilot|cursor|gitlab|augment|moderne|context engine|repo context)/.test(text);
  const enterprise =
    /(compliance|security|self-hosted|self hosted|byok|rbac|audit)/.test(text);
  const messageImpact =
    /(cross-repo|code search|deep search|batch changes|mcp|context layer|migration|remediation)/.test(
      text,
    );
  const controlPlane =
    /(code review|documentation|onboarding|vulnerability|remediation|batch changes|monitoring|observability)/.test(
      text,
    );
  const evidenceStyle =
    /(launch|release|\bga\b|pricing|customer|case study|benchmark|coding assistant|developer platform)/.test(
      text,
    );
  const devWorkflow =
    /(developer platform|platform engineering|internal developer|idp|devops|sre|monorepo|multi-repo|large codebase|codebase health|engineering velocity)/.test(
      text,
    );
  const codingContext =
    /(code search|deep search|code intelligence|codebase|repository|repo|pull request|developer|software delivery|sdlc|coding assistant|ai coding|platform engineering|developer platform|monorepo|multi-repo|cross-repo|mcp|model context protocol|batch changes|codemod|migration|remediation|sourcegraph|copilot|cursor|gitlab duo|claude code)/.test(
      `${title} ${snippet}`,
    );

  const strongMatch =
    competitive || enterprise || messageImpact || controlPlane || devWorkflow;

  const baseMatch = strongMatch || evidenceStyle;

  if (!baseMatch) return false;
  if (!codingContext && !competitive && !messageImpact && !devWorkflow) return false;

  if (strongMatch) return true;

  // evidenceStyle only: drop pure vendor model-release churn with no enterprise/dev workflow hook.
  const vendorModelChurn =
    /^(announcing|introducing|meet|say hello to|we('re| are) launching)\b/.test(title.trim()) ||
    /\b(anthropic|claude(\s+\d|\b)|openai|gpt-\d|gemini|deepseek)\b.*\b(model|release|available|now)\b/.test(
      title,
    );
  const hasWorkflowHook =
    /(enterprise|compliance|security|benchmark|case study|mcp|code search|deep search|batch changes|cursor|copilot|gitlab|github enterprise|self-hosted|byok|api pricing|customer|developer platform|coding assistant|cross-repo)/.test(
      `${title} ${snippet}`,
    );
  if (vendorModelChurn && !hasWorkflowHook) return false;

  return true;
}

function hasBroadSourcegraphNarrativeFit(doc: AgentRankedDoc): boolean {
  const text = textOf(doc);
  const title = (doc.title ?? "").toLowerCase();
  const canonicalUrl = canonicalizeUrl(doc.url);
  if (canonicalUrl && isGenericIdeaPage(canonicalUrl)) return false;
  const durableNarrative =
    /(compliance|security|audit|byok|self-hosted|self hosted|rbac|governance|policy|mcp|model context protocol|context layer|repo context|cross-repo|code search|deep search|batch changes|migration|remediation|verification|regression|impact analysis|onboarding|knowledge transfer|monorepo|multi-repo|large codebase|platform engineering|developer platform|engineering velocity|software lifecycle)/.test(
      text,
    );
  const codingContext =
    /(code|coding|codebase|repository|repo|developer|software|platform engineering|developer platform|pull request|sdlc|agent|assistant|mcp|code search|deep search|batch changes)/.test(
      `${title} ${text}`,
    );

  if (!codingContext) return false;

  if (durableNarrative) return true;

  const genericVendorUpdate =
    /(launch|release|update|available|now live|broader access|affordable access|general availability|\bga\b|v\d+\b|march 20\d{2} update|modernizing)/.test(
      `${title} ${text}`,
    );
  const weakOperationalTheme =
    /(cli|command line|terminal|runtime|platform update|release notes|changelog|version upgrade|tooling refresh)/.test(
      `${title} ${text}`,
    );

  if (genericVendorUpdate || weakOperationalTheme) return false;

  return /(developer productivity|engineering effectiveness|judgment bottleneck|precision retrieval|context overload)/.test(
    text,
  );
}

const NOISY_DOMAINS = new Set([
  "xcancel.com",
  "twitter.com",
  "x.com",
  "click.kit-mail3.com",
  "click.kit-mail.com",
  "link.mail.beehiiv.com",
  "tech-insider.org",
]);

const TRUSTED_SECONDARY_DOMAINS = new Set([
  "infoq.com",
  "thenewstack.io",
  "thoughtworks.com",
  "martinfowler.com",
  "cncf.io",
  "cio.com",
  "techzine.eu",
  "infoworld.com",
  "computerworld.com",
  "theregister.com",
]);

const PREFERRED_SHORT_WINDOW_TECHNICAL_DOMAINS = new Set([
  "infoq.com",
  "thenewstack.io",
  "thoughtworks.com",
  "martinfowler.com",
  "cncf.io",
  "sourcegraph.com",
  "github.blog",
  "blog.cloudflare.com",
  "cio.com",
  "infoworld.com",
  "computerworld.com",
]);

const WEAK_SHORT_WINDOW_SECONDARY_DOMAINS = new Set([
  "fastcompany.com",
  "gitkraken.com",
  "forbes.com",
  "venturebeat.com",
  "entrepreneur.com",
  "inc.com",
  "businessinsider.com",
]);

const LOW_AUTHORITY_BUSINESS_PRESS_DOMAINS = new Set([
  "devops.com",
  "techcrunch.com",
  "venturebeat.com",
  "forbes.com",
  "businessinsider.com",
  "entrepreneur.com",
  "inc.com",
  "fastcompany.com",
]);

/** Domains whose content is often appsec/fuzzing/tooling rather than AI coding workflows; downgrade when doc doesn't mention AI coding. */
const TANGENTIAL_FOR_AI_CODING = new Set([
  "code-intelligence.com", // fuzzing, appsec webinars
  "snyk.io", // appsec, SAST (unless clearly AI coding)
]);

function isTangentialSourceForIdea(domain: string, text: string): boolean {
  if (!domain) return false;
  const base = domain.replace(/^www\./, "");
  if (!TANGENTIAL_FOR_AI_CODING.has(base)) return false;
  const strongAiCoding = /(ai coding|coding assistant|coding agent|context layer|mcp.*agent|agent.*mcp|copilot|cursor|claude code|code gen)/i.test(text);
  return !strongAiCoding;
}

function isNoisyDomain(domain: string): boolean {
  if (!domain) return false;
  if (NOISY_DOMAINS.has(domain)) return true;
  for (const noisy of NOISY_DOMAINS) {
    if (domain.endsWith(`.${noisy}`)) return true;
  }
  return false;
}

const TITLE_SIMILARITY_STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "for",
  "to",
  "of",
  "in",
  "on",
  "with",
  "from",
  "how",
  "what",
  "why",
  "when",
  "where",
  "guide",
  "playbook",
  "brief",
  "webinar",
  "talk",
  "track",
  "case",
  "study",
  "one",
  "pager",
]);

function sourceFromUrl(url: string | undefined): string {
  const domain = getDomainFromUrlCompetitor(url);
  return domain || "unknown";
}

function baseDomainFromHost(host: string): string {
  const clean = host.toLowerCase().replace(/^www\./, "");
  const parts = clean.split(".").filter(Boolean);
  if (parts.length <= 2) return clean;
  return `${parts[parts.length - 2]}.${parts[parts.length - 1]}`;
}

function sourceBaseDomain(url: string | undefined): string {
  const host = sourceFromUrl(url);
  return baseDomainFromHost(host);
}

function pathFromUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return "";
  }
}

function isGitHubFamilySource(url: string | undefined): boolean {
  const base = sourceBaseDomain(url);
  return base === "github.com" || base === "github.blog";
}

function isSourcegraphDomain(url: string | undefined): boolean {
  const base = sourceBaseDomain(url);
  return base === "sourcegraph.com";
}

function collectSourcegraphContextDocs(...docSets: RetrievedDoc[][]): RetrievedDoc[] {
  const docs = docSets.flat().filter((doc) => isSourcegraphDomain(doc.url));
  const seenUrls = new Set<string>();
  const uniqueDocs: RetrievedDoc[] = [];
  for (const doc of docs) {
    const canonicalUrl = canonicalizeUrl(doc.url);
    if (!canonicalUrl || seenUrls.has(canonicalUrl)) continue;
    seenUrls.add(canonicalUrl);
    uniqueDocs.push(doc);
    if (uniqueDocs.length >= 8) break;
  }
  return uniqueDocs;
}

async function loadSourcegraphContextFallbackDocs(query: string | null | undefined): Promise<RetrievedDoc[]> {
  const config = getAgentGoalConfig("content_ideas");
  const includeDomains = config.includeDomains ?? [];
  const includeTemplates = config.includeDomainsQueryTemplates ?? [];
  if (includeDomains.length === 0 || includeTemplates.length === 0) return [];

  const queries = query?.trim()
    ? [query, ...includeTemplates.slice(0, 1)]
    : includeTemplates.slice(0, 2);
  const byUrl = new Map<string, RetrievedDoc>();

  for (const q of queries) {
    const results = await searchWeb(q, {
      numResults: 4,
      domains: includeDomains.slice(0, 20),
      topic: "general",
      timeRange: "year",
    });
    for (const result of results) {
      const key = canonicalizeUrl(result.url);
      if (!key || byUrl.has(key)) continue;
      byUrl.set(key, {
        source: "web",
        url: result.url,
        title: result.title,
        snippet: result.content,
        content: result.content,
        publishedAt: result.publishedDate ? new Date(result.publishedDate) : undefined,
        metadata: { score: result.score, primarySource: "include_domains_fallback" },
      });
      if (byUrl.size >= 8) break;
    }
    if (byUrl.size >= 8) break;
  }

  return Array.from(byUrl.values());
}

function isGitHubDiscussionLikeUrl(url: string | undefined): boolean {
  return sourceBaseDomain(url) === "github.com" && /\/(discussions|issues)\//.test(pathFromUrl(url));
}

function isConversationStyleSource(url: string | undefined): boolean {
  const base = sourceBaseDomain(url);
  if (base === "reddit.com" || base === "news.ycombinator.com" || base === "linkedin.com") {
    return true;
  }
  if (base === "dev.to" || base === "medium.com") return true;
  return isGitHubDiscussionLikeUrl(url);
}

function isLowAuthorityBusinessPressDomain(domain: string): boolean {
  const base = domain.toLowerCase().replace(/^www\./, "");
  return LOW_AUTHORITY_BUSINESS_PRESS_DOMAINS.has(base);
}

function canonicalizeUrl(url: string | undefined): string {
  if (!url) return "";
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") return "";
    parsed.hash = "";
    ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "source"].forEach((p) =>
      parsed.searchParams.delete(p),
    );
    const query = parsed.searchParams.toString();
    parsed.search = query ? `?${query}` : "";
    return parsed.toString();
  } catch {
    return "";
  }
}

function extractJsonValue(text: string): unknown {
  const trimmed = text.trim();

  function tryParseJson(candidate: string): unknown {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON5.parse(candidate);
      } catch {
        try {
          return YAML.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }

  function extractBalancedJson(source: string, opener: "{" | "[", startIndex = 0): string | null {
    const closer = opener === "{" ? "}" : "]";
    const start = source.indexOf(opener, startIndex);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let stringQuote: "\"" | "'" | null = null;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === stringQuote) {
          inString = false;
          stringQuote = null;
        }
        continue;
      }
      if (ch === "\"" || ch === "'") {
        inString = true;
        stringQuote = ch;
        continue;
      }
      if (ch === opener) depth++;
      if (ch === closer) depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
    return null;
  }

  const direct = tryParseJson(trimmed);
  if (direct !== null) return direct;

  const fencedBlocks = Array.from(trimmed.matchAll(/```(?:json|jsonc)?\s*([\s\S]*?)\s*```/gi));
  for (const block of fencedBlocks) {
    const parsed = tryParseJson(block[1]);
    if (parsed !== null) return parsed;
    const balancedObject = extractBalancedJson(block[1], "{");
    if (balancedObject) {
      const parsedObject = tryParseJson(balancedObject);
      if (parsedObject !== null) return parsedObject;
    }
    const balancedArray = extractBalancedJson(block[1], "[");
    if (balancedArray) {
      const parsedArray = tryParseJson(balancedArray);
      if (parsedArray !== null) return parsedArray;
    }
  }

  const objectCandidate = extractBalancedJson(trimmed, "{");
  if (objectCandidate) {
    const parsedObject = tryParseJson(objectCandidate);
    if (parsedObject !== null) return parsedObject;
  }
  const arrayCandidate = extractBalancedJson(trimmed, "[");
  if (arrayCandidate) {
    const parsedArray = tryParseJson(arrayCandidate);
    if (parsedArray !== null) return parsedArray;
  }
  return null;
}

function extractIdeasArrayFromLlm(text: string): LlmContentIdeaDraft[] {
  const parsed = extractJsonValue(text);
  if (Array.isArray(parsed)) return parsed as LlmContentIdeaDraft[];
  if (parsed && typeof parsed === "object" && Array.isArray((parsed as Record<string, unknown>).ideas)) {
    return (parsed as Record<string, unknown>).ideas as LlmContentIdeaDraft[];
  }

  function tryParseIdea(candidate: string): unknown {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON5.parse(candidate);
      } catch {
        try {
          return YAML.parse(candidate);
        } catch {
          return null;
        }
      }
    }
  }

  function extractBalancedObject(source: string, startIndex = 0): string | null {
    const start = source.indexOf("{", startIndex);
    if (start === -1) return null;
    let depth = 0;
    let inString = false;
    let stringQuote: "\"" | "'" | null = null;
    let escaped = false;
    for (let i = start; i < source.length; i++) {
      const ch = source[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === stringQuote) {
          inString = false;
          stringQuote = null;
        }
        continue;
      }
      if (ch === "\"" || ch === "'") {
        inString = true;
        stringQuote = ch;
        continue;
      }
      if (ch === "{") depth++;
      if (ch === "}") depth--;
      if (depth === 0) {
        return source.slice(start, i + 1);
      }
    }
    return null;
  }

  function extractScalarField(candidate: string, field: string): string | undefined {
    const match = candidate.match(new RegExp(`["']${field}["']\\s*:\\s*["']([\\s\\S]*?)["']\\s*(?:,|\\n|$)`));
    return match?.[1]?.replace(/\\"/g, "\"").replace(/\\n/g, " ").trim();
  }

  const ideasKeyMatch = /["']?ideas["']?\s*:/.exec(text);
  if (!ideasKeyMatch) return [];
  const fromKey = text.slice(ideasKeyMatch.index);

  const arrayCandidate = (() => {
    const bracketOffset = fromKey.indexOf("[");
    if (bracketOffset === -1) return null;

    const start = ideasKeyMatch.index + bracketOffset;
    const closer = "]";
    let depth = 0;
    let inString = false;
    let stringQuote: "\"" | "'" | null = null;
    let escaped = false;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (ch === "\\") {
          escaped = true;
          continue;
        }
        if (ch === stringQuote) {
          inString = false;
          stringQuote = null;
        }
        continue;
      }
      if (ch === "\"" || ch === "'") {
        inString = true;
        stringQuote = ch;
        continue;
      }
      if (ch === "[") depth++;
      if (ch === closer) depth--;
      if (depth === 0) {
        return text.slice(start, i + 1);
      }
    }
    return null;
  })();

  if (arrayCandidate) {
    try {
      const parsedArray = JSON.parse(arrayCandidate);
      return Array.isArray(parsedArray) ? (parsedArray as LlmContentIdeaDraft[]) : [];
    } catch {
      try {
        const parsedArray = JSON5.parse(arrayCandidate);
        return Array.isArray(parsedArray) ? (parsedArray as LlmContentIdeaDraft[]) : [];
      } catch {
        try {
          const parsedArray = YAML.parse(arrayCandidate);
          return Array.isArray(parsedArray) ? (parsedArray as LlmContentIdeaDraft[]) : [];
        } catch {
          // Fall through and salvage complete objects from a truncated array.
        }
      }
    }
  }

  const bracketOffset = fromKey.indexOf("[");
  if (bracketOffset === -1) return [];
  const partialIdeas: LlmContentIdeaDraft[] = [];
  let searchFrom = ideasKeyMatch.index + bracketOffset + 1;
  while (searchFrom < text.length) {
    const objectCandidate = extractBalancedObject(text, searchFrom);
    if (!objectCandidate) break;
    const parsedObject = tryParseIdea(objectCandidate);
    if (parsedObject && typeof parsedObject === "object" && !Array.isArray(parsedObject)) {
      partialIdeas.push(parsedObject as LlmContentIdeaDraft);
    } else {
      const title = extractScalarField(objectCandidate, "title");
      const thesis = extractScalarField(objectCandidate, "thesis");
      const sourceUrls = Array.from(objectCandidate.matchAll(/https?:\/\/[^\s"']+/g), (match) => match[0]);
      if (title && thesis) {
        partialIdeas.push({
          title,
          thesis,
          source_urls: sourceUrls,
        });
      }
    }
    const objectStart = text.indexOf(objectCandidate, searchFrom);
    if (objectStart === -1) break;
    searchFrom = objectStart + objectCandidate.length;
  }
  return partialIdeas;
}

function isGenericIdeaPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    if (path === "" || path === "/") return true;
    if (/^\/(docs|documentation|product|products|features|pricing|careers|company|about)$/.test(path)) return true;
    if (/^\/(topics|trending|collections|marketplace)(\/|$)/.test(path)) return true;
    return false;
  } catch {
    return true;
  }
}

function stripBoilerplateNoise(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\bsection title:\s*/gi, " ")
    .replace(/\bcontent:\s*/gi, " ")
    .replace(/\btable of contents\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function toSegmentBucket(
  segment: ContentIdea["target_segment"],
  state: PlaybookState,
): SegmentBucket {
  if (segment === state.primary_beachhead) return "beachhead";
  if (state.adjacent_segments.includes(segment)) return "adjacent";
  return "broader";
}

function normalizeTargetSegment(
  raw: string | undefined,
): ContentIdea["target_segment"] {
  if (!raw) return "Other";
  if (raw === "Capital Markets") return "Capital Markets";
  if (raw === "Banks") return "Banks";
  if (raw === "Diversified Financial Services") return "Diversified Financial Services";
  if (raw === "Insurance") return "Insurance";
  return "Other";
}

function detectTopicFrame(text: string): string {
  const governedAiCodeChangeSignal =
    hasComplianceControlSignal(text) ||
    (/(governance|compliance|audit|policy|enterprise controls|verification)/.test(text) &&
      /(code|coding|codebase|repository|repo|pull request|developer platform|platform engineering|coding assistant|ai coding|batch changes|migration|remediation|mcp|code search|deep search)/.test(
        text,
      ));
  if (hasComplianceControlSignal(text)) {
    return "Governance, Compliance, and Verification for AI Code Changes";
  }
  if (
    /(privacy|de-anonymization|data exposure|sensitive context|governance risk|agent security|verification)/.test(text) &&
    /(compliance|audit|policy|security|byok|self-hosted|self hosted)/.test(text) &&
    /(code|coding|codebase|repository|repo|developer|assistant|agent|pull request|sdlc)/.test(text)
  ) {
    return "Governance, Compliance, and Verification for AI Code Changes";
  }
  if (/(batch changes|codemod|migration|remediation|rollout|upgrade)/.test(text)) {
    return "Cross-Repo Remediation and Migration";
  }
  if (/(mcp|model context protocol|context layer|repo context|retrieval precision|repository context)/.test(text)) {
    return "Repository Context and Retrieval Precision for Coding Agents";
  }
  if (/(deep search|code search|semantic search|cross-repo search)/.test(text)) {
    return "Code Search, Deep Search, and Repository Context";
  }
  if (/(onboarding|knowledge transfer|legacy|complex codebase|monorepo|multi-repo)/.test(text)) {
    return "Developer Onboarding in Large Codebases";
  }
  if (governedAiCodeChangeSignal) {
    return "Governance and Auditability for Enterprise Coding Workflows";
  }
  return "Enterprise Code Intelligence and Governed Development Workflows";
}

function buildNarrativeTopic(frame: string, text: string): string {
  switch (frame) {
    case "Governance, Compliance, and Verification for AI Code Changes":
      if (/(audit|policy|byok|self-hosted|self hosted|soc ?2|fedramp|iso ?27001)/.test(text)) {
        return "Audit-Ready AI Code Change Workflows";
      }
      return "Governing AI Code Changes Across Large Codebases";
    case "Code Search, Deep Search, and Repository Context":
      if (/(developer platform|platform engineering)/.test(text)) {
        return "Repository Context for Developer Platforms";
      }
      if (/(agent|retrieval|mcp|context layer|repository context)/.test(text)) {
        return "Repository Context as the Control Layer for Coding Agents";
      }
      return "Retrieval Precision for Enterprise Codebases";
    case "Repository Context and Retrieval Precision for Coding Agents":
      if (/(developer platform|platform engineering)/.test(text)) {
        return "Why Developer Platforms Need a Repository Context Layer";
      }
      return "Repository Context as the Control Layer for Coding Agents";
    case "Cross-Repo Remediation and Migration":
      if (/(security|cve|patch|remediation)/.test(text)) {
        return "Cross-Repo Remediation Workflows with Verification";
      }
      if (/(migration|upgrade|deprecation|modernization)/.test(text)) {
        return "Cross-Repo Upgrade and Migration Workflows";
      }
      return "Cross-Repo Change Rollouts Without Regression Blind Spots";
    case "Developer Onboarding in Large Codebases":
      return "Onboarding and Knowledge Transfer in Large Codebases";
    case "Governance and Auditability for Enterprise Coding Workflows":
      return "Governance and Auditability for Enterprise Coding Workflows";
    default:
      return "Enterprise Code Intelligence for Governed Development Workflows";
  }
}

function ideaFrameKey(idea: Pick<ContentIdea, "title" | "thesis" | "core_claim">): string {
  return detectTopicFrame(`${idea.title} ${idea.thesis} ${idea.core_claim}`.toLowerCase());
}

function docSupportsFrame(doc: AgentRankedDoc, frame: string): boolean {
  const text = textOf(doc);
  switch (frame) {
    case "Governance, Compliance, and Verification for AI Code Changes":
      return hasComplianceControlSignal(text);
    case "Repository Context and Retrieval Precision for Coding Agents":
      return /(mcp|model context protocol|context layer|repo context|agent context)/.test(text);
    case "Cross-Repo Remediation and Migration":
      return /(batch changes|codemod|migration|remediation|large-scale code change)/.test(text);
    case "Code Search, Deep Search, and Repository Context":
      return /(deep search|code search|semantic search|cross-repo search|symbol search)/.test(text);
    case "Governance and Auditability for Enterprise Coding Workflows":
      return (
        /(governance|compliance|audit|policy|enterprise controls|verification)/.test(text) &&
        /(code|coding|codebase|repository|repo|developer|assistant|agent|pull request|sdlc)/.test(text)
      );
    case "Developer Onboarding in Large Codebases":
      return /(onboarding|knowledge transfer|legacy|complex codebase|monorepo|multi-repo)/.test(text);
    default:
      return /(code intelligence|cross-repo|developer platform|coding assistant|enterprise codebase)/.test(text);
  }
}

function tokenizeTitleForSimilarity(title: string): Set<string> {
  return new Set(
    title
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((t) => t.length >= 4 && !TITLE_SIMILARITY_STOPWORDS.has(t)),
  );
}

function titleOverlapRatio(a: string, b: string): number {
  const aTokens = tokenizeTitleForSimilarity(a);
  const bTokens = tokenizeTitleForSimilarity(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap / Math.max(1, Math.min(aTokens.size, bTokens.size));
}

function normalizeIdeaTitleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s:]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function topicKeyFromIdeaTitle(title: string): string {
  const topic = title.replace(/^[^:]+:\s*/, "").trim().toLowerCase();
  return topic.replace(/\s+/g, " ").trim();
}

function thesisSimilarityKey(thesis: string): string {
  return thesis
    .toLowerCase()
    .replace(/sourcegraph/g, "")
    .replace(/coding assistants?/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\b(for|the|and|with|while|to|of|in|at|across|around)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function stableHash(input: string): number {
  let h = 0;
  for (let i = 0; i < input.length; i++) {
    h = (h * 31 + input.charCodeAt(i)) >>> 0;
  }
  return h;
}

function topicFromSourceTitle(title: string): string | null {
  const cleaned = title
    .replace(/^\s*github\s*-\s*/i, "")
    .replace(/^\s*gitlab\s*-\s*/i, "")
    .replace(/^\s*sourcegraph\s*-\s*/i, "")
    .replace(/^\s*(webinar|guide|blog|case study|talk track|brief|playbook)\s*:\s*/i, "")
    .replace(/\s*[-|:]\s*(github|sourcegraph|arxiv|hacker news|hn)\b.*$/i, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned || cleaned.length < 20) return null;
  if (/(home|homepage|index|latest|updates)$/i.test(cleaned)) return null;
  return cleaned.slice(0, 90);
}

function shouldPreferBroadThemeTopic(
  text: string,
  sourceTitle?: string,
  sourceUrl?: string,
): boolean {
  const domain = sourceFromUrl(sourceUrl);
  if (isAuthoritativeResearchOrStandardsDomain(domain)) return true;

  const researchHeavyTitle =
    /(zero-shot|sim2real|ontology|diffusion|multimodal|benchmarking|de-anonymization|inference-driven|representation learning)/i.test(
      sourceTitle ?? "",
    );
  const directWorkflowSignal =
    /(code|coding|repository|repo|codebase|developer platform|platform engineering|software lifecycle|coding assistant|agentic ai|cross-repo|mcp|batch changes|deep search|code search|compliance|governance)/.test(
      `${sourceTitle ?? ""} ${text}`,
    );
  const genericVendorOrProductTitle =
    /(\[ai ?news\]|announcing|introducing|launch|launches|release|update|now available|now live|broader access|affordable access|modernizing|march 20\d{2} update|v\d+\b|shifts to coding|pulls ahead|runs large models|growing pains)/i.test(
      sourceTitle ?? "",
    );
  return (researchHeavyTitle && !directWorkflowSignal) || genericVendorOrProductTitle;
}

function extractIdeaTopic(text: string, sourceTitle?: string, sourceUrl?: string): string {
  const frame = detectTopicFrame(text);
  if (shouldPreferBroadThemeTopic(text, sourceTitle, sourceUrl)) {
    return buildNarrativeTopic(frame, text);
  }
  const derivedTopic = sourceTitle ? topicFromSourceTitle(sourceTitle) : null;
  const productLedDerivedTopic =
    !!derivedTopic &&
    /(code search|deep search|repository context|retrieval precision|governance|compliance|batch changes|sourcegraph|gitlab|github|workers ai)/i.test(
      derivedTopic,
    );
  if (derivedTopic && derivedTopic.length >= 18 && !productLedDerivedTopic) return derivedTopic;
  return buildNarrativeTopic(frame, text);
}

function toTitleCase(input: string): string {
  const acronyms = new Set(["ai", "llm", "mcp", "idp", "byok", "rbac", "sdlc"]);
  const stopwords = new Set(["and", "or", "for", "the", "to", "of", "in", "on", "at", "with"]);
  return input
    .split(/\s+/)
    .filter(Boolean)
    .map((word, index) => {
      const normalized = word.toLowerCase();
      if (acronyms.has(normalized)) return normalized.toUpperCase();
      if (index > 0 && stopwords.has(normalized)) return normalized;
      if (word.length <= 2) return word.toLowerCase();
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ");
}

function polishIdeaTopic(rawTopic: string): string {
  let topic = rawTopic
    .replace(/\bcodemod\/codemod\b/gi, "Codemod CLI")
    .replace(/\bgithub\s*-\s*/gi, "")
    .replace(/\bgitlab\s*-\s*/gi, "")
    .replace(/\bsourcegraph\s*-\s*/gi, "")
    .replace(/\s+[—-]\s+The CLI for Codemods.*$/i, " Codemod Workflows at Scale")
    .replace(/\s+[—-]\s+/g, ": ")
    .replace(/\s+/g, " ")
    .trim();
  if (topic.length > 88) {
    topic = topic.slice(0, 88).replace(/\s+\S*$/, "");
  }
  return toTitleCase(topic);
}

function buildSourcegraphIdeaTitle(
  _segment: ContentIdea["target_segment"],
  channel: ContentIdea["channel"],
  text: string,
  sourceTitle?: string,
  sourceUrl?: string,
): string {
  const safeTopic = polishIdeaTopic(extractIdeaTopic(text, sourceTitle, sourceUrl));

  const channelVerb: Record<ContentIdea["channel"], string> = {
    whitepaper: "Guide",
    webinar: "Webinar",
    event_talk: "Talk Track",
    blog: "Brief",
    SEO_page: "Playbook",
    case_study: "Case Study",
    email_sequence: "Email Series",
    sales_one_pager: "One-Pager",
    long_video: "Video Brief",
    short_video: "Short Video",
    ad_campaign: "Campaign",
  };

  return `${channelVerb[channel]}: ${safeTopic}`.slice(0, 120);
}

function buildSourcegraphThesis(
  segment: ContentIdea["target_segment"],
  persona: ContentIdea["target_persona"],
  text: string,
  sourceTitle?: string,
  sourceUrl?: string,
): string {
  const topic = polishIdeaTopic(extractIdeaTopic(text, sourceTitle, sourceUrl)).toLowerCase();
  const frame = detectTopicFrame(text);
  const segmentContext =
    segment === "Other"
      ? "platform and engineering teams"
      : `${segment} and adjacent regulated-industry teams`;
  const variants =
    frame === "Cross-Repo Remediation and Migration"
      ? [
          `${segmentContext} ${persona} buyers need a repeatable way to execute cross-repo remediation and migration with verification, review, and rollback built in; position Sourcegraph as the governed execution layer around existing assistants.`,
          `Use ${topic} to show ${segmentContext} ${persona} buyers that assistant suggestions are not enough for large migrations; Sourcegraph adds the search, rollout, and verification workflow needed to ship safely at scale.`,
        ]
      : frame === "Repository Context and Retrieval Precision for Coding Agents" ||
          frame === "Code Search, Deep Search, and Repository Context"
        ? [
            `${segmentContext} ${persona} buyers evaluating coding agents need precise repository context before generation; position Sourcegraph as the retrieval and grounding layer that makes assistant workflows reliable in large codebases.`,
            `Anchor ${topic} on the shift from generic prompts to repository-aware workflows: Sourcegraph gives ${segmentContext} ${persona} buyers the codebase context and verification path that assistant-only tools lack.`,
          ]
        : /Governance/.test(frame)
          ? [
              `${segmentContext} ${persona} buyers need a way to govern AI-generated code changes with audit-ready controls, policy enforcement, and codebase-wide verification; frame Sourcegraph as the enterprise control layer around existing assistants.`,
              `Use ${topic} to show ${segmentContext} ${persona} buyers that the real enterprise gap is not generation quality but governed execution, auditability, and verification across the codebase.`,
            ]
          : [
              `For ${segmentContext} ${persona} buyers, position Sourcegraph around ${topic} to execute cross-repo change safely at scale while complementing existing coding assistants.`,
              `${segmentContext} ${persona} buyers evaluating ${topic} need an approach that connects codebase context, verification, and rollout instead of another assistant surface.`,
            ];
  return variants[stableHash(`${topic}|${segment}|${persona}`) % variants.length];
}

function buildKeyInsights(
  segment: ContentIdea["target_segment"],
  persona: ContentIdea["target_persona"],
  text: string,
  sourceTitle?: string,
  sourceUrl?: string,
): string[] {
  const topic = extractIdeaTopic(text, sourceTitle, sourceUrl).toLowerCase();
  return [
    `${segment === "Other" ? "Enterprise platform teams" : segment} ${persona} buyers need reliable cross-repo context, not another assistant surface.`,
    `Sourcegraph’s differentiation in ${topic} should be framed as complementary to Cursor/Copilot/Claude Code.`,
    "GTM motion should emphasize enterprise controls (compliance, BYOK/self-hosted, auditability) with concrete operational examples.",
  ];
}

function buildContentOutline(
  segment: ContentIdea["target_segment"],
  persona: ContentIdea["target_persona"],
  channel: ContentIdea["channel"],
  text: string,
  sourceTitle?: string,
  sourceUrl?: string,
): string[] {
  const topic = extractIdeaTopic(text, sourceTitle, sourceUrl).toLowerCase();
  const channelLabelMap: Record<ContentIdea["channel"], string> = {
    event_talk: "talk",
    webinar: "webinar",
    whitepaper: "whitepaper",
    blog: "blog",
    SEO_page: "SEO page",
    case_study: "case study",
    email_sequence: "email sequence",
    sales_one_pager: "sales one-pager",
    long_video: "long-form video",
    short_video: "short-form video",
    ad_campaign: "ad campaign",
  };
  const channelLabel = channelLabelMap[channel];
  return [
    `Context: why ${segment === "Other" ? "platform teams" : segment} teams care about ${topic} now`,
    `Problem framing for ${persona}: limits of assistant-only workflows in large, complex codebases`,
    "Sourcegraph POV: use Code Search + Deep Search for accurate context, then Batch Changes for safe large-scale execution.",
    "Proof section: product evidence + customer signal + external market trigger",
    `CTA for ${channelLabel}: convert to a scoped next step (buyer workshop, follow-up meeting, or technical validation).`,
  ];
}

function buildDistributionPlan(
  channel: ContentIdea["channel"],
  text: string,
): ContentIdea["distribution_plan"] {
  if (channel === "long_video") {
    return {
      primary_format: "Long-form technical video",
      recommended_venue: "YouTube + company video hub",
      channel_strategy: "Publish as a deep technical walkthrough, then slice clips for social and embed in related blog/docs pages.",
      setup_steps: [
        "Script one end-to-end technical narrative tied to a real repo workflow.",
        "Record demo plus architecture explainer with clear before/after outcomes.",
        "Repurpose into timestamped clips and add links to trial/demo CTA.",
      ],
    };
  }
  if (channel === "short_video") {
    return {
      primary_format: "Short-form video series",
      recommended_venue: "LinkedIn, YouTube Shorts, and X",
      channel_strategy: "Ship 3-5 clips around one theme, each with one concrete insight and one CTA to a deeper asset.",
      setup_steps: [
        "Pick one message pillar and create a 3-clip sequence.",
        "Keep each clip focused on one workflow pain and one proof point.",
        "Link every clip to a webinar, guide, or product demo page.",
      ],
    };
  }
  if (channel === "ad_campaign") {
    return {
      primary_format: "Paid ad campaign",
      recommended_venue: "LinkedIn and developer newsletter sponsorships",
      channel_strategy: "Run persona-specific ads that route to a single high-intent asset and retarget engaged visitors.",
      setup_steps: [
        "Create separate ad sets for platform leaders vs staff engineers.",
        "Test problem-first and proof-first creative variants with the same offer.",
        "Track lead quality and feed winning creative back into organic content.",
      ],
    };
  }
  if (channel === "event_talk") {
    return {
      primary_format: "Conference talk",
      recommended_venue: /(finserv|capital market|bank|insurance|regulated)/.test(text)
        ? "FinServ engineering conference or regulated-industry platform event"
        : "Developer platform/architecture conference",
      channel_strategy: "Lead with the talk, then publish a recap blog and send targeted follow-up email to attendees and pipeline accounts.",
      setup_steps: [
        "Define the abstract around one Sourcegraph workflow (cross-repo remediation, MCP context, or compliance controls).",
        "Secure a customer/partner proof point and one concrete demo narrative.",
        "Prepare post-event assets: recap blog, one-pager, and follow-up email sequence.",
      ],
    };
  }
  if (channel === "webinar") {
    return {
      primary_format: "Live webinar",
      recommended_venue: "Owned webinar with partner/customer guest",
      channel_strategy: "Run webinar as primary conversion event, then syndicate highlights in blog and nurture email.",
      setup_steps: [
        "Pick one target persona and one job-to-be-done for the webinar.",
        "Build agenda with problem framing, product walkthrough, and proof section.",
        "Create registration page, follow-up sequence, and rep-ready summary deck.",
      ],
    };
  }
  if (channel === "whitepaper") {
    return {
      primary_format: "Analyst-style whitepaper",
      recommended_venue: "Gated asset on site with sales-led distribution",
      channel_strategy: "Use whitepaper for validation/business-case stages, supported by blog teaser and account-based email.",
      setup_steps: [
        "Define decision criteria and enterprise requirements the paper will evaluate.",
        "Anchor claims to product evidence, customer proof, and one external market trigger.",
        "Produce derivative assets: executive summary page and sales enablement one-pager.",
      ],
    };
  }
  if (channel === "SEO_page") {
    return {
      primary_format: "SEO landing page",
      recommended_venue: "High-intent solution page in site docs/marketing",
      channel_strategy: "Publish as evergreen inbound entry point, with supporting blog and internal linking from related pages.",
      setup_steps: [
        "Select one high-intent query and map to persona pain plus Sourcegraph differentiator.",
        "Include comparison section, implementation guidance, and proof blocks.",
        "Set up internal links, CTA routing, and monthly refresh cadence.",
      ],
    };
  }
  if (channel === "case_study") {
    return {
      primary_format: "Customer case study",
      recommended_venue: "Website case-study hub plus sales distribution",
      channel_strategy: "Use as late-stage proof, paired with vertical blog and targeted account email.",
      setup_steps: [
        "Secure customer approval for narrative and measurable outcome.",
        "Structure story around baseline problem, implementation, and business impact.",
        "Package excerpt variants for sales decks and nurture sequences.",
      ],
    };
  }
  if (channel === "email_sequence") {
    return {
      primary_format: "Persona-specific email sequence",
      recommended_venue: "Outbound and nurture programs",
      channel_strategy: "Use email as the primary touchpoint, supported by one anchor asset (blog, whitepaper, or talk recap).",
      setup_steps: [
        "Segment audience by persona and account stage.",
        "Map each email to one insight and one clear CTA.",
        "Track opens/replies and feed winning variants into SDR/AE plays.",
      ],
    };
  }
  if (channel === "sales_one_pager") {
    return {
      primary_format: "Sales one-pager",
      recommended_venue: "Sales playbooks and deal rooms",
      channel_strategy: "Use one-pager for active deals, backed by deeper assets for technical and executive audiences.",
      setup_steps: [
        "Condense value prop, proof points, and objection handling into one page.",
        "Align copy with current guardrails and approved competitive framing.",
        "Pair with one technical deep-dive asset for follow-up.",
      ],
    };
  }
  return {
    primary_format: "Blog post",
    recommended_venue: "Company blog and content hub",
    channel_strategy: "Use blog as the anchor piece and distribute through email and social snippets.",
    setup_steps: [
      "Define one sharp thesis and one target persona per post.",
      "Include practical examples and clear next-step CTA.",
      "Repurpose key sections into short-form email and sales snippets.",
    ],
  };
}

function textOf(doc: AgentRankedDoc): string {
  return `${doc.title} ${doc.snippet ?? ""} ${doc.content ?? ""}`.toLowerCase();
}

function detectSegment(text: string): ContentIdea["target_segment"] {
  if (/(capital market|trading|broker|front office|market data)/.test(text)) return "Capital Markets";
  if (/(bank|banking|core banking)/.test(text)) return "Banks";
  if (/(diversified financial services|wealth management|finserv)/.test(text)) return "Diversified Financial Services";
  if (/(insurance|underwriting|claims)/.test(text)) return "Insurance";
  return "Other";
}

function detectPersona(text: string): ContentIdea["target_persona"] {
  const explicitSecurityBuyer =
    /(security\/compliance|security and compliance|ciso|security leader|compliance leader|appsec|security buyer|compliance buyer)/.test(
      text,
    );
  const governanceSignal = /(security|compliance|audit|byok|self-hosted|self hosted|policy|rbac)/.test(
    text,
  );
  const platformSignal =
    /(platform team|developer platform|platform engineering|internal developer platform|idp|devex|developer experience)/.test(
      text,
    );
  const handsOnTechnicalWorkflow =
    /(repository context|repo context|code search|deep search|mcp|model context protocol|cross-repo|migration|remediation|verification|rollout|batch changes|developer workflow|coding agent)/.test(
      text,
    );
  const explicitExecutiveSignal =
    /(vp engineering|engineering vp|cto|chief technology officer|executive buyer|board-level|budget owner|roi|tco|procurement)/.test(
      text,
    );
  if (explicitSecurityBuyer) return "Security/Compliance";
  if (platformSignal) return "Head of Developer Platform";
  if (handsOnTechnicalWorkflow && !explicitExecutiveSignal) return "Staff Engineer";
  if (explicitExecutiveSignal || /(engineering leader)/.test(text)) return "VP Engineering";
  if (governanceSignal) return "Security/Compliance";
  return "Staff Engineer";
}

function detectChannel(text: string, state: PlaybookState): ContentIdea["channel"] {
  void state;
  if (/(ad campaign|paid campaign|paid social|display ads|sponsorship campaign|retargeting)/.test(text)) return "ad_campaign";
  if (/(short video|youtube short|tiktok|reel|short-form video)/.test(text)) return "short_video";
  if (/(video walkthrough|long-form video|youtube|demo video)/.test(text)) return "long_video";
  if (/(event|conference|summit|meetup|talk)/.test(text)) return "event_talk";
  if (/(webinar|workshop|panel)/.test(text)) return "webinar";
  if (/(whitepaper|white paper|guide|analyst|research report)/.test(text)) return "whitepaper";
  if (/(seo|search trend|organic search|keyword)/.test(text)) return "SEO_page";
  if (/(case study|customer story|reference)/.test(text)) return "case_study";
  if (/(one[-\s]?pager|battlecard|enablement sheet|deal sheet)/.test(text)) return "sales_one_pager";
  if (/(email sequence|nurture|outreach cadence)/.test(text)) return "email_sequence";
  if (/(blog|post|newsletter)/.test(text)) return "blog";
  return "blog";
}

function detectGuardrailViolation(text: string): boolean {
  if (/(replace github|replace cursor|replace copilot|beat cursor|beat copilot)/.test(text)) return true;
  if (/(sourcegraph.*ai assistant|ai assistant.*sourcegraph)/.test(text)) return true;
  return false;
}

function hasConcreteEvidence(text: string): boolean {
  return /(launch|release|\bga\b|general availability|pricing|customer|case study|benchmark|docs|documentation|security|compliance|audit|byok|self-hosted|self hosted|report|availability|available|credits|supports|integration|policy|verification)/.test(
    text,
  );
}

function hasStrongAnchorEvidence(text: string): boolean {
  return /(customer|case study|benchmark|docs|documentation|ga|general availability|launch|release|pricing|byok|self-hosted|self hosted|rbac|policy enforcement|credits)/.test(
    text,
  );
}

/** Classify the source/format type for content seeding. */
function classifyContentSeedType(text: string, _domain: string): ContentSeedType {
  const isCaseStudy = /(case study|customer story|customer success|reference account|reference customer)/.test(text);
  const isBlog = /(blog|post|article|story|byline|written by)/.test(text) && !isCaseStudy && !/(newsletter|email|dispatch)/.test(text);
  const isNewsletter = /(newsletter|email|dispatch|morning|update|digest|roundup)/.test(text);
  const isWebinar = /(webinar|workshop|panel|presentation|conference talk|virtual event)/.test(text);
  const isResearchReport = /(research|study|report|survey|analysis|benchmark|findings|data|whitepaper|white paper)/.test(text);
  const isBenchmark = /(benchmark|benchmarking|performance|results|comparison|evaluated)/.test(text);

  if (isCaseStudy) return "case_study";
  if (isBlog) return "blog_post";
  if (isNewsletter) return "newsletter_feature";
  if (isWebinar) return "webinar";
  if (isBenchmark) return "benchmark";
  if (isResearchReport) return "research_report";
  return "other";
}

function buildWhyNow(doc: AgentRankedDoc, text: string): string {
  const source = sourceFromUrl(doc.url);
  const date = doc.publishedAt ? doc.publishedAt.toISOString().slice(0, 10) : "recently";
  if (/(launch|release|\bga\b|pricing)/.test(text)) {
    return `Fresh product signal from ${source} (${date}) creates a concrete hook for near-term GTM content.`;
  }
  if (/(customer|case study|benchmark|report)/.test(text)) {
    return `External proof signal from ${source} (${date}) can strengthen credibility in active opportunities.`;
  }
  return `Recent signal from ${source} (${date}) is relevant but should be paired with one corroborating source before broad activation.`;
}

function buildCoreClaim(text: string): string {
  if (/(migration|remediation|codemod|batch changes)/.test(text)) {
    return "Sourcegraph turns large-scale code change work into a controlled, cross-repo workflow with verification loops.";
  }
  if (/(mcp|context layer|repo context)/.test(text)) {
    return "Sourcegraph acts as the repo context layer that makes existing assistants more reliable across complex codebases.";
  }
  if (hasComplianceControlSignal(text) || /(compliance|security|audit|byok|self-hosted)/.test(text)) {
    return "Sourcegraph provides an enterprise control layer (Code Search, Deep Search, Batch Changes) for governed AI coding workflows.";
  }
  return "Sourcegraph complements coding assistants with cross-repo understanding, precise retrieval, and safer execution.";
}

function buildEvidenceQualityNote(doc: AgentRankedDoc, text: string): string {
  const domain = sourceFromUrl(doc.url);
  if (isTangentialSourceForIdea(domain, text)) {
    return "Moderate confidence: source is tangential (e.g. appsec/fuzzing); use for monitoring only unless content clearly addresses AI coding workflows.";
  }
  const sourceType = classifySourceTypeByDomain(domain);
  const concrete = hasConcreteEvidence(text);
  if (sourceType === "primary" && concrete) return "High-confidence: primary source with concrete evidence.";
  if (sourceType === "secondary" && concrete) return "Moderate confidence: concrete secondary source; corroborate once.";
  if (sourceType === "community") return "Low confidence: community signal; use as hypothesis only.";
  return "Low confidence: weak evidence; monitor before promoting.";
}

function hasStrongMaterialSignal(text: string): boolean {
  return /(ga|general availability|launch|release|pricing|customer|case study|benchmark|security|compliance|byok|rbac|self-hosted|enterprise)/.test(
    text,
  );
}

function isAcademicResearchDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return (
    d === "arxiv.org" ||
    d === "openreview.net" ||
    d === "acm.org" ||
    d.endsWith(".acm.org")
  );
}

function hasCommercialProductMarketSignal(text: string): boolean {
  const launchOrProof =
    /(launch|release|\bga\b|general availability|pricing|customer|case study|benchmark|docs|documentation|enterprise plan|security|compliance|byok|self-hosted|rbac)/.test(
      text,
    );
  const vendorOrCompetitor =
    /(github|copilot|cursor|augment|gitlab duo|windsurf|codeium|claude code|sourcegraph|moderne|qodo|greptile|semgrep|codesee)/.test(
      text,
    );
  return launchOrProof || vendorOrCompetitor;
}

function isResearchOnlySource(doc: AgentRankedDoc, periodDays: number): boolean {
  const domain = sourceFromUrl(doc.url);
  if (!isAcademicResearchDomain(domain)) return false;
  const text = textOf(doc);
  const directWorkflowSignal =
    /(\bmcp\b|context layer|code search|deep search|cross-repo|batch changes|migration|remediation|onboarding|compliance|governance|developer platform|platform engineering|coding assistant|ai coding|software lifecycle|\brepository\b|\brepo\b|codebase|code intelligence)/.test(
      text,
    );
  const commercialSignal = hasCommercialProductMarketSignal(text);
  if (periodDays <= 14) {
    // For short windows, academic papers need a direct coding-workflow hook.
    return !directWorkflowSignal;
  }
  // For month-window content ideation, avoid academic-only sources unless they clearly tie
  // to live market/product signals and GTM-relevant workflows.
  return !(commercialSignal && directWorkflowSignal);
}

function isLowLeverageOperationalSource(doc: AgentRankedDoc, periodDays: number): boolean {
  const text = textOf(doc);
  const url = (doc.url ?? "").toLowerCase();
  const title = (doc.title ?? "").toLowerCase();

  // For month windows, avoid operational changelog noise unless it's a material market move.
  if (periodDays > 14 && /github\.blog\/changelog\//.test(url)) {
    const operationalOnly = /(network configuration|allowlist|allow list|ip range|routing|telemetry|endpoint|connectivity)/.test(
      `${title} ${text}`,
    );
    const strategicSignal = /(customer|case study|benchmark|pricing|\bga\b|general availability|launch|security|compliance|byok|rbac|self-hosted|mcp|code search|deep search|batch changes)/.test(
      text,
    );
    const lowLeverageOperational = operationalOnly && !strategicSignal;
    if (lowLeverageOperational) return true;
  }

  // Listicles and generic ranking pages are weak ideation anchors.
  if (
    /(best\s+\d*.*ai tools?|top\s+\d+.*ai tools?|ranked overview|tools? for coding in \d{4})/.test(
      `${title} ${text}`,
    )
  ) {
    return true;
  }

  return false;
}

function isWeakAnchorSource(doc: AgentRankedDoc, periodDays: number): boolean {
  const canonicalUrl = canonicalizeUrl(doc.url) || doc.url;
  const domain = sourceFromUrl(canonicalUrl);
  const title = (doc.title ?? "").toLowerCase();

  if (isConversationStyleSource(canonicalUrl)) return true;

  if (periodDays <= 14 && isLowAuthorityBusinessPressDomain(domain)) {
    return true;
  }

  if (
    periodDays <= 14 &&
    sourceBaseDomain(canonicalUrl) === "github.com" &&
    /\/community\//.test(pathFromUrl(canonicalUrl))
  ) {
    return true;
  }

  if (
    periodDays <= 14 &&
    classifySourceTypeByDomain(domain) === "secondary" &&
    /(trends|predictions|state of|future of|what('?s| is) next|landscape|roundup)/.test(title) &&
    !/(code search|deep search|mcp|repository context|cross-repo|migration|remediation|compliance|audit|batch changes)/.test(
      title,
    )
  ) {
    return true;
  }

  return false;
}

function buildSourcegraphPositioningAnchors(text: string): string[] {
  const lower = text.toLowerCase();
  const anchors: string[] = [];
  if (/(mcp|context layer|repo context|agent context)/.test(lower)) {
    anchors.push("Use Sourcegraph Deep Search + Code Search as the context and retrieval layer for coding agents.");
  }
  if (/(migration|remediation|codemod|large-scale|batch)/.test(lower)) {
    anchors.push("Pair agent suggestions with Sourcegraph Batch Changes for controlled cross-repo rollout and rollback.");
  }
  if (/(compliance|security|audit|byok|self-hosted|rbac|policy)/.test(lower)) {
    anchors.push("Frame governance with Sourcegraph controls: repository-aware search context, auditable change sets, and enterprise deployment controls.");
  }
  if (anchors.length === 0) {
    anchors.push(
      `Anchor the narrative to Sourcegraph product pillars: ${SOURCEGRAPH_PRODUCT_SUITE_SIGNALS.join(", ")}.`,
    );
  }
  return anchors.slice(0, 2);
}

function scoreCandidate(doc: AgentRankedDoc, state: PlaybookState, periodDays: number): ScoredIdeaCandidate {
  const text = textOf(doc);
  const domain = sourceFromUrl(doc.url);
  const sourceType = classifySourceTypeByDomain(domain);
  const seedType = classifyContentSeedType(text, domain);
  const segment = detectSegment(text);
  const persona = detectPersona(text);
  const channel = detectChannel(text, state);
  const guardrailViolation = detectGuardrailViolation(text);

  // Content seed value scoring (focus on format + depth + timeliness, not just GTM delta intensity)
  // Prioritize long-form, deep-dive sources (case studies, blogs, reports) over tweets/press
  const seedFormatScore =
    seedType === "case_study" ? 1.0 :
    seedType === "blog_post" ? 0.85 :
    seedType === "webinar" ? 0.9 :
    // Research is useful context, but it should not outrank concrete GTM/source material by default.
    seedType === "research_report" ? 0.72 :
    seedType === "benchmark" ? 0.92 :
    seedType === "newsletter_feature" ? 0.7 :
    0.4;

  // Channel efficiency (long-form, evergreen formats preferred)
  const channel_efficiency_score = ["event_talk", "whitepaper", "SEO_page", "blog"].includes(channel) ? 0.9 : 0.6;
  
  // Evidence & proof (less strict for month windows; we do this downstream)
  const proof_feasibility_score = /(benchmark|customer|case study|release notes|docs|\bga\b)/.test(text) ? 0.9 : 0.5;
  
  // Product/message fit (content seed value, not hard GTM signals)
  const strongProduct = /(code search|cross-repo|batch changes|mcp|context layer|compliance|byok|self-hosted)/.test(text);
  const partialProduct = /(developer (platform|tools|productivity)|coding assistant|ai coding|enterprise (codebase|tooling)|codebase (context|understanding))/i.test(text);
  const message_fit_score = strongProduct ? 1 : partialProduct ? 0.6 : 0.35;
  
  // Timeliness (less aggressive weight for month windows; variety matters more)
  const timeliness_score = doc.publishedAt 
    ? Math.max(0.2, 1 - ((Date.now() - doc.publishedAt.getTime()) / (1000 * 60 * 60 * 24 * 120))) 
    : 0.5;
  
  // Source quality (blogs, newsletters, reports are good seeds)
  const source_quality_score =
    sourceType === "primary"
      ? isConversationStyleSource(doc.url)
        ? 0.45
        : 1
      : sourceType === "secondary"
        ? TRUSTED_SECONDARY_DOMAINS.has(domain) || PREFERRED_SHORT_WINDOW_TECHNICAL_DOMAINS.has(domain)
          ? 0.82
          : isLowAuthorityBusinessPressDomain(domain)
            ? 0.35
            : 0.7
        : sourceType === "internal_curated"
          ? 0.85
          : 0.2;
  
  // Penalties
  const noisy_domain_penalty = isNoisyDomain(domain) ? 0.3 : 0;
  const weak_anchor_penalty = isWeakAnchorSource(doc, periodDays) ? (periodDays <= 14 ? 0.2 : 0.12) : 0;

  // Rebalanced scoring: prioritize content seed value + quality differentiation
  // Increased seedFormat (25%) and sourceQuality (15%) to create real variance between candidates.
  // Reduced messageFit (25%) since most docs hit 0.6 and don't differentiate.
  // Kept channel + evidence + timeliness moderate.
  const contentSeedScore =
    0.25 * seedFormatScore +           // Format quality (case study > blog > newsletter > other) - increased for differentiation
    0.12 * channel_efficiency_score +  // Channel fit
    0.12 * proof_feasibility_score +   // Evidence availability
    0.25 * message_fit_score +         // Message fit - reduced from 0.35 (too many docs hit 0.6)
    0.10 * timeliness_score +          // Recency boost (lighter weight for month)
    0.15 * source_quality_score -      // Source quality - increased from 0.05 (primary > secondary > community)
    noisy_domain_penalty -
    weak_anchor_penalty;

  const score = contentSeedScore;

  return {
    doc,
    seedType,
    score,
    contentSeedScore,
    guardrailViolation,
    segment,
    persona,
    channel,
  };
}

function toIdea(
  candidate: ScoredIdeaCandidate,
  state: PlaybookState,
  targetSegmentOverride?: ContentIdea["target_segment"],
  channelOverride?: ContentIdea["channel"],
): ContentIdea {
  const text = textOf(candidate.doc);
  const evidenceUrl = canonicalizeUrl(candidate.doc.url ?? "");
  const evidenceSource = sourceFromUrl(evidenceUrl);
  const integration = classifySourcegraphIntegrationOpportunity({
    title: candidate.doc.title,
    summary: candidate.doc.snippet ?? "",
    content: candidate.doc.content ?? "",
  });
  const downgradeToMonitor = isTangentialSourceForIdea(evidenceSource, text);
  const date = candidate.doc.publishedAt ? candidate.doc.publishedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  const funnel: ContentIdea["funnel_stage"] =
    /(customer|case study|benchmark)/.test(text)
      ? "business_case"
      : /(pricing|security|compliance)/.test(text)
        ? "validation"
        : /(migration|remediation|onboarding)/.test(text)
          ? "expansion"
          : "awareness";

  const targetSegment = targetSegmentOverride ?? candidate.segment;
  const channel = channelOverride ?? candidate.channel;
  const title = buildSourcegraphIdeaTitle(targetSegment, channel, text, candidate.doc.title, candidate.doc.url);
  const thesis = buildSourcegraphThesis(
    targetSegment,
    candidate.persona,
    text,
    candidate.doc.title,
    candidate.doc.url,
  );
  const keyInsights = buildKeyInsights(
    targetSegment,
    candidate.persona,
    text,
    candidate.doc.title,
    candidate.doc.url,
  );
  const contentOutline = buildContentOutline(
    targetSegment,
    candidate.persona,
    channel,
    text,
    candidate.doc.title,
    candidate.doc.url,
  );
  const distributionPlan = buildDistributionPlan(channel, text);
  const suiteAnchors = buildSourcegraphPositioningAnchors(text);
  const sourcegraphIntegrationPlay =
    integration.sourcegraph_integration_play.length > 0
      ? Array.from(new Set([...integration.sourcegraph_integration_play, ...suiteAnchors])).slice(0, 3)
      : suiteAnchors;

  return {
    title,
    thesis: stripBoilerplateNoise(thesis),
    target_segment: targetSegment,
    target_persona: candidate.persona,
    funnel_stage: funnel,
    channel,
    why_now: buildWhyNow(candidate.doc, text),
    playbook_alignment: state.campaign_themes.slice(0, 2),
    sources: evidenceUrl
      ? [{ title: candidate.doc.title, source: evidenceSource, url: evidenceUrl, date }]
      : [],
    core_claim: buildCoreClaim(text),
    key_insights: keyInsights.map((x) => stripBoilerplateNoise(x)),
    content_outline: contentOutline.map((x) => stripBoilerplateNoise(x)),
    proof_required: ["product evidence", "external trend", "customer story"],
    guardrails: state.messaging_guardrails,
    evidence_quality_note: buildEvidenceQualityNote(candidate.doc, text),
    integration_opportunity: downgradeToMonitor ? "monitor_only" : integration.level,
    sourcegraph_integration_play: sourcegraphIntegrationPlay,
    distribution_plan: distributionPlan,
    priority_score: Number(candidate.score.toFixed(3)),
  };
}

function sourceEntryFromDoc(doc: AgentRankedDoc): ContentIdea["sources"][number] | null {
  const url = canonicalizeUrl(doc.url);
  if (!url) return null;
  const source = sourceFromUrl(url);
  if (isNoisyDomain(source)) return null;
  return {
    title: doc.title,
    source,
    url,
    date: doc.publishedAt ? doc.publishedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  };
}

function isIndexOrRoundupSource(url: string, title: string, snippet?: string): boolean {
  const text = `${title} ${snippet ?? ""}`.toLowerCase();
  if (/(show hn|fastest growing|top \d+|startup list|ranked list|roundup|weekly|newsletter|digest)/i.test(text)) return true;
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    if (
      host.endsWith("substack.com") ||
      host.endsWith("beehiiv.com") ||
      host.endsWith("kit.com")
    ) {
      return true;
    }
    if (
      path === "/blog" ||
      path === "/news" ||
      path === "/updates" ||
      path === "/releases" ||
      path === "/releases/whats-new" ||
      path === "/changelog"
    ) {
      return true;
    }
  } catch {
    return true;
  }
  return false;
}

function hasComplianceControlSignal(text: string): boolean {
  const complianceSignal = /(compliance|regulated|regulatory|security)/.test(text);
  const controlArtifacts = hasHardComplianceControlEvidence(text);
  const codingContext =
    /(code|coding|developer|assistant|agent|repository|repo|pull request|merge|ci\/cd|sdlc)/.test(text);
  return complianceSignal && controlArtifacts && codingContext;
}

function hasHardComplianceControlEvidence(text: string): boolean {
  return /(audit(?:ability| trail| log)?|byok|self-hosted|self hosted|rbac|policy enforcement|policy control|provenance|sox|soc ?2|iso ?27001|fedramp|hipaa|pci|gdpr|data residency|nist)/.test(
    text,
  );
}

function isAuthoritativeResearchOrStandardsDomain(domain: string): boolean {
  const d = domain.toLowerCase().replace(/^www\./, "");
  return (
    d.endsWith(".gov") ||
    d.endsWith(".edu") ||
    d === "arxiv.org" ||
    d === "openreview.net" ||
    d === "acm.org" ||
    d.endsWith(".acm.org") ||
    d === "nist.gov" ||
    d.endsWith(".nist.gov")
  );
}

function isStrongSourceCandidate(doc: AgentRankedDoc, frame: string, periodDays: number): boolean {
  if (!docSupportsFrame(doc, frame)) return false;
  if (isResearchOnlySource(doc, periodDays)) return false;
  if (isWeakAnchorSource(doc, periodDays)) return false;
  const entry = sourceEntryFromDoc(doc);
  if (!entry) return false;
  if (isIndexOrRoundupSource(entry.url, doc.title, doc.snippet)) return false;

  const domain = sourceFromUrl(entry.url);
  const sourceType = classifySourceTypeByDomain(domain);
  const text = textOf(doc);
  if (sourceType === "community") return false;
  if (!hasConcreteEvidence(text)) return false;
  if (frame === "Secure and Compliant AI Coding Workflows" && !hasComplianceControlSignal(text)) {
    return false;
  }
  // Month windows are source-quality sensitive: prioritize primary or authoritative sources.
  if (periodDays > 14) {
    const authoritative = isAuthoritativeResearchOrStandardsDomain(domain);
    if (sourceType === "secondary" && !authoritative) {
      // Allow secondary only when supported by hard, frame-specific proof.
      if (frame === "Secure and Compliant AI Coding Workflows") {
        const hardCompliance =
          hasHardComplianceControlEvidence(text) &&
          /(soc ?2|iso ?27001|fedramp|hipaa|pci|gdpr|nist|audit|rbac|byok)/.test(text);
        if (!hardCompliance) return false;
      } else {
        const hardEvidence = /(benchmark|case study|customer|documentation|docs|ga|launch|release)/.test(text);
        if (!hardEvidence) return false;
      }
    }
  }
  if (
    periodDays <= 14 &&
    sourceType === "secondary" &&
    WEAK_SHORT_WINDOW_SECONDARY_DOMAINS.has(domain)
  ) {
    return false;
  }
  return true;
}

function buildSourceDrivenIdeasFromCandidates(
  candidates: ScoredIdeaCandidate[],
  state: PlaybookState,
  numIdeas: number,
  periodDays: number,
): ContentIdea[] {
  const byFrame = new Map<string, ScoredIdeaCandidate[]>();
  for (const c of candidates) {
    if (c.doc.id === MARKET_BRIEF_CONTEXT_ID) continue;
    const frame = detectTopicFrame(textOf(c.doc));
    if (!isStrongSourceCandidate(c.doc, frame, periodDays)) continue;
    const list = byFrame.get(frame) ?? [];
    list.push(c);
    byFrame.set(frame, list);
  }

  const clusters = Array.from(byFrame.entries())
    .map(([frame, list]) => {
      const ranked = list.sort((a, b) => b.score - a.score);
      const uniqueDomain: Array<{ candidate: ScoredIdeaCandidate; source: ContentIdea["sources"][number] }> = [];
      const seenDomains = new Set<string>();
      const seenUrls = new Set<string>();
      for (const c of ranked) {
        const source = sourceEntryFromDoc(c.doc);
        if (!source) continue;
        const domain = sourceFromUrl(source.url);
        const canonical = canonicalizeUrl(source.url);
        if (!canonical || seenUrls.has(canonical)) continue;
        if (domain && seenDomains.has(domain)) continue;
        seenUrls.add(canonical);
        if (domain) seenDomains.add(domain);
        uniqueDomain.push({ candidate: c, source });
      }
      return { frame, items: uniqueDomain };
    })
    .filter((cluster) => cluster.items.length >= (periodDays > 14 ? 2 : 1))
    .sort((a, b) => b.items[0].candidate.score - a.items[0].candidate.score);

  const ideas: ContentIdea[] = [];
  const usedLeadDomains = new Set<string>();
  for (const cluster of clusters) {
    const leadEntry =
      periodDays <= 14
        ? cluster.items.find((item) => {
            const domain = sourceBaseDomain(item.source.url) || sourceFromUrl(item.source.url);
            return domain ? !usedLeadDomains.has(domain) : true;
          }) ?? cluster.items[0]
        : cluster.items[0];
    const lead = leadEntry.candidate;
    const base = toIdea(lead, state, normalizeTargetSegment(lead.segment));
    const leadDomain = sourceBaseDomain(leadEntry.source.url) || sourceFromUrl(leadEntry.source.url);
    if (leadDomain) usedLeadDomains.add(leadDomain);
    const clusterSources = [leadEntry, ...cluster.items.filter((item) => item !== leadEntry)]
      .slice(0, 3)
      .map((x) => x.source);
    ideas.push({
      ...base,
      sources: clusterSources,
      priority_score: Number(
        (
          cluster.items.slice(0, 2).reduce((sum, x) => sum + x.candidate.score, 0) /
          Math.max(1, Math.min(cluster.items.length, 2))
        ).toFixed(3),
      ),
    });
    if (ideas.length >= numIdeas) break;
  }

  return ideas;
}

function addCorroboratingSources(
  ideas: ContentIdea[],
  candidates: ScoredIdeaCandidate[],
): ContentIdea[] {
  return ideas.map((idea) => {
    const frame = ideaFrameKey(idea);
    const urlSeen = new Set(
      idea.sources
        .map((s) => canonicalizeUrl(s.url))
        .filter((url): url is string => !!url),
    );
    const domainSeen = new Set(
      idea.sources
        .map((s) => sourceBaseDomain(s.url) || sourceFromUrl(s.url))
        .filter((domain): domain is string => !!domain),
    );
    const extra = collectCorroboratingSourcesForFrame(frame, candidates, urlSeen, domainSeen, 3);

    return {
      ...idea,
      sources: [...idea.sources, ...extra],
    };
  });
}

function tryAddCorroboratingSource(
  entry: ContentIdea["sources"][number],
  urlSeen: Set<string>,
  domainSeen: Set<string>,
  extra: ContentIdea["sources"],
): boolean {
  const canonical = canonicalizeUrl(entry.url);
  if (!canonical || urlSeen.has(canonical)) return false;
  const domain = sourceBaseDomain(entry.url) || sourceFromUrl(entry.url);
  if (domain && domainSeen.has(domain)) return false;
  urlSeen.add(canonical);
  if (domain) domainSeen.add(domain);
  extra.push(entry);
  return true;
}

function isAcceptableCorroborationDoc(
  doc: AgentRankedDoc,
  entry: ContentIdea["sources"][number],
): boolean {
  const domain = sourceFromUrl(entry.url);
  const sourceType = classifySourceTypeByDomain(domain);
  const text = textOf(doc);
  if (isConversationStyleSource(entry.url)) return false;
  if (sourceType === "community") return false;
  if (!hasMinimumContentIdeasRelevance(doc)) return false;
  if (!(hasConcreteEvidence(text) || hasBroadSourcegraphNarrativeFit(doc))) return false;
  if (isIndexOrRoundupSource(entry.url, doc.title, doc.snippet)) return false;
  if (isWeakFinalIdeaSource(entry)) return false;
  if (
    sourceType === "secondary" &&
    !isAuthoritativeResearchOrStandardsDomain(domain) &&
    !TRUSTED_SECONDARY_DOMAINS.has(domain)
  ) {
    return false;
  }
  return true;
}

function narrativeKeywordsForFrame(frame: string): string[] {
  switch (frame) {
    case "Repository Context and Retrieval Precision for Coding Agents":
      return ["mcp", "context", "retrieval", "repository", "code search", "deep search"];
    case "Governance, Compliance, and Verification for AI Code Changes":
    case "Governance and Auditability for Enterprise Coding Workflows":
      return ["governance", "compliance", "verification", "audit", "security", "policy"];
    case "Cross-Repo Remediation and Migration":
      return ["cross-repo", "migration", "remediation", "rollout", "batch changes"];
    case "Code Search, Deep Search, and Repository Context":
      return ["code search", "deep search", "repository", "context", "search"];
    case "Developer Onboarding in Large Codebases":
      return ["onboarding", "knowledge transfer", "large codebase", "monorepo", "multi-repo"];
    default:
      return ["code intelligence", "developer platform", "enterprise codebase", "context"];
  }
}

function docMatchesNarrativeKeywords(text: string, keywords: string[]): boolean {
  return keywords.some((keyword) => text.includes(keyword));
}

function enforceMonthlyEvidenceThreshold(ideas: ContentIdea[], periodDays: number): ContentIdea[] {
  if (periodDays <= 14) return ideas;
  const withTwoPlus = ideas.filter((idea) => {
    const unique = new Set(idea.sources.map((s) => canonicalizeUrl(s.url)).filter(Boolean));
    return unique.size >= 2;
  });
  // Keep output broad enough for planning (target at least 3 ideas) while prioritizing 2+ source ideas.
  if (withTwoPlus.length >= 3) return withTwoPlus;
  if (withTwoPlus.length > 0) {
    const seen = new Set(withTwoPlus.map((i) => normalizeIdeaTitleKey(i.title)));
    const supplemented = [...withTwoPlus];
    for (const idea of ideas) {
      const key = normalizeIdeaTitleKey(idea.title);
      if (seen.has(key)) continue;
      supplemented.push(idea);
      seen.add(key);
      if (supplemented.length >= 3) break;
    }
    return supplemented;
  }
  return ideas;
}

function enforceChannelDiversity(
  ideas: ContentIdea[],
  targetCount: number,
): ContentIdea[] {
  const byChannel = new Map<ContentIdea["channel"], ContentIdea[]>();
  for (const idea of ideas) {
    const list = byChannel.get(idea.channel) ?? [];
    list.push(idea);
    byChannel.set(idea.channel, list);
  }
  for (const list of byChannel.values()) {
    list.sort((a, b) => b.priority_score - a.priority_score);
  }

  const selected: ContentIdea[] = [];
  const usedTitle = new Set<string>();
  const channelsByBest = Array.from(byChannel.entries())
    .sort((a, b) => (b[1][0]?.priority_score ?? 0) - (a[1][0]?.priority_score ?? 0))
    .map(([channel]) => channel);

  for (const channel of channelsByBest) {
    const top = byChannel.get(channel)?.[0];
    if (!top) continue;
    const key = normalizeIdeaTitleKey(top.title);
    if (usedTitle.has(key)) continue;
    selected.push(top);
    usedTitle.add(key);
    if (selected.length >= targetCount) return selected;
  }

  const byScore = [...ideas].sort((a, b) => b.priority_score - a.priority_score);
  for (const idea of byScore) {
    const key = normalizeIdeaTitleKey(idea.title);
    if (usedTitle.has(key)) continue;
    selected.push(idea);
    usedTitle.add(key);
    if (selected.length >= targetCount) break;
  }
  return selected;
}

function enforceFrameDiversity(
  ideas: ContentIdea[],
  targetCount: number,
  minDistinctFrames: number,
  allowDuplicateFill = true,
): ContentIdea[] {
  if (ideas.length <= 1) return ideas.slice(0, targetCount);

  const byFrame = new Map<string, ContentIdea[]>();
  for (const idea of ideas) {
    const frame = topicKeyFromIdeaTitle(idea.title);
    const list = byFrame.get(frame) ?? [];
    list.push(idea);
    byFrame.set(frame, list);
  }
  for (const list of byFrame.values()) {
    list.sort((a, b) => b.priority_score - a.priority_score);
  }

  const selected: ContentIdea[] = [];
  const usedTitle = new Set<string>();
  const framesByBest = Array.from(byFrame.entries())
    .sort((a, b) => (b[1][0]?.priority_score ?? 0) - (a[1][0]?.priority_score ?? 0))
    .map(([frame]) => frame);

  // First pass: one per frame to maximize topical spread.
  for (const frame of framesByBest) {
    const top = byFrame.get(frame)?.[0];
    if (!top) continue;
    const key = normalizeIdeaTitleKey(top.title);
    if (usedTitle.has(key)) continue;
    selected.push(top);
    usedTitle.add(key);
    if (selected.length >= targetCount) return selected;
  }

  // If we did not hit the minimum frame count, keep top-scoring remainder (best effort fallback).
  const distinctFrames = new Set(selected.map((i) => topicKeyFromIdeaTitle(i.title))).size;
  if (distinctFrames < minDistinctFrames) {
    if (!allowDuplicateFill) {
      return selected.slice(0, targetCount);
    }
    const byScore = [...ideas].sort((a, b) => b.priority_score - a.priority_score);
    for (const idea of byScore) {
      const key = normalizeIdeaTitleKey(idea.title);
      if (usedTitle.has(key)) continue;
      selected.push(idea);
      usedTitle.add(key);
      if (selected.length >= targetCount) break;
    }
    return selected;
  }

  if (!allowDuplicateFill) {
    return selected.slice(0, targetCount);
  }

  // Second pass: fill remaining slots by score.
  const byScore = [...ideas].sort((a, b) => b.priority_score - a.priority_score);
  for (const idea of byScore) {
    const key = normalizeIdeaTitleKey(idea.title);
    if (usedTitle.has(key)) continue;
    selected.push(idea);
    usedTitle.add(key);
    if (selected.length >= targetCount) break;
  }

  return selected;
}

function backfillMonthIdeasWithFormatDiversity(
  ideas: ContentIdea[],
  candidates: ScoredIdeaCandidate[],
  state: PlaybookState,
  targetCount: number,
): ContentIdea[] {
  const minimum = Math.min(Math.max(3, targetCount), 5);
  if (ideas.length >= minimum) return ideas.slice(0, targetCount);

  const preferredChannels: ContentIdea["channel"][] = [
    "blog",
    "webinar",
    "long_video",
    "whitepaper",
    "case_study",
    "event_talk",
  ];

  const out = [...ideas];
  const usedTitleKeys = new Set(out.map((i) => normalizeIdeaTitleKey(i.title)));
  const usedChannels = new Set(out.map((i) => i.channel));
  const usedFrames = new Set(out.map((i) => ideaFrameKey(i)));
  const minDistinctFrames = Math.min(3, minimum);
  const viableCandidates = candidates.filter((c) => c.doc.id !== MARKET_BRIEF_CONTEXT_ID);

  // First ensure topic/frame diversity for month outputs before channel variants.
  if (usedFrames.size < minDistinctFrames) {
    for (const candidate of viableCandidates) {
      if (usedFrames.size >= minDistinctFrames || out.length >= minimum) break;
      const variant = toIdea(candidate, state, normalizeTargetSegment(candidate.segment));
      const frame = ideaFrameKey(variant);
      if (usedFrames.has(frame)) continue;
      const key = normalizeIdeaTitleKey(variant.title);
      if (usedTitleKeys.has(key)) continue;
      out.push(variant);
      usedTitleKeys.add(key);
      usedChannels.add(variant.channel);
      usedFrames.add(frame);
    }
  }

  for (const channel of preferredChannels) {
    if (out.length >= minimum) break;
    if (usedChannels.has(channel) && out.length >= 2) continue;

    let added = false;
    // Prefer a candidate that also adds a new frame.
    for (const candidate of viableCandidates) {
      const variant = toIdea(
        candidate,
        state,
        normalizeTargetSegment(candidate.segment),
        channel,
      );
      const key = normalizeIdeaTitleKey(variant.title);
      if (usedTitleKeys.has(key)) continue;
      const frame = ideaFrameKey(variant);
      if (usedFrames.has(frame)) continue;
      out.push(variant);
      usedTitleKeys.add(key);
      usedChannels.add(channel);
      usedFrames.add(frame);
      added = true;
      break;
    }
    if (added) continue;

    for (const candidate of viableCandidates) {
      const variant = toIdea(
        candidate,
        state,
        normalizeTargetSegment(candidate.segment),
        channel,
      );
      const key = normalizeIdeaTitleKey(variant.title);
      if (usedTitleKeys.has(key)) continue;
      out.push(variant);
      usedTitleKeys.add(key);
      usedChannels.add(channel);
      usedFrames.add(ideaFrameKey(variant));
      break;
    }
  }

  if (out.length < minimum) {
    for (const candidate of viableCandidates) {
      if (out.length >= minimum) break;
      const variant = toIdea(candidate, state, normalizeTargetSegment(candidate.segment));
      const key = normalizeIdeaTitleKey(variant.title);
      if (usedTitleKeys.has(key)) continue;
      out.push(variant);
      usedTitleKeys.add(key);
      usedFrames.add(ideaFrameKey(variant));
    }
  }

  return out.slice(0, targetCount);
}

function backfillMonthWithSecondaryDistinctThemes(
  ideas: ContentIdea[],
  candidates: ScoredIdeaCandidate[],
  state: PlaybookState,
  targetCount: number,
): ContentIdea[] {
  const minimum = Math.min(Math.max(3, targetCount), 5);
  if (ideas.length >= minimum) return ideas.slice(0, targetCount);

  const out = [...ideas];
  const usedTitleKeys = new Set(out.map((i) => normalizeIdeaTitleKey(i.title)));
  const usedTopicKeys = new Set(out.map((i) => topicKeyFromIdeaTitle(i.title)));
  const usedChannels = new Set(out.map((i) => i.channel));
  const preferredChannels: ContentIdea["channel"][] = [
    "blog",
    "webinar",
    "long_video",
    "whitepaper",
    "case_study",
    "event_talk",
  ];

  const viable = candidates
    .filter((c) => {
      if (c.doc.id === MARKET_BRIEF_CONTEXT_ID) return false;
      const text = textOf(c.doc);
      const domain = sourceFromUrl(c.doc.url);
      const sourceType = classifySourceTypeByDomain(domain);
      const canonicalUrl = canonicalizeUrl(c.doc.url);
      if (sourceType === "community") return false;
      if (!hasMinimumContentIdeasRelevance(c.doc)) return false;
      if (!canonicalUrl) return false;
      if (isNoisyDomain(domain)) return false;
      if (isLowLeverageOperationalSource(c.doc, 30)) return false;
      if (isResearchOnlySource(c.doc, 30)) return false;
      if (isGenericIdeaPage(canonicalUrl) && !hasConcreteEvidence(text)) return false;
      return c.score >= 0.3;
    })
    .sort((a, b) => b.score - a.score);

  const secondaryFirst = [
    ...viable.filter((c) => classifySourceTypeByDomain(sourceFromUrl(c.doc.url)) === "secondary"),
    ...viable.filter((c) => classifySourceTypeByDomain(sourceFromUrl(c.doc.url)) !== "secondary"),
  ];

  for (const candidate of secondaryFirst) {
    if (out.length >= minimum) break;
    const channelOverride =
      candidate.channel && !usedChannels.has(candidate.channel)
        ? candidate.channel
        : preferredChannels.find((ch) => !usedChannels.has(ch));
    const idea = toIdea(
      candidate,
      state,
      normalizeTargetSegment(candidate.segment),
      channelOverride,
    );
    const titleKey = normalizeIdeaTitleKey(idea.title);
    const topicKey = topicKeyFromIdeaTitle(idea.title);
    if (usedTitleKeys.has(titleKey)) continue;
    if (usedTopicKeys.has(topicKey)) continue;
    out.push(idea);
    usedTitleKeys.add(titleKey);
    usedTopicKeys.add(topicKey);
    usedChannels.add(idea.channel);
  }

  // If we still do not meet the minimum, allow format variants from viable sources
  // to preserve report usefulness while keeping source quality gates.
  if (out.length < minimum) {
    for (const candidate of secondaryFirst) {
      if (out.length >= minimum) break;
      const channelOverride =
        candidate.channel && !usedChannels.has(candidate.channel)
          ? candidate.channel
          : preferredChannels.find((ch) => !usedChannels.has(ch));
      const idea = toIdea(
        candidate,
        state,
        normalizeTargetSegment(candidate.segment),
        channelOverride,
      );
      const titleKey = normalizeIdeaTitleKey(idea.title);
      if (usedTitleKeys.has(titleKey)) continue;
      out.push(idea);
      usedTitleKeys.add(titleKey);
      usedChannels.add(idea.channel);
    }
  }

  return out.slice(0, targetCount);
}

function backfillShortWindowDistinctThemes(
  ideas: ContentIdea[],
  candidates: ScoredIdeaCandidate[],
  state: PlaybookState,
  targetCount: number,
): ContentIdea[] {
  const minimum = Math.min(Math.max(3, targetCount), 6);
  if (ideas.length >= minimum) return ideas.slice(0, targetCount);

  const out = [...ideas];
  const usedTitleKeys = new Set(out.map((i) => normalizeIdeaTitleKey(i.title)));
  const usedTopicKeys = new Set(out.map((i) => topicKeyFromIdeaTitle(i.title)));
  const usedBaseDomains = new Set(out.flatMap((i) => i.sources.map((s) => sourceBaseDomain(s.url))));
  let githubFamilyCount = out.filter((i) => i.sources.some((s) => isGitHubFamilySource(s.url))).length;

  const viable = candidates
    .filter((c) => {
      if (c.doc.id === MARKET_BRIEF_CONTEXT_ID) return false;
      if (!hasMinimumContentIdeasRelevance(c.doc)) return false;
      const canonical = canonicalizeUrl(c.doc.url);
      if (!canonical) return false;
      const sourceType = classifySourceTypeByDomain(sourceFromUrl(c.doc.url));
      const text = textOf(c.doc);
      if (sourceType === "community") return false;
      if (!hasConcreteEvidence(text)) return false;
      if (isNoisyDomain(sourceFromUrl(c.doc.url))) return false;
      return c.score >= 0.32;
    })
    .sort((a, b) => b.score - a.score);

  // Pass 1: strongly prefer new domain + new topic; keep at most one GitHub-family idea.
  for (const candidate of viable) {
    if (out.length >= minimum) break;
    const idea = toIdea(candidate, state, normalizeTargetSegment(candidate.segment));
    const titleKey = normalizeIdeaTitleKey(idea.title);
    const topicKey = topicKeyFromIdeaTitle(idea.title);
    const baseDomains = new Set(idea.sources.map((s) => sourceBaseDomain(s.url)));
    const hasNewDomain = Array.from(baseDomains).some((d) => !usedBaseDomains.has(d));
    const isGithub = idea.sources.some((s) => isGitHubFamilySource(s.url));
    if (isGithub && githubFamilyCount >= 1) continue;
    if (!hasNewDomain) continue;
    if (usedTitleKeys.has(titleKey) || usedTopicKeys.has(topicKey)) continue;
    out.push(idea);
    usedTitleKeys.add(titleKey);
    usedTopicKeys.add(topicKey);
    for (const d of baseDomains) usedBaseDomains.add(d);
    if (isGithub) githubFamilyCount++;
  }

  // Pass 2: allow existing domains, still avoid duplicate topic and extra GitHub-family ideas.
  for (const candidate of viable) {
    if (out.length >= minimum) break;
    const idea = toIdea(candidate, state, normalizeTargetSegment(candidate.segment));
    const titleKey = normalizeIdeaTitleKey(idea.title);
    const topicKey = topicKeyFromIdeaTitle(idea.title);
    const isGithub = idea.sources.some((s) => isGitHubFamilySource(s.url));
    if (isGithub && githubFamilyCount >= 1) continue;
    if (usedTitleKeys.has(titleKey) || usedTopicKeys.has(topicKey)) continue;
    out.push(idea);
    usedTitleKeys.add(titleKey);
    usedTopicKeys.add(topicKey);
    for (const d of idea.sources.map((s) => sourceBaseDomain(s.url))) usedBaseDomains.add(d);
    if (isGithub) githubFamilyCount++;
  }

  return out.slice(0, targetCount);
}

function buildSelectionPool(
  candidates: ScoredIdeaCandidate[],
  poolSize: number,
  periodDays: number,
): ScoredIdeaCandidate[] {
  if (periodDays > 14) {
    return candidates.slice(0, poolSize);
  }

  const selected: ScoredIdeaCandidate[] = [];
  const domainCounts = new Map<string, number>();
  const maxPerDomain = 2;

  for (const candidate of candidates) {
    if (selected.length >= poolSize) break;
    const domain = sourceBaseDomain(candidate.doc.url) || sourceFromUrl(candidate.doc.url) || "unknown";
    const count = domainCounts.get(domain) ?? 0;
    if (count >= maxPerDomain) continue;
    selected.push(candidate);
    domainCounts.set(domain, count + 1);
  }

  if (selected.length < poolSize) {
    const usedUrls = new Set(selected.map((candidate) => canonicalizeUrl(candidate.doc.url)).filter(Boolean));
    for (const candidate of candidates) {
      if (selected.length >= poolSize) break;
      const canonical = canonicalizeUrl(candidate.doc.url);
      if (!canonical || usedUrls.has(canonical)) continue;
      selected.push(candidate);
      usedUrls.add(canonical);
    }
  }

  return selected;
}

function applyShortWindowDomainConcentrationPenalty(
  candidates: ScoredIdeaCandidate[],
  periodDays: number,
): ScoredIdeaCandidate[] {
  if (periodDays > 14) return candidates;

  const topWindow = candidates.slice(0, 20);
  const totalCounts = new Map<string, number>();
  for (const candidate of topWindow) {
    const domain = sourceBaseDomain(candidate.doc.url) || sourceFromUrl(candidate.doc.url) || "unknown";
    totalCounts.set(domain, (totalCounts.get(domain) ?? 0) + 1);
  }

  const seenCounts = new Map<string, number>();
  return candidates.map((candidate) => {
    const domain = sourceBaseDomain(candidate.doc.url) || sourceFromUrl(candidate.doc.url) || "unknown";
    const priorSeen = seenCounts.get(domain) ?? 0;
    seenCounts.set(domain, priorSeen + 1);

    const totalInTopWindow = totalCounts.get(domain) ?? 1;
    const repetitionPenalty = priorSeen * 0.07;
    const concentrationPenalty = Math.max(0, totalInTopWindow - 2) * 0.03;
    const sourceType = classifySourceTypeByDomain(sourceFromUrl(candidate.doc.url));
    const qualityAdjustment =
      sourceType === "secondary" && WEAK_SHORT_WINDOW_SECONDARY_DOMAINS.has(domain)
        ? -0.14
        : PREFERRED_SHORT_WINDOW_TECHNICAL_DOMAINS.has(domain)
          ? 0.05
          : 0;

    return {
      ...candidate,
      score: candidate.score - repetitionPenalty - concentrationPenalty + qualityAdjustment,
    };
  });
}

function enforceThesisAndDifferentiatorDiversity(
  ideas: ContentIdea[],
  targetCount: number,
): ContentIdea[] {
  const selected: ContentIdea[] = [];
  const thesisKeys = new Set<string>();
  const differentiatorUsed = new Set<string>();
  const sorted = [...ideas].sort((a, b) => b.priority_score - a.priority_score);

  for (const idea of sorted) {
    if (selected.length >= targetCount) break;
    const frame = ideaFrameKey(idea);
    const tKey = `${frame}|${thesisSimilarityKey(idea.thesis)}`;
    if (thesisKeys.has(tKey)) continue;

    const differentiator =
      idea.sourcegraph_integration_play.find((p) =>
        /(batch changes|rollback|ownership|code graph|impact analysis|verification|audit)/i.test(p),
      ) ?? idea.core_claim;
    const dKey = `${frame}|${differentiator
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80)}`;
    if (differentiatorUsed.has(dKey)) continue;

    selected.push(idea);
    thesisKeys.add(tKey);
    differentiatorUsed.add(dKey);
  }

  if (selected.length < Math.min(targetCount, ideas.length)) {
    for (const idea of sorted) {
      if (selected.length >= targetCount) break;
      if (selected.some((s) => normalizeIdeaTitleKey(s.title) === normalizeIdeaTitleKey(idea.title))) continue;
      selected.push(idea);
    }
  }
  return selected.slice(0, targetCount);
}

function narrativeClusterKey(idea: ContentIdea): string {
  const text = `${idea.title} ${idea.thesis} ${idea.core_claim}`.toLowerCase();
  if (/(codemod|batch changes|migration|remediation|rollout|upgrade)/.test(text)) {
    return "cross_repo_change_workflows";
  }
  if (/(governance|governed|compliance|policy|audit|byok|self-hosted|self hosted)/.test(text)) {
    return "governance_controls";
  }
  if (/(dora|mttr|lead time|change failure|metrics|engineering effectiveness)/.test(text)) {
    return "engineering_metrics";
  }
  if (/(onboarding|mentorship|new engineer|knowledge transfer)/.test(text)) {
    return "onboarding_mentorship";
  }
  if (/(regression|test-driven|impact analysis|code graph|verification)/.test(text)) {
    return "reliability_verification";
  }
  if (/(search|retrieval|deep search|code navigation|context layer|mcp)/.test(text)) {
    return "retrieval_and_context";
  }
  return "other";
}

function enforceNarrativeClusterCap(
  ideas: ContentIdea[],
  targetCount: number,
  periodDays: number,
): ContentIdea[] {
  const sorted = [...ideas].sort((a, b) => b.priority_score - a.priority_score);
  const clusterCounts = new Map<string, number>();
  const selected: ContentIdea[] = [];
  for (const idea of sorted) {
    if (selected.length >= targetCount) break;
    const cluster = narrativeClusterKey(idea);
    const cap =
      periodDays <= 14
        ? 1
        : cluster === "governance_controls"
          ? 1
          : 2;
    const current = clusterCounts.get(cluster) ?? 0;
    if (current >= cap) continue;
    selected.push(idea);
    clusterCounts.set(cluster, current + 1);
  }
  if (periodDays <= 14) {
    return selected.slice(0, targetCount);
  }
  if (selected.length < Math.min(targetCount, ideas.length)) {
    for (const idea of sorted) {
      if (selected.length >= targetCount) break;
      if (selected.some((s) => normalizeIdeaTitleKey(s.title) === normalizeIdeaTitleKey(idea.title))) continue;
      selected.push(idea);
    }
  }
  return selected.slice(0, targetCount);
}

function primarySourceDomain(idea: ContentIdea): string {
  return sourceBaseDomain(idea.sources[0]?.url) || sourceFromUrl(idea.sources[0]?.url) || "unknown";
}

function ideaSourceDomainSet(idea: ContentIdea): Set<string> {
  return new Set(
    idea.sources
      .map((source) => sourceBaseDomain(source.url) || sourceFromUrl(source.url))
      .filter(Boolean),
  );
}

function sourceDomainOverlapCount(a: ContentIdea, b: ContentIdea): number {
  const aDomains = ideaSourceDomainSet(a);
  const bDomains = ideaSourceDomainSet(b);
  let overlap = 0;
  for (const domain of aDomains) {
    if (bDomains.has(domain)) overlap++;
  }
  return overlap;
}

function enforcePrimarySourceDiversity(
  ideas: ContentIdea[],
  targetCount: number,
): ContentIdea[] {
  const sorted = [...ideas].sort((a, b) => b.priority_score - a.priority_score);
  const selected: ContentIdea[] = [];
  const primaryDomainCounts = new Map<string, number>();

  for (const idea of sorted) {
    if (selected.length >= targetCount) break;
    const domain = primarySourceDomain(idea);
    if ((primaryDomainCounts.get(domain) ?? 0) >= 1) continue;
    if (selected.some((picked) => sourceDomainOverlapCount(picked, idea) >= 2)) continue;
    selected.push(idea);
    primaryDomainCounts.set(domain, (primaryDomainCounts.get(domain) ?? 0) + 1);
  }

  if (selected.length < Math.min(targetCount, ideas.length)) {
    for (const idea of sorted) {
      if (selected.length >= targetCount) break;
      if (selected.some((picked) => normalizeIdeaTitleKey(picked.title) === normalizeIdeaTitleKey(idea.title))) continue;
      selected.push(idea);
    }
  }

  return selected.slice(0, targetCount);
}

function diversifyShortWindowPrimaryHooks(
  ideas: ContentIdea[],
  candidates: ScoredIdeaCandidate[],
  state: PlaybookState,
  targetCount: number,
): ContentIdea[] {
  const usedDomains = new Set<string>();
  const usedTitles = new Set<string>();
  const out: ContentIdea[] = [];

  const sortedIdeas = [...ideas].sort((a, b) => b.priority_score - a.priority_score);
  const viableCandidates = [...candidates].sort((a, b) => b.score - a.score);

  for (const idea of sortedIdeas) {
    const currentDomain = primarySourceDomain(idea);
    const currentTitleKey = normalizeIdeaTitleKey(idea.title);
    if (!usedDomains.has(currentDomain) && !usedTitles.has(currentTitleKey)) {
      out.push(idea);
      usedDomains.add(currentDomain);
      usedTitles.add(currentTitleKey);
      continue;
    }

    const ideaFrame = ideaFrameKey(idea);
    let replacement: ContentIdea | null = null;
    for (const candidate of viableCandidates) {
      if (candidate.doc.id === MARKET_BRIEF_CONTEXT_ID) continue;
      const domain = sourceBaseDomain(candidate.doc.url) || sourceFromUrl(candidate.doc.url);
      if (!domain || usedDomains.has(domain)) continue;
      const frame = detectTopicFrame(textOf(candidate.doc));
      if (frame !== ideaFrame) continue;
      const altIdea = toIdea(candidate, state, normalizeTargetSegment(candidate.segment));
      const altTitleKey = normalizeIdeaTitleKey(altIdea.title);
      if (usedTitles.has(altTitleKey)) continue;
      replacement = altIdea;
      break;
    }

    if (!replacement) {
      for (const candidate of viableCandidates) {
        if (candidate.doc.id === MARKET_BRIEF_CONTEXT_ID) continue;
        const domain = sourceBaseDomain(candidate.doc.url) || sourceFromUrl(candidate.doc.url);
        if (!domain || usedDomains.has(domain)) continue;
        const altIdea = toIdea(candidate, state, normalizeTargetSegment(candidate.segment));
        const altTitleKey = normalizeIdeaTitleKey(altIdea.title);
        if (usedTitles.has(altTitleKey)) continue;
        replacement = altIdea;
        break;
      }
    }

    const picked = replacement ?? idea;
    out.push(picked);
    usedDomains.add(primarySourceDomain(picked));
    usedTitles.add(normalizeIdeaTitleKey(picked.title));
  }

  return out.slice(0, targetCount);
}

function rebalanceCorroboratingSourcesAcrossIdeas(
  ideas: ContentIdea[],
  candidates: ScoredIdeaCandidate[],
): ContentIdea[] {
  const globalDomainCounts = new Map<string, number>();
  const sorted = [...ideas].sort((a, b) => b.priority_score - a.priority_score);

  const rebalanced = sorted.map((idea) => {
    const primary = idea.sources[0] ? [idea.sources[0]] : [];
    const primaryDomains = primary
      .map((source) => sourceBaseDomain(source.url) || sourceFromUrl(source.url))
      .filter((domain): domain is string => !!domain);
    for (const domain of primaryDomains) {
      globalDomainCounts.set(domain, (globalDomainCounts.get(domain) ?? 0) + 1);
    }

    const urlSeen = new Set(
      primary
        .map((source) => canonicalizeUrl(source.url))
        .filter((url): url is string => !!url),
    );
    const domainSeen = new Set(primaryDomains);

    const retainedExtra: ContentIdea["sources"] = [];
    for (const source of idea.sources.slice(1)) {
      const canonical = canonicalizeUrl(source.url);
      const domain = sourceBaseDomain(source.url) || sourceFromUrl(source.url);
      if (!canonical || !domain) continue;
      if (urlSeen.has(canonical) || domainSeen.has(domain)) continue;
      if ((globalDomainCounts.get(domain) ?? 0) >= 1) continue;
      urlSeen.add(canonical);
      domainSeen.add(domain);
      globalDomainCounts.set(domain, (globalDomainCounts.get(domain) ?? 0) + 1);
      retainedExtra.push(source);
      if (retainedExtra.length >= 2) break;
    }

    if (retainedExtra.length < 2) {
      const refill = collectCorroboratingSourcesForFrame(
        ideaFrameKey(idea),
        candidates,
        urlSeen,
        domainSeen,
        2 - retainedExtra.length,
        globalDomainCounts,
      );
      for (const source of refill) {
        const domain = sourceBaseDomain(source.url) || sourceFromUrl(source.url);
        if (!domain) continue;
        globalDomainCounts.set(domain, (globalDomainCounts.get(domain) ?? 0) + 1);
      }
      retainedExtra.push(...refill);
    }

    return {
      ...idea,
      sources: [...primary, ...retainedExtra],
    };
  });

  return ideas.map(
    (idea) =>
      rebalanced.find((candidate) => normalizeIdeaTitleKey(candidate.title) === normalizeIdeaTitleKey(idea.title)) ??
      idea,
  );
}

function extractIdeaTitlePrefix(title: string): string {
  const match = title.match(/^([^:]+):\s*/);
  return match?.[1]?.trim() || "Guide";
}

function buildBroadThemeTitle(prefix: string, idea: ContentIdea): string {
  const topic = polishIdeaTopic(
    detectTopicFrame(
      `${idea.title} ${idea.thesis} ${idea.core_claim} ${idea.sources.map((s) => s.title).join(" ")}`
        .toLowerCase(),
    ),
  );
  return `${prefix}: ${topic}`.slice(0, 120);
}

function maybeRewriteLiteralIdeaTitle(idea: ContentIdea): string {
  const currentTitle = stripBoilerplateNoise(idea.title);
  const sourceTitles = idea.sources.map((s) => s.title).filter(Boolean);
  const maxOverlap = sourceTitles.reduce(
    (max, sourceTitle) => Math.max(max, titleOverlapRatio(currentTitle, sourceTitle)),
    0,
  );
  const longMirroredHeadline = sourceTitles.some((sourceTitle) => {
    const overlap = titleOverlapRatio(currentTitle, sourceTitle);
    return (
      overlap >= 0.6 &&
      (sourceTitle.length >= 70 ||
        sourceTitle.includes(",") ||
        /software privacy and governance trends|how ai is changing|landscape|future research directions/i.test(
          sourceTitle,
        ))
    );
  });
  const weakOrLiteralTitle =
    maxOverlap >= 0.75 ||
    longMirroredHeadline ||
    /\[ai ?news\]|release notes|changelog|talks to help you navigate the schedule|runs large models|growing pains|shifts to coding|pulls ahead|software privacy and governance trends|how ai is changing analytics experiences/i.test(
      currentTitle,
    );
  if (!weakOrLiteralTitle) return currentTitle;
  return buildBroadThemeTitle(extractIdeaTitlePrefix(currentTitle), idea);
}

function isWeakFinalIdeaSource(source: ContentIdea["sources"][number]): boolean {
  const canonicalUrl = canonicalizeUrl(source.url);
  const title = source.title ?? "";
  const domain = sourceFromUrl(canonicalUrl);
  if (!canonicalUrl) return true;
  if (isGenericIdeaPage(canonicalUrl)) return true;
  if (isConversationStyleSource(canonicalUrl)) return true;
  if (isNoisyDomain(sourceFromUrl(canonicalUrl))) return true;
  if (isLowAuthorityBusinessPressDomain(domain)) return true;
  if (isIndexOrRoundupSource(canonicalUrl, title)) return true;
  if (
    /(release notes|changelog|talks to help you navigate the schedule|\[ai ?news\]|weekly digest|roundup|march 20\d{2} update|platform update)/i.test(
      title,
    )
  ) {
    return true;
  }
  return false;
}

function scoreCorroborationCandidate(
  candidate: ScoredIdeaCandidate,
  globalDomainCounts?: Map<string, number>,
): number {
  const domain = sourceFromUrl(candidate.doc.url);
  const sourceType = classifySourceTypeByDomain(domain);
  const typeBoost = sourceType === "primary" ? 0.15 : sourceType === "secondary" ? 0.08 : 0;
  const globalBoost = globalDomainCounts ? Math.max(0, 0.12 - 0.06 * (globalDomainCounts.get(domain) ?? 0)) : 0;
  return candidate.score + typeBoost + globalBoost;
}

function collectCorroboratingSourcesForFrame(
  frame: string,
  candidates: ScoredIdeaCandidate[],
  urlSeen: Set<string>,
  domainSeen: Set<string>,
  desiredExtra: number,
  globalDomainCounts?: Map<string, number>,
): ContentIdea["sources"] {
  const extra: ContentIdea["sources"] = [];
  const keywords = narrativeKeywordsForFrame(frame);

  const rankedFrameCandidates = candidates
    .filter((candidate) => {
      const entry = sourceEntryFromDoc(candidate.doc);
      if (!entry || !isAcceptableCorroborationDoc(candidate.doc, entry)) return false;
      return docSupportsFrame(candidate.doc, frame);
    })
    .sort((a, b) => scoreCorroborationCandidate(b, globalDomainCounts) - scoreCorroborationCandidate(a, globalDomainCounts));

  for (const candidate of rankedFrameCandidates) {
    const entry = sourceEntryFromDoc(candidate.doc);
    if (!entry) continue;
    if (!tryAddCorroboratingSource(entry, urlSeen, domainSeen, extra)) continue;
    if (extra.length >= desiredExtra) return extra;
  }

  const rankedFallbackCandidates = candidates
    .filter((candidate) => {
      const entry = sourceEntryFromDoc(candidate.doc);
      if (!entry || !isAcceptableCorroborationDoc(candidate.doc, entry)) return false;
      const text = textOf(candidate.doc);
      return docMatchesNarrativeKeywords(text, keywords);
    })
    .sort((a, b) => scoreCorroborationCandidate(b, globalDomainCounts) - scoreCorroborationCandidate(a, globalDomainCounts));

  for (const candidate of rankedFallbackCandidates) {
    const entry = sourceEntryFromDoc(candidate.doc);
    if (!entry) continue;
    if (!tryAddCorroboratingSource(entry, urlSeen, domainSeen, extra)) continue;
    if (extra.length >= desiredExtra) break;
  }

  return extra;
}

type LlmContentIdeaDraft = {
  title?: unknown;
  thesis?: unknown;
  target_segment?: unknown;
  target_persona?: unknown;
  funnel_stage?: unknown;
  channel?: unknown;
  why_now?: unknown;
  core_claim?: unknown;
  key_insights?: unknown;
  content_outline?: unknown;
  source_urls?: unknown;
  sourcegraph_angle?: unknown;
  recommended_venue?: unknown;
  channel_strategy?: unknown;
  setup_steps?: unknown;
};

function normalizePersona(raw: unknown): ContentIdea["target_persona"] {
  const value = String(raw ?? "").toLowerCase().trim();
  if (value.includes("security")) return "Security/Compliance";
  if (value.includes("platform")) return "Head of Developer Platform";
  if (value.includes("vp") || value.includes("executive")) return "VP Engineering";
  return "Staff Engineer";
}

function normalizeFunnelStage(raw: unknown): ContentIdea["funnel_stage"] {
  const value = String(raw ?? "").toLowerCase().trim();
  if (value.includes("business")) return "business_case";
  if (value.includes("valid")) return "validation";
  if (value.includes("expand")) return "expansion";
  return "awareness";
}

function normalizeChannel(raw: unknown): ContentIdea["channel"] {
  const value = String(raw ?? "").toLowerCase().trim();
  if (value.includes("webinar")) return "webinar";
  if (value.includes("talk") || value.includes("conference")) return "event_talk";
  if (value.includes("video") && value.includes("short")) return "short_video";
  if (value.includes("video")) return "long_video";
  if (value.includes("case")) return "case_study";
  if (value.includes("one-pager") || value.includes("one pager")) return "sales_one_pager";
  if (value.includes("email")) return "email_sequence";
  if (value.includes("seo")) return "SEO_page";
  if (value.includes("ad")) return "ad_campaign";
  if (value.includes("whitepaper") || value.includes("white paper") || value.includes("guide")) return "whitepaper";
  return "blog";
}

function isTimedOutError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return isAgentLlmTimeoutError(error) || /timed out/i.test(message);
}

function getContentIdeasLlmModel(): string | undefined {
  const override = process.env.CONTENT_IDEAS_LLM_MODEL?.trim();
  if (override) return override;
  return undefined;
}

async function maybeWriteContentIdeasParseDebugArtifact(rawContent: string): Promise<void> {
  if (process.env.CONTENT_IDEAS_DEBUG_PARSE_FAILURE !== "1") return;
  try {
    const fs = await import("node:fs/promises");
    const dir = path.resolve(process.cwd(), ".data/debug");
    await fs.mkdir(dir, { recursive: true });
    const file = path.join(dir, `content-ideas-parse-failure-${Date.now()}.txt`);
    await fs.writeFile(file, rawContent, "utf8");
    logger.warn("Wrote content ideas parse failure artifact", { file });
  } catch (error) {
    logger.warn("Failed to write content ideas parse failure artifact", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

async function synthesizeStructuredContentIdeasWithLLM(args: {
  candidates: ScoredIdeaCandidate[];
  sourcegraphContextDocs: RetrievedDoc[];
  state: PlaybookState;
  numIdeas: number;
  periodDays: number;
}): Promise<{ ideas: ContentIdea[] | null; timedOut: boolean; debug?: NonNullable<ContentIdeasOutput["llm_debug"]>["structured_synthesis"] }> {
  if (!hasLLMConfigured()) {
    return {
      ideas: null,
      timedOut: false,
      debug: { status: "not_configured" },
    };
  }
  const llmModel = getContentIdeasLlmModel();
  const requestedIdeaCount = Math.min(args.numIdeas, args.periodDays <= 14 ? 3 : 5);
  const maxTokens = llmModel && isClaudeModel(llmModel) ? 3200 : 1800;
  const marketSignals = args.candidates
    .filter((c) => c.doc.id !== MARKET_BRIEF_CONTEXT_ID)
    .slice(0, 4)
    .map((c, index) => ({
      n: index + 1,
      title: c.doc.title,
      url: canonicalizeUrl(c.doc.url),
      source: sourceFromUrl(c.doc.url),
      published_at: c.doc.publishedAt?.toISOString().slice(0, 10) ?? null,
      summary: stripBoilerplateNoise(c.doc.snippet ?? "").slice(0, 180),
      content_seed_score: Number(c.score.toFixed(3)),
    }))
    .filter((doc) => !!doc.url);
  if (marketSignals.length === 0) return { ideas: null, timedOut: false };

  const sourcegraphContext = args.sourcegraphContextDocs.slice(0, 2).map((doc, index) => ({
    n: index + 1,
    title: doc.title,
    url: canonicalizeUrl(doc.url),
    source: sourceFromUrl(doc.url),
    summary: stripBoilerplateNoise(doc.snippet ?? "").slice(0, 140),
  }));

  const prompt = JSON.stringify(
    {
      period_days: args.periodDays,
      num_ideas: requestedIdeaCount,
      playbook: {
        primary_beachhead: args.state.primary_beachhead,
        adjacent_segments: args.state.adjacent_segments,
        persona_priority: args.state.persona_priority,
        campaign_themes: args.state.campaign_themes,
        proof_points: args.state.proof_points ?? [],
        messaging_guardrails: args.state.messaging_guardrails,
      },
      market_signals: marketSignals,
      sourcegraph_context: sourcegraphContext,
      allowed_values: {
        target_segment: ["Capital Markets", "Banks", "Diversified Financial Services", "Insurance", "Other"],
        target_persona: ["Head of Developer Platform", "VP Engineering", "Staff Engineer", "Security/Compliance"],
        funnel_stage: ["awareness", "validation", "business_case", "expansion"],
        channel: [
          "whitepaper",
          "webinar",
          "event_talk",
          "blog",
          "SEO_page",
          "case_study",
          "email_sequence",
          "sales_one_pager",
          "long_video",
          "short_video",
          "ad_campaign",
        ],
      },
    },
    null,
    2,
  );

  const system = `You are a GTM content strategist for Sourcegraph.

Generate content ideas that arise naturally from the market signals and Sourcegraph context provided.

Rules:
- Use the market_signals as the primary evidence for why an idea exists now.
- Use sourcegraph_context only to ground the angle in current Sourcegraph messaging/product pages. Do not force every idea into the same Sourcegraph narrative.
- Avoid cloning the same theme across multiple formats. If two ideas are basically the same narrative, keep the stronger one.
- Prefer 3 distinct, high-signal ideas over 5 repetitive ideas.
- Do not force governance/compliance unless the evidence clearly points there.
- Use specific, natural titles. Do not mirror source headlines verbatim and do not use generic templates repeatedly.
- Choose the channel that best fits the signal; do not default to whitepaper or talk unless justified.
- Every idea must cite 1-3 source_urls taken exactly from market_signals.
- Return JSON only with shape {"ideas":[...]}.
- Each idea object must include:
  title, thesis, target_segment, target_persona, funnel_stage, channel, why_now, core_claim,
  key_insights, content_outline, source_urls, sourcegraph_angle, recommended_venue, channel_strategy, setup_steps.`;

  try {
    const res = await withAgentLlmTimeout(
      "content ideas structured synthesis",
      createChatCompletion({
        messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
        model: llmModel,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
      }),
    );
    const rawContent = res.content ?? "";
    const rawIdeas = extractIdeasArrayFromLlm(rawContent);
    if (rawIdeas.length === 0) {
      await maybeWriteContentIdeasParseDebugArtifact(rawContent);
      logger.warn("Structured content ideas synthesis returned no parseable ideas, using heuristic fallback", {
        preview: rawContent.slice(0, 400),
      });
      return {
        ideas: null,
        timedOut: false,
        debug: {
          status: "parse_fallback",
          provider: res.provider,
          model: res.model,
        },
      };
    }

    const sourceMap = new Map<string, AgentRankedDoc>();
    for (const candidate of args.candidates) {
      const canonical = canonicalizeUrl(candidate.doc.url);
      if (canonical) sourceMap.set(canonical, candidate.doc);
    }

    const output: ContentIdea[] = [];
    for (const raw of rawIdeas.slice(0, Math.min(args.numIdeas, 5))) {
      const title = stripBoilerplateNoise(String(raw.title ?? "").trim());
      const thesis = stripBoilerplateNoise(String(raw.thesis ?? "").trim());
      if (!title || !thesis) continue;

      const explicitSourceUrls = Array.isArray(raw.source_urls)
        ? raw.source_urls
        : typeof raw.source_urls === "string"
          ? [raw.source_urls]
          : [];
      const fallbackSourceUrls = Array.from(
        JSON.stringify(raw).matchAll(/https?:\/\/[^\s"']+/g),
        (match) => match[0],
      );
      const sourceUrls = (explicitSourceUrls.length > 0 ? explicitSourceUrls : fallbackSourceUrls)
        .map((url) => canonicalizeUrl(String(url)))
        .filter(Boolean);
      const sources = sourceUrls
        .map((url) => {
          const doc = sourceMap.get(url);
          return doc
            ? {
                title: doc.title,
                source: sourceFromUrl(url),
                url,
                date: doc.publishedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10),
              }
            : null;
        })
        .filter((value): value is ContentIdea["sources"][number] => value !== null)
        .slice(0, 3);
      if (sources.length === 0) {
        const fallbackDoc = args.candidates[0]?.doc;
        const fallbackUrl = canonicalizeUrl(fallbackDoc?.url);
        if (!fallbackDoc || !fallbackUrl) continue;
        sources.push({
          title: fallbackDoc.title,
          source: sourceFromUrl(fallbackUrl),
          url: fallbackUrl,
          date: fallbackDoc.publishedAt?.toISOString().slice(0, 10) ?? new Date().toISOString().slice(0, 10),
        });
      }

      const joinedText = `${title} ${thesis} ${String(raw.core_claim ?? "")} ${sources.map((s) => s.title).join(" ")}`.toLowerCase();
      const primaryDoc = sourceMap.get(sources[0].url);
      const integration = classifySourcegraphIntegrationOpportunity({
        title,
        summary: thesis,
        content: `${String(raw.core_claim ?? "")} ${Array.isArray(raw.content_outline) ? raw.content_outline.join(" ") : ""}`,
      });
      const distributionPlan = buildDistributionPlan(normalizeChannel(raw.channel), joinedText);
      output.push({
        title,
        thesis,
        target_segment: normalizeTargetSegment(String(raw.target_segment ?? "")),
        target_persona: normalizePersona(raw.target_persona),
        funnel_stage: normalizeFunnelStage(raw.funnel_stage),
        channel: normalizeChannel(raw.channel),
        why_now: stripBoilerplateNoise(String(raw.why_now ?? "").trim()) || buildWhyNow(primaryDoc ?? { ...args.candidates[0].doc }, joinedText),
        playbook_alignment: args.state.campaign_themes.slice(0, 2),
        sources,
        core_claim: stripBoilerplateNoise(String(raw.core_claim ?? "").trim()) || buildCoreClaim(joinedText),
        key_insights: (Array.isArray(raw.key_insights) ? raw.key_insights : [])
          .map((value) => stripBoilerplateNoise(String(value)))
          .filter(Boolean)
          .slice(0, 4),
        content_outline: (Array.isArray(raw.content_outline) ? raw.content_outline : [])
          .map((value) => stripBoilerplateNoise(String(value)))
          .filter(Boolean)
          .slice(0, 5),
        proof_required: ["product evidence", "external trend", "customer story"],
        guardrails: args.state.messaging_guardrails,
        evidence_quality_note: primaryDoc ? buildEvidenceQualityNote(primaryDoc, textOf(primaryDoc)) : undefined,
        integration_opportunity: integration.level,
        sourcegraph_integration_play: (
          Array.isArray(raw.sourcegraph_angle)
            ? raw.sourcegraph_angle
            : typeof raw.sourcegraph_angle === "string"
              ? [raw.sourcegraph_angle]
              : []
        )
          .map((value) => stripBoilerplateNoise(String(value)))
          .filter(Boolean)
          .slice(0, 3),
        distribution_plan: {
          primary_format: distributionPlan.primary_format,
          recommended_venue:
            stripBoilerplateNoise(String(raw.recommended_venue ?? "").trim()) || distributionPlan.recommended_venue,
          channel_strategy:
            stripBoilerplateNoise(String(raw.channel_strategy ?? "").trim()) || distributionPlan.channel_strategy,
          setup_steps: (
            Array.isArray(raw.setup_steps)
              ? raw.setup_steps
              : typeof raw.setup_steps === "string"
                ? [raw.setup_steps]
                : distributionPlan.setup_steps
          )
            .map((value) => stripBoilerplateNoise(String(value)))
            .filter(Boolean)
            .slice(0, 4),
        },
        priority_score: Number(
          (
            sources
              .map((source) => sourceMap.get(source.url))
              .filter((doc): doc is AgentRankedDoc => !!doc)
              .reduce((sum, doc) => sum + (args.candidates.find((c) => canonicalizeUrl(c.doc.url) === canonicalizeUrl(doc.url))?.score ?? 0.7), 0) /
            Math.max(1, sources.length)
          ).toFixed(3),
        ),
      });
    }

    if (output.length === 0) {
      logger.warn("Structured content ideas synthesis produced no valid ideas after normalization, using heuristic fallback", {
        preview: rawContent.slice(0, 400),
      });
      return {
        ideas: null,
        timedOut: false,
        debug: {
          status: "normalization_fallback",
          provider: res.provider,
          model: res.model,
        },
      };
    }
    logger.info("Structured content ideas synthesis succeeded", {
      requested: args.numIdeas,
      returned: output.length,
      marketSignals: marketSignals.length,
      sourcegraphContext: sourcegraphContext.length,
    });
    return {
      ideas: output,
      timedOut: false,
      debug: {
        status: "success",
        provider: res.provider,
        model: res.model,
      },
    };
  } catch (error) {
    logger.warn(
      isTimedOutError(error)
        ? "Structured content ideas synthesis timed out, using heuristic fallback"
        : "Structured content ideas synthesis failed, using heuristic fallback",
      {
        error: error instanceof Error ? error.message : String(error),
      },
    );
    return {
      ideas: null,
      timedOut: isTimedOutError(error),
      debug: {
        status: isTimedOutError(error) ? "timeout" : "error",
        model: llmModel,
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function postProcessContentIdeasOutput(payload: ContentIdeasOutput): ContentIdeasOutput {
  const ideas = payload.ideas
    .map((idea) => {
      const sources = idea.sources
        .map((s) => ({ ...s, url: canonicalizeUrl(s.url) }))
        .filter((s) => !!s.url && !isWeakFinalIdeaSource(s));
      if (sources.length === 0) return null;
      const rewrittenTitle = maybeRewriteLiteralIdeaTitle({ ...idea, sources });
      return {
        ...idea,
        title: stripBoilerplateNoise(rewrittenTitle),
        thesis: stripBoilerplateNoise(idea.thesis),
        key_insights: idea.key_insights.map((x) => stripBoilerplateNoise(x)),
        content_outline: idea.content_outline.map((x) => stripBoilerplateNoise(x)),
        sourcegraph_integration_play:
          idea.sourcegraph_integration_play.length > 0
            ? idea.sourcegraph_integration_play
            : classifySourcegraphIntegrationOpportunity({
                title: idea.title,
                summary: idea.thesis,
                content: idea.content_outline.join(" "),
              }).sourcegraph_integration_play,
        sources,
      };
    })
    .filter((i): i is ContentIdea => i !== null);

  const dedupedByTopic = (() => {
    const byTopic = new Map<string, ContentIdea>();
    for (const idea of ideas) {
      const key = topicKeyFromIdeaTitle(idea.title);
      const existing = byTopic.get(key);
      if (!existing || idea.priority_score > existing.priority_score) {
        byTopic.set(key, idea);
      }
    }
    return Array.from(byTopic.values()).sort((a, b) => b.priority_score - a.priority_score);
  })();

  const finalIdeas =
    (payload.periodDays ?? 30) <= 14
      ? dedupedByTopic.length >= Math.min(2, ideas.length)
        ? dedupedByTopic
        : ideas
      : dedupedByTopic.length >= 3
        ? dedupedByTopic
        : ideas;

  return {
    ...payload,
    ideas: finalIdeas,
  };
}

function backfillLlmIdeasWithHeuristicIdeas(
  llmIdeas: ContentIdea[],
  heuristicIdeas: ContentIdea[],
  numIdeas: number,
): ContentIdea[] {
  const merged = [...llmIdeas];
  const seenTitleKeys = new Set(merged.map((idea) => normalizeIdeaTitleKey(idea.title)));
  const seenTopicKeys = new Set(merged.map((idea) => topicKeyFromIdeaTitle(idea.title)));

  for (const idea of heuristicIdeas) {
    if (merged.length >= numIdeas) break;
    const titleKey = normalizeIdeaTitleKey(idea.title);
    if (seenTitleKeys.has(titleKey)) continue;

    const topicKey = topicKeyFromIdeaTitle(idea.title);
    const canRelaxTopicCap = heuristicIdeas.length <= numIdeas;
    if (!canRelaxTopicCap && seenTopicKeys.has(topicKey)) continue;

    merged.push(idea);
    seenTitleKeys.add(titleKey);
    seenTopicKeys.add(topicKey);
  }

  return merged;
}

/** Synthetic doc ID for injected market brief context (not a real URL). */
const MARKET_BRIEF_CONTEXT_ID = "internal://market-brief-highlights";

type ContentIdeasCandidateGate = {
  name: string;
  keep: (c: ScoredIdeaCandidate, ctx: { periodDays: number; minScore: number }) => boolean;
};

function buildContentIdeasCandidateGates(ctx: {
  periodDays: number;
  minScore: number;
}): ContentIdeasCandidateGate[] {
  const { periodDays } = ctx;
  const isLongWindow = periodDays > 14;
  return [
    {
      name: "internal_market_brief_context",
      // Always passes; this gate exists only to make the trace explicit that the synthetic
      // market-brief context doc is injected (not retrieved).
      keep: () => true,
    },
    {
      name: "not_guardrail_violation",
      keep: (c) => !c.guardrailViolation,
    },
    {
      name: "not_weak_anchor_source",
      keep: (c, gateCtx) => !isWeakAnchorSource(c.doc, gateCtx.periodDays),
    },
    {
      name: "minimum_content_ideas_relevance",
      keep: (c) => hasMinimumContentIdeasRelevance(c.doc),
    },
    {
      name: "broad_sourcegraph_narrative_fit",
      keep: (c) => hasBroadSourcegraphNarrativeFit(c.doc),
    },
    {
      name: "has_canonical_url",
      keep: (c) => !!canonicalizeUrl(c.doc.url),
    },
    {
      name: "not_noisy_domain",
      keep: (c) => !isNoisyDomain(sourceFromUrl(c.doc.url)),
    },
    {
      name: "not_low_leverage_operational",
      keep: (c, ctx) => !isLowLeverageOperationalSource(c.doc, ctx.periodDays),
    },
    {
      name: "not_research_only_source",
      keep: (c, ctx) => !isResearchOnlySource(c.doc, ctx.periodDays),
    },
    {
      name: "not_generic_idea_landing_without_signals",
      keep: (c) => {
        const text = textOf(c.doc);
        const canonicalUrl = canonicalizeUrl(c.doc.url);
        if (!canonicalUrl) return false;
        if (
          isGenericIdeaPage(canonicalUrl) &&
          !/(benchmark|case study|customer|ga|release|pricing|security|compliance|enterprise)/.test(text)
        ) {
          return false;
        }
        return true;
      },
    },
    {
      name: "community_short_window_requires_concrete_signals",
      keep: (c) => {
        if (isLongWindow) return true;
        const text = textOf(c.doc);
        const domain = sourceFromUrl(c.doc.url);
        const sourceType = classifySourceTypeByDomain(domain);
        if (sourceType === "community" && !/(benchmark|case study|customer|ga|release notes)/.test(text)) {
          return false;
        }
        return true;
      },
    },
    {
      name: "secondary_community_short_window_requires_concrete_evidence",
      keep: (c) => {
        if (isLongWindow) return true;
        const text = textOf(c.doc);
        const domain = sourceFromUrl(c.doc.url);
        const sourceType = classifySourceTypeByDomain(domain);
        if (
          (sourceType === "secondary" || sourceType === "community") &&
          !hasConcreteEvidence(text)
        ) {
          return false;
        }
        return true;
      },
    },
    {
      name: "min_content_seed_score",
      keep: (c, ctx) => c.score >= ctx.minScore,
    },
  ];
}

function filterAndTraceContentIdeasCandidates(
  scored: ScoredIdeaCandidate[],
  ctx: { periodDays: number; minScore: number; pipelineTrace: boolean }
): { candidates: ScoredIdeaCandidate[]; gateStats?: ContentIdeasPipelineTrace["candidate_gates"] } {
  const gates = buildContentIdeasCandidateGates({ periodDays: ctx.periodDays, minScore: ctx.minScore });
  const gateCtx = { periodDays: ctx.periodDays, minScore: ctx.minScore };

  if (!ctx.pipelineTrace) {
    const candidates = scored.filter((c) => {
      if (c.doc.id === MARKET_BRIEF_CONTEXT_ID) return true;
      return gates.slice(1).every((g) => g.keep(c, gateCtx));
    });
    return { candidates };
  }

  let survivors = scored;
  const gateStats: ContentIdeasPipelineTrace["candidate_gates"] = [];

  for (const gate of gates) {
    const before = survivors.length;
    const next = survivors.filter((c) =>
      c.doc.id === MARKET_BRIEF_CONTEXT_ID ? true : gate.keep(c, gateCtx),
    );
    const after = next.length;
    gateStats.push({ name: gate.name, passed: after, dropped: before - after });
    survivors = next;
  }

  return { candidates: survivors, gateStats };
}

async function generateContentIdeasImpl(options: {
  periodDays?: number;
  focus?: string | null;
  numIdeas?: number;
  /** When provided, market brief findings are injected as context so content ideas are informed by the same research. */
  marketBriefSummary?: string | null;
  /** Test/eval hook: bypass live retrieval and use a fixed doc corpus. */
  retrievalOverride?: {
    marketBriefDocs?: RetrievedDoc[];
    competitorDocs?: RetrievedDoc[];
    contentIdeaDocs?: RetrievedDoc[];
  };
  debug?: boolean;
  /** When true, include `pipeline_trace` with Postgres/web retrieval + filtering diagnostics (JSON/debug only). */
  pipelineTrace?: boolean;
} = {}): Promise<ContentIdeasOutput> {
  const state = loadPlaybookState();
  const periodDays = options.periodDays ?? 30;
  // Month windows target 3-5 ideas across mediums; shorter windows can return more.
  const defaultNumIdeas = periodDays > 14 ? 5 : periodDays > 7 ? 8 : 10;
  const requested = options.numIdeas ?? defaultNumIdeas;
  const numIdeas = periodDays > 14 ? Math.min(5, Math.max(3, requested)) : requested;
  const debugLog = options.debug ? new AgentScoringDebugger("content_ideas", periodDays) : null;
  const pipelineTraceEnabled = options.pipelineTrace === true;
  const marketRetrievalTrace = pipelineTraceEnabled
    ? createEmptyAgentRetrievalTrace("market_brief", periodDays)
    : null;
  const competitorRetrievalTrace = pipelineTraceEnabled
    ? createEmptyAgentRetrievalTrace("competitor_intel", periodDays)
    : null;
  const contentPoolRetrievalTrace = pipelineTraceEnabled
    ? createEmptyAgentRetrievalTrace("content_ideas", periodDays)
    : null;

  // Build the candidate pool from curated intel plus Sourcegraph-owned content so ideas can emerge
  // from market signals while still being grounded in current product and messaging context.
  const marketDocs =
    options.retrievalOverride?.marketBriefDocs ??
    await retrieveForAgent("market_brief", {
      periodDays,
      query: options.focus ?? null,
      maxEnrich: 0,
      trace: marketRetrievalTrace,
    });
  const competitorDocs =
    options.retrievalOverride?.competitorDocs ??
    await retrieveForAgent("competitor_intel", {
      periodDays,
      query: options.focus ?? null,
      maxEnrich: 0,
      trace: competitorRetrievalTrace,
    });
  const contentIdeaDocs =
    options.retrievalOverride?.contentIdeaDocs ??
    await retrieveForAgent("content_ideas", {
      periodDays,
      query: options.focus ?? null,
      maxEnrich: 0,
      trace: contentPoolRetrievalTrace,
    });

  // If market brief summary was passed (e.g. when run after market brief), inject it as a synthetic context doc.
  const docsWithBriefContext =
    options.marketBriefSummary?.trim()
      ? [
          {
            id: MARKET_BRIEF_CONTEXT_ID,
            source: "web" as const,
            url: MARKET_BRIEF_CONTEXT_ID,
            title: "Market brief highlights",
            snippet: options.marketBriefSummary.trim().slice(0, 500),
            content: options.marketBriefSummary.trim(),
            publishedAt: new Date(),
            metadata: { primarySource: "market_brief" },
          },
          ...marketDocs,
          ...competitorDocs,
          ...contentIdeaDocs,
        ]
      : [...marketDocs, ...competitorDocs, ...contentIdeaDocs];

  const seenIds = new Set<string>();
  const seenUrls = new Set<string>();
  const allDocs = docsWithBriefContext.filter((d) => {
    if (d.id === MARKET_BRIEF_CONTEXT_ID) return true;
    if (d.id && seenIds.has(d.id)) return false;
    const url = canonicalizeUrl(d.url);
    if (!url) return false;
    if (seenUrls.has(url)) return false;
    if (d.id) seenIds.add(d.id);
    seenUrls.add(url);
    return true;
  });

  const rankingTrace: AgentRankingTrace | null = pipelineTraceEnabled
    ? createEmptyRankingTrace("content_ideas", 25)
    : null;
  const ranked = await rankForAgent(
    "content_ideas",
    allDocs,
    rankingTrace ? { rankingTrace, rankingSampleSize: 25 } : undefined,
  );

  const windowMs = periodDays * 24 * 60 * 60 * 1000;
  const cutoffMs = Date.now() - windowMs;

  const scoredCandidates = applyShortWindowDomainConcentrationPenalty(
    ranked.map((doc) => scoreCandidate(doc, state, periodDays)),
    periodDays,
  );

  const minScoreThreshold = periodDays > 14 ? 0.35 : 0.42;
  const { candidates: gatedCandidates, gateStats } = filterAndTraceContentIdeasCandidates(
    scoredCandidates,
    { periodDays, minScore: minScoreThreshold, pipelineTrace: pipelineTraceEnabled },
  );

  const candidates = gatedCandidates
    .map((c) => {
      // Boost recency for short windows so "day"/"week" reports favor truly recent items.
      const inWindow = c.doc.publishedAt && c.doc.publishedAt.getTime() >= cutoffMs;
      const recencyBoost = periodDays <= 14 && inWindow ? 0.18 : periodDays <= 30 && inWindow ? 0.08 : 0;
      return { ...c, score: c.score + recencyBoost };
    })
    .sort((a, b) => b.score - a.score);

  // Debug logging before selection
  if (debugLog) {
    for (const candidate of candidates.slice(0, Math.min(50, candidates.length))) {
      const url = candidate.doc.url ?? "";
      const domain = sourceFromUrl(url);
      debugLog.log({
        goal: "content_ideas",
        docId: candidate.doc.id ?? "unknown",
        url,
        domain,
        title: candidate.doc.title,
        type: candidate.seedType,
        componentScores: {
          contentSeedScore: candidate.contentSeedScore,
          baseScore: candidate.doc.baseScore,
          agentScore: candidate.doc.agentScore,
        },
        finalScore: candidate.score,
        fate: "dropped", // Will be updated post-selection if selected
      });
    }
  }

  // For diversity, pre-select more candidates than we'll output, so domain-diversity filters
  // have enough material to work with. For month windows, we may filter down to 4-6.
  // Increased multiplier from 2.5x to 4x to ensure strong domain diversity when candidates cluster.
  const selectionPoolSize = Math.ceil(numIdeas * (periodDays > 14 ? 4.0 : 2.5));
  const selected = buildSelectionPool(candidates, selectionPoolSize, periodDays);
  let sourcegraphContextDocs = collectSourcegraphContextDocs(contentIdeaDocs, ranked);
  if (sourcegraphContextDocs.length === 0 && !options.retrievalOverride?.contentIdeaDocs) {
    const sourcegraphFallbackDocs = await loadSourcegraphContextFallbackDocs(options.focus ?? null);
    sourcegraphContextDocs = collectSourcegraphContextDocs(sourcegraphFallbackDocs, ranked);
    logger.info("Recovered Sourcegraph context docs from wider retrieval window", {
      periodDays,
      recovered: sourcegraphContextDocs.length,
    });
  }

  const fallbackIdeas = selected
    .map((candidate) => ({
      candidate,
      idea: toIdea(candidate, state, normalizeTargetSegment(candidate.segment)),
    }))
    // Keep fallback broad; downstream title/core-claim/domain/channel dedupe handles quality control.
    .filter(({ idea }) => Boolean(idea.title?.trim()))
    .map(({ idea }) => idea);
  const sourceDrivenIdeas = buildSourceDrivenIdeasFromCandidates(selected, state, numIdeas, periodDays);
  const rawIdeas = (() => {
    if (sourceDrivenIdeas.length === 0) return fallbackIdeas;
    const merged = [...sourceDrivenIdeas];
    const seen = new Set(sourceDrivenIdeas.map((idea) => normalizeIdeaTitleKey(idea.title)));
    for (const idea of fallbackIdeas) {
      const key = normalizeIdeaTitleKey(idea.title);
      if (seen.has(key)) continue;
      merged.push(idea);
      seen.add(key);
    }
    return merged;
  })();
  const ideaPipelineStats = {
    fallback_ideas: fallbackIdeas.length,
    source_driven_ideas: sourceDrivenIdeas.length,
    raw_ideas: rawIdeas.length,
    after_title_dedupe: 0,
    after_core_claim_dedupe: 0,
    after_domain_diversity: 0,
    after_channel_diversity: 0,
  };
  const ideas = (() => {
    const byTitle = new Map<string, ContentIdea>();
    for (const idea of rawIdeas) {
      const titleKey = normalizeIdeaTitleKey(idea.title);
      const existing = byTitle.get(titleKey);
      if (!existing || idea.priority_score > existing.priority_score) {
        byTitle.set(titleKey, idea);
      }
    }
    const afterTitle = Array.from(byTitle.values());
    ideaPipelineStats.after_title_dedupe = afterTitle.length;
    // Month windows should collapse repeated core claims more aggressively.
    const deduped =
      periodDays > 14
        ? (() => {
            const byCoreClaim = new Map<string, ContentIdea>();
            for (const idea of afterTitle) {
              const key = `${idea.channel}|${(idea.core_claim ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120)}`;
              if (!key) {
                byCoreClaim.set(`title:${normalizeIdeaTitleKey(idea.title)}`, idea);
                continue;
              }
              const existing = byCoreClaim.get(key);
              if (!existing || idea.priority_score > existing.priority_score) {
                byCoreClaim.set(key, idea);
              }
            }
            return Array.from(byCoreClaim.values()).sort(
              (a, b) => b.priority_score - a.priority_score,
            );
          })()
        : afterTitle.sort((a, b) => b.priority_score - a.priority_score);
    ideaPipelineStats.after_core_claim_dedupe = deduped.length;

    // Diversity: avoid over-indexing on a single domain (e.g. github.blog) when there are many sources.
    // For month windows, enforce multiple distinct domains (min 3 when available)
    const perDomainCap = periodDays > 14 ? 2 : 3;
    const minDistinctDomains = periodDays > 14 ? 3 : 1;
    const domainCounts = new Map<string, number>();
    const diversified: ContentIdea[] = [];
    
    for (const idea of deduped) {
      const primaryUrl = idea.sources[0]?.url;
      const domain = sourceFromUrl(primaryUrl) || "unknown";
      const count = domainCounts.get(domain) ?? 0;
      if (count >= perDomainCap) continue;
      domainCounts.set(domain, count + 1);
      diversified.push(idea);
      if (diversified.length >= numIdeas) break;
    }

    // For month windows, if we have fewer than target ideas, try to reach target by relaxing domain cap
    // but only if we still have multiple distinct sources
    if (periodDays > 14 && diversified.length < 4 && deduped.length > diversified.length) {
      const distinctDomains = new Set(diversified.map((i) => sourceFromUrl(i.sources[0]?.url)));
      if (distinctDomains.size >= minDistinctDomains) {
        // We have enough domain diversity; add more items from top domains
        const relaxedCap = perDomainCap + 1;
        const domainCounts2 = new Map<string, number>();
        for (const idea of diversified) {
          const domain = sourceFromUrl(idea.sources[0]?.url) || "unknown";
          domainCounts2.set(domain, (domainCounts2.get(domain) ?? 0) + 1);
        }
        for (const idea of deduped) {
          const domain = sourceFromUrl(idea.sources[0]?.url) || "unknown";
          if (diversified.some((i) => i.title === idea.title)) continue;
          const count = domainCounts2.get(domain) ?? 0;
          if (count >= relaxedCap) continue;
          domainCounts2.set(domain, count + 1);
          diversified.push(idea);
          if (diversified.length >= numIdeas) break;
        }
      }
    }

    ideaPipelineStats.after_domain_diversity = diversified.length;
    const channelDiversified = periodDays > 14 ? enforceChannelDiversity(diversified, numIdeas) : diversified;
    ideaPipelineStats.after_channel_diversity = channelDiversified.length;
    return channelDiversified;
  })();
  const corroboratedIdeas = periodDays > 14 ? ideas : addCorroboratingSources(ideas, selected);
  let evidenceQualifiedIdeas = enforceMonthlyEvidenceThreshold(corroboratedIdeas, periodDays);
  if (periodDays > 14) {
    evidenceQualifiedIdeas = backfillMonthIdeasWithFormatDiversity(
      evidenceQualifiedIdeas,
      selected,
      state,
      numIdeas,
    );
    const minDistinctFrames = Math.min(3, Math.max(1, numIdeas));
    evidenceQualifiedIdeas = enforceFrameDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
      minDistinctFrames,
      true,
    );
    evidenceQualifiedIdeas = enforceChannelDiversity(evidenceQualifiedIdeas, numIdeas).slice(0, numIdeas);
    const distinctFramesAvailable = new Set(
      evidenceQualifiedIdeas.map((idea) => topicKeyFromIdeaTitle(idea.title)),
    ).size;
    const shouldEnforceStrictNoRepeats = distinctFramesAvailable >= minDistinctFrames;
    evidenceQualifiedIdeas = enforceFrameDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
      minDistinctFrames,
      !shouldEnforceStrictNoRepeats,
    ).slice(0, numIdeas);
    evidenceQualifiedIdeas = backfillMonthWithSecondaryDistinctThemes(
      evidenceQualifiedIdeas,
      gatedCandidates,
      state,
      numIdeas,
    );
    const strictFramesAvailable = new Set(
      evidenceQualifiedIdeas.map((idea) => topicKeyFromIdeaTitle(idea.title)),
    ).size;
    evidenceQualifiedIdeas = enforceFrameDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
      minDistinctFrames,
      strictFramesAvailable < minDistinctFrames,
    ).slice(0, numIdeas);
  } else {
    evidenceQualifiedIdeas = backfillShortWindowDistinctThemes(
      evidenceQualifiedIdeas,
      gatedCandidates,
      state,
      numIdeas,
    );
    const shortWindowDistinctFrames = Math.min(4, Math.max(2, numIdeas));
    evidenceQualifiedIdeas = enforceFrameDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
      shortWindowDistinctFrames,
      false,
    ).slice(0, numIdeas);
    evidenceQualifiedIdeas = enforceThesisAndDifferentiatorDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
    );
    evidenceQualifiedIdeas = enforceNarrativeClusterCap(
      evidenceQualifiedIdeas,
      numIdeas,
      periodDays,
    );
    evidenceQualifiedIdeas = enforceChannelDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
    );
    evidenceQualifiedIdeas = diversifyShortWindowPrimaryHooks(
      evidenceQualifiedIdeas,
      gatedCandidates,
      state,
      numIdeas,
    );
    evidenceQualifiedIdeas = enforcePrimarySourceDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
    );
    evidenceQualifiedIdeas = rebalanceCorroboratingSourcesAcrossIdeas(
      evidenceQualifiedIdeas,
      gatedCandidates,
    );
    evidenceQualifiedIdeas = enforceFrameDiversity(
      evidenceQualifiedIdeas,
      numIdeas,
      Math.min(3, Math.max(2, numIdeas)),
      false,
    ).slice(0, numIdeas);
  }

  const llmSynthesis = await synthesizeStructuredContentIdeasWithLLM({
    candidates: candidates.slice(0, Math.max(numIdeas * 2, 8)),
    sourcegraphContextDocs,
    state,
    numIdeas,
    periodDays,
  });
  if (llmSynthesis.ideas && llmSynthesis.ideas.length > 0) {
    evidenceQualifiedIdeas = backfillLlmIdeasWithHeuristicIdeas(
      llmSynthesis.ideas,
      evidenceQualifiedIdeas,
      numIdeas,
    );
  }
  const droppedCandidates = rawIdeas
    .map((i) => i.title)
    .filter((title) =>
      !evidenceQualifiedIdeas.some(
        (picked) => normalizeIdeaTitleKey(picked.title) === normalizeIdeaTitleKey(title),
      ),
    )
    .slice(0, 12);
  const achievedBucketCounts = {
    beachhead: evidenceQualifiedIdeas.filter((i) => toSegmentBucket(i.target_segment, state) === "beachhead").length,
    adjacent: evidenceQualifiedIdeas.filter((i) => toSegmentBucket(i.target_segment, state) === "adjacent").length,
    broader: evidenceQualifiedIdeas.filter((i) => toSegmentBucket(i.target_segment, state) === "broader").length,
    total: evidenceQualifiedIdeas.length,
  };
  const achievedMix = achievedBucketCounts.total > 0
    ? {
        beachhead: Number((achievedBucketCounts.beachhead / achievedBucketCounts.total).toFixed(3)),
        adjacent: Number((achievedBucketCounts.adjacent / achievedBucketCounts.total).toFixed(3)),
        broader: Number((achievedBucketCounts.broader / achievedBucketCounts.total).toFixed(3)),
      }
    : { beachhead: 0, adjacent: 0, broader: 0 };
  const achievedSegmentCounts = evidenceQualifiedIdeas.reduce<Record<string, number>>((acc, idea) => {
    acc[idea.target_segment] = (acc[idea.target_segment] ?? 0) + 1;
    return acc;
  }, {});

  // Debug logging for final ideas
  if (debugLog) {
    for (const idea of evidenceQualifiedIdeas) {
      const url = idea.sources[0]?.url ?? "";
      const domain = sourceFromUrl(url);
      debugLog.log({
        goal: "content_ideas",
        docId: url,
        url,
        domain,
        title: idea.title,
        type: "idea",
        componentScores: {
          priorityScore: idea.priority_score,
        },
        finalScore: idea.priority_score,
        fate: "idea_seed",
        flags: [idea.channel, idea.target_segment],
      });
    }
    debugLog.flush();
  }

  let pipelineTracePayload: ContentIdeasPipelineTrace | undefined;
  if (
    pipelineTraceEnabled &&
    marketRetrievalTrace &&
    competitorRetrievalTrace &&
    gateStats &&
    rankingTrace
  ) {
    const refinement_stages = [
      { stage: "ranked_pool", count: ranked.length },
      { stage: "after_candidate_gates", count: gatedCandidates.length },
      { stage: "selection_pool", count: selected.length },
      { stage: "fallback_ideas", count: ideaPipelineStats.fallback_ideas },
      { stage: "source_driven_ideas", count: ideaPipelineStats.source_driven_ideas },
      { stage: "raw_ideas", count: rawIdeas.length },
      { stage: "after_title_dedupe", count: ideaPipelineStats.after_title_dedupe },
      { stage: "after_core_claim_dedupe", count: ideaPipelineStats.after_core_claim_dedupe },
      { stage: "after_domain_diversity", count: ideaPipelineStats.after_domain_diversity },
      { stage: "after_channel_diversity", count: ideaPipelineStats.after_channel_diversity },
      { stage: "final_ideas", count: evidenceQualifiedIdeas.length },
    ];
    const interpretable_steps: CuratorTraceStep[] = [
      ...retrievalTraceToSteps(marketRetrievalTrace),
      ...retrievalTraceToSteps(competitorRetrievalTrace),
      ...rankingTraceToSteps(rankingTrace),
      ...refinement_stages.map((s) => ({
        id: `refinement_${s.stage}`,
        label: s.stage.replace(/_/g, " "),
        detail: `${s.count} items`,
        metrics: { count: s.count },
      })),
    ];
    pipelineTracePayload = {
      schemaVersion: CURATOR_TRACE_SCHEMA_VERSION,
      focus: options.focus ?? null,
      retrieval: {
        market_brief: marketRetrievalTrace,
        competitor_intel: competitorRetrievalTrace,
        ...(contentPoolRetrievalTrace ? { content_pool: contentPoolRetrievalTrace } : {}),
      },
      ranking: rankingTrace,
      pool: {
        after_dedupe_urls: allDocs.length,
        ranked_count: ranked.length,
      },
      candidate_gates: gateStats,
      selection: {
        min_score_threshold: minScoreThreshold,
        selection_pool_size: selectionPoolSize,
        selected_top_urls: selected
          .map((c) => canonicalizeUrl(c.doc.url))
          .filter((u): u is string => !!u)
          .slice(0, 25),
      },
      refinement_stages,
      interpretable_steps,
    };
  }

  const llmDebug: NonNullable<ContentIdeasOutput["llm_debug"]> | undefined =
    llmSynthesis.debug || llmSynthesis.timedOut
      ? {
          ...(llmSynthesis.timedOut ? { structured_synthesis_timed_out: true } : {}),
          ...(llmSynthesis.debug ? { structured_synthesis: llmSynthesis.debug } : {}),
        }
      : undefined;

  return postProcessContentIdeasOutput({
    generated_at: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    periodDays,
    playbook_confidence_flags: state.confidence_flags,
    ...(llmDebug ? { llm_debug: llmDebug } : {}),
    ...(pipelineTracePayload ? { pipeline_trace: pipelineTracePayload } : {}),
    selection_debug: {
      target_mix: { beachhead: 0, adjacent: 0, broader: 0 },
      achieved_mix: achievedMix,
      achieved_counts: achievedBucketCounts,
      achieved_segment_counts: achievedSegmentCounts,
      dropped_candidates: droppedCandidates,
    },
    ideas: evidenceQualifiedIdeas,
  });
}

export const generateContentIdeas = withLangSmithTraceable(generateContentIdeasImpl, {
  name: "generate_content_ideas",
  run_type: "chain",
  defaultProjectName: "code-intel-digest-agents",
  processInputs: (inputs) => {
    const [options] = "args" in inputs ? inputs.args : [undefined];
    return {
      periodDays: options?.periodDays ?? null,
      focus: options?.focus ?? null,
      numIdeas: options?.numIdeas ?? null,
      pipelineTrace: options?.pipelineTrace === true,
      hasMarketBriefSummary: Boolean(options?.marketBriefSummary),
      debug: options?.debug === true,
    };
  },
  processOutputs: (outputs) => ({
    generated_at:
      outputs && typeof outputs === "object" && "generated_at" in outputs
        ? outputs.generated_at
        : null,
    ideaCount:
      outputs && typeof outputs === "object" && "ideas" in outputs && Array.isArray(outputs.ideas)
        ? outputs.ideas.length
        : 0,
    periodDays:
      outputs && typeof outputs === "object" && "periodDays" in outputs
        ? outputs.periodDays ?? null
        : null,
    pipelineTrace:
      outputs && typeof outputs === "object" && "pipeline_trace" in outputs
        ? Boolean(outputs.pipeline_trace)
        : false,
  }),
});
