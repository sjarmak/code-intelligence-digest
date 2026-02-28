import { retrieveForAgent } from "../pipeline/agentRetrieval";
import { rankForAgent, type AgentRankedDoc } from "../pipeline/agentRank";
import { loadPlaybookState, type PlaybookState } from "./playbook-state";
import { classifySourceTypeByDomain, getDomainFromUrl } from "../../config/competitor-intel";

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
}

function textOf(doc: AgentRankedDoc): string {
  return `${doc.title} ${doc.snippet ?? ""} ${doc.content ?? ""}`.toLowerCase();
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

function isMarketBriefNoise(doc: AgentRankedDoc): boolean {
  const text = textOf(doc);
  const domain = getDomainFromUrl(doc.url ?? "");
  const sourceType = classifySourceTypeByDomain(domain);
  if (sourceType === "community") return true;
  if (/(reddit\.com|dev\.to|podcasters\.spotify\.com)/.test(domain)) return true;
  if (/(best .* ai coding tools|top .* ai coding tools|tested\s*&\s*compared|awesome-monorepo|staff cuts the new ai normal)/.test(text)) {
    return true;
  }
  if (/(vibe coding is fun until|dev community)/.test(text)) return true;
  return false;
}

function ownerFromDoc(text: string): "PMM" | "Sales" | "SE" | "Product" | "Exec" {
  if (/(compliance|security|byok|self-hosted|audit)/.test(text)) return "SE";
  if (/(pricing|packaging|procurement|enterprise plan)/.test(text)) return "Sales";
  if (/(launch|ga|feature|integration|api|mcp)/.test(text)) return "Product";
  if (/(positioning|narrative|message|category)/.test(text)) return "PMM";
  return "Exec";
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

  const contradiction =
    /(replace github|replace copilot|ai assistant replacement|assistant platform)/.test(text) ||
    ((/cursor|copilot/.test(text) && /(directly competes|replacement for|beats)/.test(text)));

  const contradiction_bonus = contradiction ? 0.35 : 0;

  const score =
    0.22 * segment_priority_score +
    0.14 * persona_priority_score +
    0.18 * competitive_risk_score +
    0.16 * enterprise_relevance_score +
    0.15 * message_impact_score +
    0.1 * actionability_score +
    0.05 * Math.min(1, doc.agentScore) +
    contradiction_bonus;

  const policyBasis: string[] = [];
  if (segmentImpact.includes(state.primary_beachhead)) policyBasis.push(`beachhead:${state.primary_beachhead}`);
  if (segmentImpact.some((s) => state.adjacent_segments.includes(s))) policyBasis.push("adjacent_finserv_corridor");
  if (enterprise_relevance_score > 0.8) policyBasis.push("enterprise_requirements_priority");
  if (message_impact_score > 0.8) policyBasis.push("context_layer_message_priority");
  if (contradiction) policyBasis.push("playbook_contradiction_bonus");

  return { doc, score, contradiction, segmentImpact, personaImpact, policyBasis };
}

function toDelta(item: ScoredDoc, state: PlaybookState): MarketBriefDelta {
  const text = textOf(item.doc);
  const alignment: "reinforces" | "threatens" | "unknown" =
    item.contradiction
      ? "threatens"
      : item.score >= 0.72 && item.policyBasis.length >= 2
        ? "reinforces"
        : "unknown";

  const assumptions: string[] = [];
  if (/(mcp|context layer|repo context)/.test(text)) assumptions.push("MCP complements assistants");
  if (/(compliance|security|byok|self-hosted|audit)/.test(text)) assumptions.push("FinServ compliance lead");
  if (item.contradiction) assumptions.push("Guardrail assumptions may be invalidated");

  const evidenceUrl = item.doc.url ?? "";
  const evidenceSource = getDomainFromUrl(evidenceUrl) || "internal";

  return {
    title: item.doc.title,
    summary: (item.doc.snippet ?? item.doc.content ?? "").slice(0, 320),
    segment_impact: item.segmentImpact.length > 0 ? item.segmentImpact : ["Other"],
    persona_impact: item.personaImpact.length > 0 ? item.personaImpact : [state.persona_priority[0] ?? "Head of Developer Platform"],
    playbook_alignment: alignment,
    affected_assumptions: assumptions.length > 0 ? assumptions : ["Segment and messaging priority remain directionally valid"],
    why_it_matters:
      alignment === "threatens"
        ? "This development may invalidate a current GTM assumption and should be reviewed quickly to avoid messaging or deal-risk drift."
        : "This development affects current segment, buyer, or enterprise-positioning decisions and should be incorporated into near-term GTM motion.",
    policy_basis: item.policyBasis,
    evidence_basis: [item.doc.title],
    recommended_action: {
      owner: ownerFromDoc(text),
      action:
        alignment === "threatens"
          ? "Review playbook assumptions and update battlecard/messaging guidance within 48 hours."
          : "Incorporate this signal into active messaging, qualification, and campaign planning this week.",
    },
    evidence: [
      {
        source: evidenceSource,
        url: evidenceUrl,
        date: item.doc.publishedAt ? item.doc.publishedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
        confidence: confidenceFromDoc(item.doc),
      },
    ],
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
    .filter((doc) => !isMarketBriefNoise(doc))
    .map((doc) => scoreDoc(doc, state))
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, maxItems);
  const executive = selected.slice(0, Math.min(8, selected.length)).map((x) => toDelta(x, state));
  const watchItems = selected.slice(Math.min(8, selected.length), Math.min(14, selected.length)).map((x) => toDelta(x, state));
  const invalidations = selected.filter((x) => x.contradiction).map((x) => x.doc.title).slice(0, 8);
  const noisySuppressed = scored.slice(maxItems).map((x) => x.doc.title).slice(0, 12);

  return {
    brief_date: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    playbook_confidence_flags: state.confidence_flags,
    executive_delta: executive,
    watch_items: watchItems,
    invalidations_to_monitor: invalidations,
    noisy_items_suppressed: noisySuppressed,
  };
}
