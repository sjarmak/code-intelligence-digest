import { retrieveForAgent } from "../pipeline/agentRetrieval";
import { rankForAgent, type AgentRankedDoc } from "../pipeline/agentRank";
import { loadPlaybookState, type PlaybookState } from "./playbook-state";
import { classifySourceTypeByDomain, getDomainFromUrl } from "../../config/competitor-intel";
import {
  classifySourcegraphIntegrationOpportunity,
  type IntegrationOpportunityLevel,
} from "./sourcegraph-integration-opportunity";

export interface MarketBriefEvidence {
  source: string;
  url: string;
  date: string;
  confidence: "high" | "medium" | "low";
}

export interface MarketBriefDelta {
  title: string;
  summary: string;
  segment_impact: string[];
  persona_impact: string[];
  playbook_alignment: "reinforces" | "threatens" | "unknown";
  affected_assumptions: string[];
  why_it_matters: string;
  policy_basis: string[];
  evidence_basis: string[];
  recommended_action: {
    owner: "PMM" | "Sales" | "SE" | "Product" | "Exec";
    action: string;
  };
  integration_opportunity: IntegrationOpportunityLevel;
  sourcegraph_integration_play: string[];
  evidence_quality_note?: string;
  evidence: MarketBriefEvidence[];
}

export interface MarketBriefOutput {
  brief_date: string;
  playbook_version: string;
  playbook_confidence_flags?: Record<string, "high" | "medium" | "low">;
  executive_delta: MarketBriefDelta[];
  watch_items: MarketBriefDelta[];
  invalidations_to_monitor: string[];
  noisy_items_suppressed: string[];
}

interface ScoredDoc {
  doc: AgentRankedDoc;
  score: number;
  contradiction: boolean;
  segmentImpact: string[];
  personaImpact: string[];
  policyBasis: string[];
  evidenceSignalScore: number;
}

const MARKET_TRACKING_DOMAINS = new Set([
  "click.kit-mail3.com",
  "click.kit-mail.com",
  "link.mail.beehiiv.com",
]);

const LOW_SIGNAL_MARKET_DOMAINS = new Set([
  "marketsandmarkets.com",
  "htfmarketinsights.com",
  "getpanto.ai",
  "codewave.com",
  "pieces.app",
]);

function textOf(doc: AgentRankedDoc): string {
  return `${doc.title} ${doc.snippet ?? ""} ${doc.content ?? ""}`.toLowerCase();
}

/** Common UI/nav/chrome phrases to strip from snippets so Watch Items show content only. */
const PAGE_CHROME_PATTERNS: RegExp[] = [
  /\bselect your language\s+english\s+deutsch\s+español[\s\S]{0,120}?/gi,
  /\byou signed in with another tab or window[\s\S]{0,80}?reload to refresh[\s\S]{0,40}/gi,
  /\byou signed out of your session[\s\S]{0,60}/gi,
  /\breload to refresh your session[\s\S]{0,40}/gi,
  /\byou switched accounts on another tab or window[\s\S]{0,40}/gi,
  /\bdismiss alert[\s\S]{0,30}/gi,
  /\bnotifications\s+you must be signed in[\s\S]{0,60}/gi,
  /\bskip to main content[\s\S]{0,20}/gi,
  /\bskip to footer[\s\S]{0,20}/gi,
  /\bpublic\s+notifications\s+you\s+must be signed in[\s\S]{0,80}/gi,
  /\s*\[[^\]]*\]\s*\(\s*https?:\/\/[^\s)]+\)/g,
  /\b(?:free|team|enterprise)\s+plan\s+customers\s*\[[\s\S]{0,100}?\]/gi,
];

function stripBoilerplateNoise(text: string): string {
  let out = text
    .replace(/<[^>]+>/g, " ")
    .replace(/\bsection title:\s*/gi, " ")
    .replace(/\bcontent:\s*/gi, " ")
    .replace(/\btable of contents\b/gi, " ");
  for (const re of PAGE_CHROME_PATTERNS) {
    out = out.replace(re, " ");
  }
  return out.replace(/\s+/g, " ").trim();
}

function canonicalizeUrl(url: string): string {
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

function isGenericMarketPage(url: string): boolean {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase().replace(/\/+$/, "");
    if (path === "" || path === "/") return true;
    if (/^\/(docs|documentation|product|products|features|pricing|careers|company|about)$/.test(path)) return true;
    return false;
  } catch {
    return true;
  }
}

