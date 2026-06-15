import {
  retrieveForAgent,
  type AgentRetrievalTrace,
  type RetrievedDoc,
} from "../pipeline/agentRetrieval";
import { rankForAgent, type AgentRankedDoc } from "../pipeline/agentRank";
import { loadPlaybookState, type PlaybookState } from "./playbook-state";
import { classifySourceTypeByDomain, getDomainFromUrl } from "../../config/competitor-intel";
import {
  classifySourcegraphIntegrationOpportunity,
  type IntegrationOpportunityLevel,
} from "./sourcegraph-integration-opportunity";
import { AgentScoringDebugger } from "./agent-scoring-debug";
import { withLangSmithTraceable } from "../langsmith";
import {
  createEmptyRankingTrace,
  CURATOR_TRACE_SCHEMA_VERSION,
  rankingTraceToSteps,
  retrievalTraceToSteps,
  type AgentRankingTrace,
  type CuratorTraceStep,
} from "../retrieval/curator-trace";
import { AGENT_PAYLOAD_SCHEMA_VERSION } from "./payload-schema";

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
  /** Persisted-payload schema version (bd-225). See `payload-schema.ts`. */
  schemaVersion: typeof AGENT_PAYLOAD_SCHEMA_VERSION;
  brief_date: string;
  playbook_version: string;
  /** When set, rendered as "Period: last N days" in the report body. */
  periodDays?: number;
  playbook_confidence_flags?: Record<string, "high" | "medium" | "low">;
  /** Optional pipeline trace for debugging/evals. */
  pipeline_trace?: MarketBriefPipelineTrace;
  executive_delta: MarketBriefDelta[];
  watch_items: MarketBriefDelta[];
  invalidations_to_monitor: string[];
  noisy_items_suppressed: string[];
}

export interface MarketBriefPipelineTrace {
  schemaVersion: typeof CURATOR_TRACE_SCHEMA_VERSION;
  focus?: string | null;
  retrieval: AgentRetrievalTrace;
  ranking: AgentRankingTrace;
  selection: {
    maxItems: number;
    scored_count: number;
    selected_count: number;
    executive_count: number;
    watch_count: number;
    invalidation_count: number;
    noisy_suppressed_count: number;
  };
  interpretable_steps?: CuratorTraceStep[];
}

export type MarketDocType = "product_move" | "landscape_research" | "infra_background" | "tutorial_best_practices" | "unknown";

interface ScoredDoc {
  doc: AgentRankedDoc;
  docType: MarketDocType;
  score: number;
  contradiction: boolean;
  segmentImpact: string[];
  personaImpact: string[];
  policyBasis: string[];
  evidenceSignalScore: number;
  productRelevanceScore: number;
  landscapeScore: number;
}