function segmentImpactFromText(text: string, state: PlaybookState): string[] {
  const out: string[] = [];
  const beachhead = state.primary_beachhead.toLowerCase();
  if (text.includes(beachhead) || text.includes("capital market") || text.includes("trading")) {
    out.push(state.primary_beachhead);
  }
  for (const seg of state.adjacent_segments) {
    const l = seg.toLowerCase();
    if (text.includes(l) || (l.includes("banks") && text.includes("bank"))) out.push(seg);
  }
  if (out.length === 0 && /(finserv|financial services|regulated finance|broker|insurance)/.test(text)) {
    out.push("FinServ");
  }
  return Array.from(new Set(out));
}

function personaImpactFromText(text: string): string[] {
  const map: Array<[string, string[]]> = [
    ["Head of Developer Platform", ["platform team", "developer platform", "internal developer platform"]],
    ["VP Engineering", ["vp engineering", "engineering leadership", "cto"]],
    ["Staff Engineer", ["staff engineer", "principal engineer", "architecture", "monorepo"]],
    ["Security/Compliance", ["security", "compliance", "audit", "byok", "self-hosted", "self hosted"]],
  ];
  const out: string[] = [];
  for (const [persona, terms] of map) {
    if (terms.some((t) => text.includes(t))) out.push(persona);
  }
  return out;
}

function confidenceFromDoc(doc: AgentRankedDoc): "high" | "medium" | "low" {
  const source = String(doc.metadata.primarySource ?? "");
  if (source === "postgres") return "high";
  if (doc.url) return "medium";
  return "low";
}

function evidenceQualityNote(input: {
  contradiction: boolean;
  confidence: "high" | "medium" | "low";
  evidenceSignalScore: number;
}): string {
  if (input.contradiction) {
    return "Potential invalidation signal. Confirm with a primary source before changing GTM guidance.";
  }
  if (input.confidence === "high" && input.evidenceSignalScore >= 0.75) {
    return "High-confidence signal from a strong source with specific enterprise/coding evidence.";
  }
  if (input.evidenceSignalScore >= 0.6) {
    return "Moderate-confidence signal. Corroborate with one additional primary source this week.";
  }
  return "Early or low-confidence signal. Monitor for repeat evidence before changing GTM direction.";
}

function isMarketBriefNoise(doc: AgentRankedDoc): boolean {
  const text = textOf(doc);
  const domain = getDomainFromUrl(doc.url ?? "");
  const sourceType = classifySourceTypeByDomain(domain);
  if (sourceType === "community") return true;
  if (MARKET_TRACKING_DOMAINS.has(domain)) return true;
  if (LOW_SIGNAL_MARKET_DOMAINS.has(domain)) return true;
  if (/(reddit\.com|dev\.to|podcasters\.spotify\.com)/.test(domain)) return true;
  if (
    /((market|industry)\s+(size|share|forecast|outlook|landscape)|worth\s+\$\d+|growth opportunities|cagr|global\s+market)/.test(
      text,
    )
  ) {
    return true;
  }
  if (/(best .* ai coding tools|top .* ai coding tools|tested\s*&\s*compared|awesome-monorepo|staff cuts the new ai normal)/.test(text)) {
    return true;
  }
  if (/(vibe coding is fun until|dev community)/.test(text)) return true;
  return false;
}

function isPlaybookContradiction(text: string): boolean {
  if (/(replace github|replace copilot|replace sourcegraph|ai assistant replacement)/.test(text)) {
    return true;
  }

  const competitorOrAssistantMention =
    /(copilot|cursor|windsurf|codeium|gitlab duo|sourcegraph|ai coding assistant|code assistant|coding agent|developer assistant|assistant platform)/.test(
      text,
    );
  const threatClaim = /(replace|replacement for|displace|obsolete|beats|outperform|directly competes|rip and replace)/.test(text);
  const codingContext = /(coding|codebase|repository|repo|ide|developer|software|programming|pull request|ci\/cd)/.test(text);

  return competitorOrAssistantMention && threatClaim && codingContext;
}

function isLowSignalMarketDoc(doc: AgentRankedDoc): boolean {
  const text = textOf(doc);
  const url = canonicalizeUrl(doc.url ?? "");
  if (!url) return true;
  if (isGenericMarketPage(url) && !/(benchmark|case study|pricing|security|compliance|launch|release|ga|enterprise)/.test(text)) {
    return true;
  }
  return false;
}

function ownerFromDoc(text: string): "PMM" | "Sales" | "SE" | "Product" | "Exec" {
  if (/(compliance|security|byok|self-hosted|audit)/.test(text)) return "SE";
  if (/(pricing|packaging|procurement|enterprise plan)/.test(text)) return "Sales";
  if (/(launch|ga|feature|integration|api|mcp)/.test(text)) return "Product";
  if (/(positioning|narrative|message|category)/.test(text)) return "PMM";
  return "Exec";
}

function evidenceSignalScoreFromText(text: string): number {
  const signals = [
    /(launch|release|ga|generally available|pricing|customer|case study|benchmark|rollout|adoption trend)/.test(text),
    /(compliance|security|audit|byok|rbac|self-hosted|governance|risk)/.test(text),
    /(copilot|cursor|windsurf|codeium|gitlab duo|sourcegraph|coding assistant|developer platform)/.test(text),
    /(mcp|context layer|code search|cross-repo|batch changes|migration|remediation|refactor)/.test(text),
  ];
  const hits = signals.filter(Boolean).length;
  return hits / signals.length;
}

function scoreDoc(doc: AgentRankedDoc, state: PlaybookState): ScoredDoc {
  const text = textOf(doc);
  const segmentImpact = segmentImpactFromText(text, state);
  const personaImpact = personaImpactFromText(text);

  const segment_priority_score = segmentImpact.includes(state.primary_beachhead)
    ? 1
    : segmentImpact.length > 0
      ? 0.75
      : 0.2;
  const persona_priority_score = Math.min(1, personaImpact.length * 0.35);
  const competitive_risk_score = /(github|copilot|cursor|gitlab|augment|moderne|context engine|repo context)/.test(text)
    ? 1
    : 0.3;
  const enterprise_relevance_score = /(compliance|security|self-hosted|self hosted|byok|rbac|audit)/.test(text)
    ? 1
    : 0.25;
  const message_impact_score = /(cross-repo|code search|deep search|batch changes|mcp|context layer|migration|remediation)/.test(text)
    ? 1
    : 0.25;
  const actionability_score = /(launch|ga|pricing|customer|benchmark|case study|new|release)/.test(text)
    ? 0.9
    : 0.3;

  const contradiction = isPlaybookContradiction(text);
  const evidenceSignalScore = evidenceSignalScoreFromText(text);

  const contradiction_bonus = contradiction ? 0.35 : 0;

  const score =
    0.14 * segment_priority_score +
    0.1 * persona_priority_score +
    0.18 * competitive_risk_score +
    0.16 * enterprise_relevance_score +
    0.16 * message_impact_score +
    0.12 * actionability_score +
    0.08 * Math.min(1, doc.agentScore) +
    0.06 * evidenceSignalScore +
    contradiction_bonus;

  const policyBasis: string[] = [];
  if (segmentImpact.includes(state.primary_beachhead)) policyBasis.push(`beachhead:${state.primary_beachhead}`);
  if (segmentImpact.some((s) => state.adjacent_segments.includes(s))) policyBasis.push("adjacent_finserv_corridor");
  if (enterprise_relevance_score > 0.8) policyBasis.push("enterprise_requirements_priority");
  if (message_impact_score > 0.8) policyBasis.push("context_layer_message_priority");
  if (contradiction) policyBasis.push("playbook_contradiction_bonus");

  return { doc, score, contradiction, segmentImpact, personaImpact, policyBasis, evidenceSignalScore };
}