function createEmptyAgentRetrievalTrace(periodDays: number): AgentRetrievalTrace {
  const cutoffMs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  return {
    goal: "market_brief",
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

/** Domains that are off-topic for GTM market brief (general news, finance news, lifestyle, health, local/breaking). */
const OFF_TOPIC_MARKET_DOMAINS = new Set([
  "morningstar.com",
  "cnn.com",
  "eff.org",
  "bolde.com",
  "medicalxpress.com",
  "xcancel.com",
  "x.com",
  "quantamagazine.org",
  "mysanantonio.com",
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
  const tradingRelevant =
    text.includes("capital market") ||
    (text.includes("trading") &&
      !/\b(insider\s+trading|prediction[- ]?market|betting|bet\s+on)\b/i.test(text));
  if (text.includes(beachhead) || tradingRelevant) {
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

/** Title/snippet patterns that are off-topic for GTM market brief (not developer tools / code intelligence). */
const OFF_TOPIC_MARKET_PATTERNS = [
  /\binsider\s+trading\b/i,
  /\bprediction[- ]?market\s+bet/i,
  /\bdeceived\s+congress\b/i,
  /\bsurveillance\s+powers\b/i,
  /\biran\s+(conflict|strike|attack|war)\b/i,
  /\b(elementary|girls?)\s+school\s+hit\b/i,
  /\bquantum\s+mechanics\s+(beginning|mysteries)\b/i,
  /\bpsychology.*(friend|close friend|independence)\b/i,
  /\bfear\s+of\s+failure\b/i,
  /\bmemories\s+can\s+reduce\s+fear\b/i,
  /\bai\s+twitter\s+needs\s+this\s+guy\b/i,
  /\bregistrarse\s+en\s+www\.binance\b/i,
  // Autonomous-vehicle / local incident news (not dev tools or code intelligence)
  /\bblocking\s+ambulance\b/i,
  /\bwaymo\b.*\b(blocking|ambulance|incident|accident|shooting)\b/i,
  /\b(autonomous\s+vehicle|self-driving)\s+.*\b(blocking|ambulance|incident)\b/i,
];

function isMarketBriefNoise(doc: AgentRankedDoc): boolean {
  const text = textOf(doc);
  const domain = getDomainFromUrl(doc.url ?? "");
  const sourceType = classifySourceTypeByDomain(domain);
  if (sourceType === "community") return true;
  if (MARKET_TRACKING_DOMAINS.has(domain)) return true;
  if (LOW_SIGNAL_MARKET_DOMAINS.has(domain)) return true;
  if (OFF_TOPIC_MARKET_DOMAINS.has(domain)) return true;
  if (/(reddit\.com|dev\.to|podcasters\.spotify\.com)/.test(domain)) return true;
  if (OFF_TOPIC_MARKET_PATTERNS.some((re) => re.test(text))) return true;
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
    /(code review|documentation|onboarding|vulnerability|remediation|batch changes|monitoring|observability)/.test(text),
  ];
  const hits = signals.filter(Boolean).length;
  return hits / signals.length;
}

/** Classify document type for market brief scoring. */
function classifyMarketDocType(text: string): MarketDocType {
  // Product moves: launches, GA, pricing, roadmap, partnerships, migrations
  const isProductMove = /(launch|release|\bga\b|generally available|pricing|roadmap|product plan|new|ga|feature release|announces|unveiled|partner(ship)?|partner announced|migration|critical vulnerability|security patch)/.test(
    text
  );
  
  // Landscape research: industry trends, capability analyses, adoption studies, benchmarks
  const isLandscape = /(industry|trend|research|study|analysis|benchmark|survey|report|landscape|adoption|growth|state of|insights?|how organizations|companies|developers|report|capability analysis)/.test(
    text
  );
  
  // Infra background: infrastructure engineering, internal platform posts
  const isInfra = /(uber\.com|meta\.com|internal|infrastructure|platform|scaling|deployment|monorepo|monolithic)/.test(
    text
  );
  
  // Tutorial/best practices: how-to, guides, walkthroughs
  const isTutorial = /\b(best practices?|how to|tutorial|guide|checklist|tips|walkthrough|step.by.step)/.test(
    text
  );

  if (isProductMove) return "product_move";
  if (isLandscape) return "landscape_research";
  if (isInfra) return "infra_background";
  if (isTutorial) return "tutorial_best_practices";
  return "unknown";
}

/**
 * Executive Delta should focus on hard GTM signals: launches, pricing, benchmarks,
 * roadmap/category moves, or clear playbook contradictions, plus key landscape research.
 * Educational/how-to content is better suited to Watch Items unless it is the only signal available.
 */
function isStrongExecutiveDelta(item: ScoredDoc): boolean {
  const text = textOf(item.doc);
  const isBestPractices = /\b(best practices?|how to|tutorial|guide|checklist|tips)\b/i.test(text);

  if (item.contradiction) return true;
  if (isBestPractices) return false;
  
  // For month windows, include both product moves (high evidence) and strong landscape signals
  return (
    item.docType === "product_move" ||
    (item.docType === "landscape_research" && item.landscapeScore >= 0.7)
  ) && item.evidenceSignalScore >= 0.55;
}

/**
 * True iff the doc is clearly about our GTM domain: developer tools, code intelligence,
 * enterprise dev, or known competitors. Excludes general news, local news, and off-topic
 * stories that have no relevance to positioning or product.
 */
function hasMinimumGTMRelevance(doc: AgentRankedDoc): boolean {
  const text = textOf(doc);
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
  const evidenceSignals = evidenceSignalScoreFromText(text) >= 0.5;
  return competitive || enterprise || messageImpact || controlPlane || evidenceSignals;
}

function scoreDoc(doc: AgentRankedDoc, state: PlaybookState): ScoredDoc {
  const text = textOf(doc);
  const docType = classifyMarketDocType(text);
  const segmentImpact = segmentImpactFromText(text, state);
  const personaImpact = personaImpactFromText(text);

  // Weight by product-relevant tech and positioning only; no ICP/beachhead boost (reduces noise).
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

  // Landscape research: industry trends, capabilities, adoption studies, benchmarks
  const landscapeScore = docType === "landscape_research" ? Math.min(1, 0.5 + evidenceSignalScore * 0.5) : 0;
  
  // Product relevance: product moves + competitive threats
  const productRelevanceScore = docType === "product_move" 
    ? Math.min(1, 0.6 + (contradiction ? 0.3 : 0) + evidenceSignalScore * 0.1)
    : 0.3;

  const contradiction_bonus = contradiction ? 0.35 : 0;

  const score =
    0.22 * competitive_risk_score +
    0.2 * enterprise_relevance_score +
    0.28 * message_impact_score +
    0.18 * actionability_score +
    0.08 * Math.min(1, doc.agentScore) +
    0.12 * evidenceSignalScore +
    contradiction_bonus;

  const policyBasis: string[] = [];
  if (enterprise_relevance_score > 0.8) policyBasis.push("enterprise_requirements_priority");
  if (message_impact_score > 0.8) policyBasis.push("context_layer_message_priority");
  if (contradiction) policyBasis.push("playbook_contradiction_bonus");
  if (landscapeScore > 0.6) policyBasis.push("landscape_research_priority");

  return { 
    doc, 
    docType,
    score, 
    contradiction, 
    segmentImpact, 
    personaImpact, 
    policyBasis, 
    evidenceSignalScore,
    productRelevanceScore,
    landscapeScore
  };
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

    const integrationPlay =
      delta.sourcegraph_integration_play.length > 0
        ? delta.sourcegraph_integration_play
        : classifySourcegraphIntegrationOpportunity({
            title: delta.title,
            summary: delta.summary,
            content: delta.why_it_matters,
          }).sourcegraph_integration_play;

    return {
      ...delta,
      summary: stripBoilerplateNoise(delta.summary).slice(0, 320),
      sourcegraph_integration_play: integrationPlay,
      evidence,
    };
  };

  return {
    ...payload,
    executive_delta: payload.executive_delta.map(cleanDelta).filter((d): d is MarketBriefDelta => d !== null),
    watch_items: payload.watch_items.map(cleanDelta).filter((d): d is MarketBriefDelta => d !== null),
  };
}

async function generateMarketBriefImpl(options: {
  periodDays?: number;
  focus?: string | null;
  maxItems?: number;
  debug?: boolean;
  /** Test/eval hook: bypass live retrieval and use a fixed doc corpus. */
  retrievalOverride?: RetrievedDoc[];
  /** When true, include pipeline trace with retrieval/ranking/selection diagnostics. */
  pipelineTrace?: boolean;
} = {}): Promise<MarketBriefOutput> {
  const state = loadPlaybookState();
  const periodDays = options.periodDays ?? 14;
  const maxItems = options.maxItems ?? 20;
  const debugLog = options.debug ? new AgentScoringDebugger("market_brief", periodDays) : null;
  const pipelineTraceEnabled = options.pipelineTrace === true;
  const retrievalTrace = pipelineTraceEnabled ? createEmptyAgentRetrievalTrace(periodDays) : null;

  const docs =
    options.retrievalOverride ??
    await retrieveForAgent("market_brief", {
      periodDays,
      query: options.focus ?? null,
      maxEnrich: 0,
      trace: retrievalTrace,
    });

  const rankingTrace = pipelineTraceEnabled ? createEmptyRankingTrace("market_brief", 25) : null;
  const ranked = await rankForAgent(
    "market_brief",
    docs,
    rankingTrace ? { rankingTrace, rankingSampleSize: 25 } : undefined,
  );
  const scored = ranked
    .filter((doc) => !isMarketBriefNoise(doc) && !isLowSignalMarketDoc(doc))
    .filter((doc) => hasMinimumGTMRelevance(doc))
    .map((doc) => scoreDoc(doc, state))
    .sort((a, b) => b.score - a.score);

  const selected = scored.slice(0, maxItems);
  const strong = selected.filter((x) => isStrongExecutiveDelta(x));
  const weak = selected.filter((x) => !isStrongExecutiveDelta(x));

  let executiveDocs = (strong.length > 0 ? strong : selected).slice(
    0,
    Math.min(8, selected.length),
  );

  // For longer windows (e.g. month), ensure we surface multiple deltas when we have candidates.
  // Target: 3-5 items mixing product_move and landscape_research
  if (periodDays > 14) {
    const productMoves = executiveDocs.filter((x) => x.docType === "product_move");
    const landscapes = executiveDocs.filter((x) => x.docType === "landscape_research");
    
    // If we have fewer than 3 exec items, try to promote more (prioritize diversity)
    if (executiveDocs.length < 3 && selected.length >= 3) {
      const needed = Math.min(3, selected.length - executiveDocs.length);
      const already = new Set(executiveDocs.map((x) => x.doc.id));
      const promotionPool = weak.filter((x) => !already.has(x.doc.id));
      executiveDocs = executiveDocs.concat(promotionPool.slice(0, needed));
    }
    
    // If we have 3+ items, try to balance product_move vs landscape_research
    if (executiveDocs.length >= 3 && productMoves.length > 0 && landscapes.length === 0) {
      const extraPool = weak.filter(
        (x) => !new Set(executiveDocs.map((e) => e.doc.id)).has(x.doc.id) &&
        x.docType === "landscape_research"
      );
      if (extraPool.length > 0) {
        // Replace a weaker item with a landscape signal
        executiveDocs = executiveDocs
          .slice(0, -1)
          .concat(extraPool.slice(0, 1));
      }
    }
  }

  const executiveIds = new Set(executiveDocs.map((x) => x.doc.id));
  const watchDocs = selected
    .filter((x) => !executiveIds.has(x.doc.id))
    .slice(0, Math.min(6, selected.length));

  // Debug logging
  if (debugLog) {
    for (const item of selected) {
      const url = item.doc.url ?? "";
      const domain = getDomainFromUrl(url);
      let fate: "executive" | "watch" | "idea_seed" | "dropped" = "dropped";
      if (executiveIds.has(item.doc.id)) {
        fate = "executive";
      } else if (watchDocs.some((x) => x.doc.id === item.doc.id)) {
        fate = "watch";
      }

      debugLog.log({
        goal: "market_brief",
        docId: item.doc.id ?? "unknown",
        url,
        domain,
        title: item.doc.title,
        type: item.docType,
        componentScores: {
          baseScore: item.doc.baseScore,
          agentScore: item.doc.agentScore,
          evidenceSignal: item.evidenceSignalScore,
          productRelevance: item.productRelevanceScore,
          landscape: item.landscapeScore,
        },
        finalScore: item.score,
        fate,
        flags: item.policyBasis,
      });
    }
    debugLog.flush();
  }

  const executive = executiveDocs.map((x) => toDelta(x, state));
  const watchItems = watchDocs.map((x) => toDelta(x, state));
  const invalidations = selected.filter((x) => x.contradiction).map((x) => x.doc.title).slice(0, 8);
  const noisySuppressed = scored.slice(maxItems).map((x) => x.doc.title).slice(0, 12);
  let pipelineTracePayload: MarketBriefPipelineTrace | undefined;
  if (pipelineTraceEnabled && retrievalTrace && rankingTrace) {
    pipelineTracePayload = {
      schemaVersion: CURATOR_TRACE_SCHEMA_VERSION,
      focus: options.focus ?? null,
      retrieval: retrievalTrace,
      ranking: rankingTrace,
      selection: {
        maxItems,
        scored_count: scored.length,
        selected_count: selected.length,
        executive_count: executive.length,
        watch_count: watchItems.length,
        invalidation_count: invalidations.length,
        noisy_suppressed_count: noisySuppressed.length,
      },
      interpretable_steps: [
        ...retrievalTraceToSteps(retrievalTrace),
        ...rankingTraceToSteps(rankingTrace),
        {
          id: "market_brief_selection",
          label: "Selection",
          detail: `scored ${scored.length} · selected ${selected.length} · executive ${executive.length} · watch ${watchItems.length}`,
          metrics: {
            scored: scored.length,
            selected: selected.length,
            executive: executive.length,
            watch: watchItems.length,
          },
        },
      ],
    };
  }

  return postProcessMarketBriefOutput({
    schemaVersion: AGENT_PAYLOAD_SCHEMA_VERSION,
    brief_date: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    periodDays,
    playbook_confidence_flags: state.confidence_flags,
    ...(pipelineTracePayload ? { pipeline_trace: pipelineTracePayload } : {}),
    executive_delta: executive,
    watch_items: watchItems,
    invalidations_to_monitor: invalidations,
    noisy_items_suppressed: noisySuppressed,
  });
}

export const generateMarketBrief = withLangSmithTraceable(generateMarketBriefImpl, {
  name: "generate_market_brief",
  run_type: "chain",
  defaultProjectName: "code-intel-digest-agents",
  processInputs: (inputs) => {
    const [options] = "args" in inputs ? inputs.args : [undefined];
    return {
      periodDays: options?.periodDays ?? null,
      focus: options?.focus ?? null,
      maxItems: options?.maxItems ?? null,
      pipelineTrace: options?.pipelineTrace === true,
      hasRetrievalOverride: Array.isArray(options?.retrievalOverride),
      debug: options?.debug === true,
    };
  },
  processOutputs: (outputs) => ({
    brief_date:
      outputs && typeof outputs === "object" && "brief_date" in outputs ? outputs.brief_date : null,
    executiveDeltaCount:
      outputs && typeof outputs === "object" && "executive_delta" in outputs && Array.isArray(outputs.executive_delta)
        ? outputs.executive_delta.length
        : 0,
    watchCount:
      outputs && typeof outputs === "object" && "watch_items" in outputs && Array.isArray(outputs.watch_items)
        ? outputs.watch_items.length
        : 0,
    pipelineTrace:
      outputs && typeof outputs === "object" && "pipeline_trace" in outputs
        ? Boolean(outputs.pipeline_trace)
        : false,
  }),
});