function toDelta(item: ScoredDoc, state: PlaybookState): MarketBriefDelta {
  const text = textOf(item.doc);
  const integration = classifySourcegraphIntegrationOpportunity({
    title: item.doc.title,
    summary: item.doc.snippet ?? "",
    content: item.doc.content ?? "",
  });
  const alignment: "reinforces" | "threatens" | "unknown" =
    item.contradiction
      ? "threatens"
      : item.score >= 0.72 &&
          item.evidenceSignalScore >= 0.6 &&
          (/(mcp|context layer|repo context|code search|cross-repo)/.test(text) ||
            /(compliance|security|audit|byok|self-hosted)/.test(text))
        ? "reinforces"
        : "unknown";

  const assumptions: string[] = [];
  if (/(mcp|context layer|repo context)/.test(text)) assumptions.push("MCP complements assistants");
  if (/(compliance|security|byok|self-hosted|audit)/.test(text)) assumptions.push("FinServ compliance lead");
  if (item.contradiction) assumptions.push("Guardrail assumptions may be invalidated");

  const evidenceUrl = item.doc.url ?? "";
  const evidenceSource = getDomainFromUrl(evidenceUrl) || "internal";
  const confidence = confidenceFromDoc(item.doc);

  return {
    title: item.doc.title,
    summary: stripBoilerplateNoise((item.doc.snippet ?? item.doc.content ?? "").slice(0, 480)).slice(0, 320),
    segment_impact: item.segmentImpact.length > 0 ? item.segmentImpact : ["Other"],
    persona_impact: item.personaImpact.length > 0 ? item.personaImpact : ["Unknown"],
    playbook_alignment: alignment,
    affected_assumptions: assumptions.length > 0 ? assumptions : ["No direct playbook invalidation found; monitor for repeated signal."],
    why_it_matters:
      alignment === "threatens"
        ? "This development may invalidate a current GTM assumption and should be reviewed quickly to avoid messaging or deal-risk drift."
        : alignment === "reinforces"
          ? "This development affects current segment, buyer, or enterprise-positioning decisions and should be incorporated into near-term GTM motion."
          : "Signal is plausible but evidence is not yet strong enough to change GTM direction; monitor for corroboration.",
    policy_basis: item.policyBasis,
    evidence_basis: [item.doc.title],
    recommended_action: {
      owner: ownerFromDoc(text),
      action:
        alignment === "threatens"
          ? "Review playbook assumptions and update battlecard/messaging guidance as needed."
          : alignment === "reinforces"
            ? "Incorporate this signal into active messaging, qualification, and campaign planning this week."
            : "Track follow-on evidence this week and only update messaging after corroboration from high-confidence sources.",
    },
    integration_opportunity: integration.level,
    sourcegraph_integration_play: integration.sourcegraph_integration_play,
    evidence_quality_note: evidenceQualityNote({
      contradiction: item.contradiction,
      confidence,
      evidenceSignalScore: item.evidenceSignalScore,
    }),
    evidence: [
      {
        source: evidenceSource,
        url: evidenceUrl,
        date: item.doc.publishedAt ? item.doc.publishedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        confidence,
      },
    ],
  };
}

export function postProcessMarketBriefOutput(payload: MarketBriefOutput): MarketBriefOutput {
  const cleanDelta = (delta: MarketBriefDelta): MarketBriefDelta | null => {
    const evidence = delta.evidence
      .map((e) => ({ ...e, url: canonicalizeUrl(e.url) }))
      .filter((e) => !!e.url);
    if (evidence.length === 0) return null;
    const primaryUrl = evidence[0]?.url ?? "";
    if (isGenericMarketPage(primaryUrl) && delta.playbook_alignment === "unknown") return null;

    return {
      ...delta,
      summary: stripBoilerplateNoise(delta.summary).slice(0, 320),
      sourcegraph_integration_play:
        delta.sourcegraph_integration_play.length > 0
          ? delta.sourcegraph_integration_play
          : classifySourcegraphIntegrationOpportunity({
              title: delta.title,
              summary: delta.summary,
              content: delta.why_it_matters,
            }).sourcegraph_integration_play,
      evidence,
    };
  };

  return {
    ...payload,
    executive_delta: payload.executive_delta.map(cleanDelta).filter((d): d is MarketBriefDelta => d !== null),
    watch_items: payload.watch_items.map(cleanDelta).filter((d): d is MarketBriefDelta => d !== null),
  };
}

export async function generateMarketBrief(options: {
  periodDays?: number;
  focus?: string | null;
  maxItems?: number;
} = {}): Promise<MarketBriefOutput> {
  const state = loadPlaybookState();
  const periodDays = options.periodDays ?? 14;
  const maxItems = options.maxItems ?? 20;

  const docs = await retrieveForAgent("market_brief", {
    periodDays,
    query: options.focus ?? null,
    maxEnrich: 0,
  });

  const ranked = await rankForAgent("market_brief", docs);
  const scored = ranked
    .filter((doc) => !isMarketBriefNoise(doc) && !isLowSignalMarketDoc(doc))
    .map((doc) => scoreDoc(doc, state))
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, maxItems);
  const executive = selected.slice(0, Math.min(8, selected.length)).map((x) => toDelta(x, state));
  const watchItems = selected.slice(Math.min(8, selected.length), Math.min(14, selected.length)).map((x) => toDelta(x, state));
  const invalidations = selected.filter((x) => x.contradiction).map((x) => x.doc.title).slice(0, 8);
  const noisySuppressed = scored.slice(maxItems).map((x) => x.doc.title).slice(0, 12);

  return postProcessMarketBriefOutput({
    brief_date: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    playbook_confidence_flags: state.confidence_flags,
    executive_delta: executive,
    watch_items: watchItems,
    invalidations_to_monitor: invalidations,
    noisy_items_suppressed: noisySuppressed,
  });
}
