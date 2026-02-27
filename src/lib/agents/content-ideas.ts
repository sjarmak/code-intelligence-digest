import { retrieveForAgent } from "../pipeline/agentRetrieval";
import { rankForAgent, type AgentRankedDoc } from "../pipeline/agentRank";
import { loadPlaybookState, type PlaybookState } from "./playbook-state";

export interface ContentIdea {
  title: string;
  thesis: string;
  target_segment: "Capital Markets" | "Banks" | "Diversified Financial Services" | "Insurance" | "Other";
  target_persona: "Head of Developer Platform" | "VP Engineering" | "Staff Engineer" | "Security/Compliance";
  funnel_stage: "awareness" | "validation" | "business_case" | "expansion";
  channel: "whitepaper" | "webinar" | "event_talk" | "blog" | "SEO_page" | "case_study" | "email_sequence" | "sales_one_pager";
  why_now: string;
  playbook_alignment: string[];
  policy_basis: string[];
  evidence_basis: string[];
  core_claim: string;
  proof_required: string[];
  guardrails: string[];
  package: {
    primary_asset: string;
    repurposes: string[];
  };
  success_metric: "pipeline_influence" | "event_registrations" | "organic_traffic" | "meetings_booked" | "late_stage_acceleration";
  priority_score: number;
}

export interface ContentIdeasOutput {
  generated_at: string;
  playbook_version: string;
  playbook_confidence_flags?: Record<string, "high" | "medium" | "low">;
  ideas: ContentIdea[];
}

interface ScoredIdeaCandidate {
  doc: AgentRankedDoc;
  score: number;
  guardrailViolation: boolean;
  segment: ContentIdea["target_segment"];
  persona: ContentIdea["target_persona"];
  channel: ContentIdea["channel"];
  policyBasis: string[];
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
  if (/(security|compliance|audit|byok|self-hosted|self hosted)/.test(text)) return "Security/Compliance";
  if (/(platform team|developer platform|platform engineering)/.test(text)) return "Head of Developer Platform";
  if (/(vp engineering|cto|engineering leader)/.test(text)) return "VP Engineering";
  return "Staff Engineer";
}

function detectChannel(text: string, state: PlaybookState): ContentIdea["channel"] {
  if (/(event|conference|summit|meetup|talk)/.test(text) || state.channel_priority[0]?.toLowerCase().includes("event")) return "event_talk";
  if (/(whitepaper|white paper|guide|analyst)/.test(text) || state.channel_priority.some((c) => c.toLowerCase().includes("whitepaper"))) return "whitepaper";
  if (/(seo|search trend|organic search|keyword)/.test(text)) return "SEO_page";
  if (/(case study|customer story|reference)/.test(text)) return "case_study";
  if (/(webinar)/.test(text)) return "webinar";
  return "blog";
}

function detectGuardrailViolation(text: string): boolean {
  if (/(replace github|replace cursor|replace copilot|beat cursor|beat copilot)/.test(text)) return true;
  if (/(sourcegraph.*ai assistant|ai assistant.*sourcegraph)/.test(text)) return true;
  return false;
}

function scoreCandidate(doc: AgentRankedDoc, state: PlaybookState): ScoredIdeaCandidate {
  const text = textOf(doc);
  const segment = detectSegment(text);
  const persona = detectPersona(text);
  const channel = detectChannel(text, state);
  const guardrailViolation = detectGuardrailViolation(text);

  const segment_priority_score = segment === "Capital Markets" ? 1 : segment === "Other" ? 0.2 : 0.7;
  const channel_efficiency_score = ["event_talk", "whitepaper", "SEO_page", "blog"].includes(channel) ? 0.9 : 0.6;
  const persona_fit_score = ["Head of Developer Platform", "VP Engineering", "Security/Compliance"].includes(persona) ? 0.9 : 0.7;
  const proof_feasibility_score = /(benchmark|customer|case study|release notes|docs|ga)/.test(text) ? 0.9 : 0.5;
  const message_fit_score = /(code search|cross-repo|batch changes|mcp|context layer|compliance|byok|self-hosted)/.test(text) ? 1 : 0.2;
  const timeliness_score = doc.publishedAt ? Math.max(0.2, 1 - ((Date.now() - doc.publishedAt.getTime()) / (1000 * 60 * 60 * 24 * 120))) : 0.5;

  const score =
    0.24 * segment_priority_score +
    0.18 * channel_efficiency_score +
    0.16 * persona_fit_score +
    0.14 * proof_feasibility_score +
    0.2 * message_fit_score +
    0.08 * timeliness_score;

  const policyBasis: string[] = [];
  if (segment === "Capital Markets") policyBasis.push("segment_priority:Capital Markets");
  if (segment !== "Other" && segment !== "Capital Markets") policyBasis.push("segment_priority:adjacent_finserv");
  if (message_fit_score > 0.8) policyBasis.push("message_fit:code_intelligence_context_layer");
  if (channel_efficiency_score > 0.8) policyBasis.push(`channel_priority:${channel}`);

  return {
    doc,
    score,
    guardrailViolation,
    segment,
    persona,
    channel,
    policyBasis,
  };
}

function toIdea(candidate: ScoredIdeaCandidate, state: PlaybookState): ContentIdea {
  const text = textOf(candidate.doc);
  const evidenceUrl = candidate.doc.url ?? "";
  const evidenceSource = evidenceUrl ? new URL(evidenceUrl).hostname.replace(/^www\./, "") : "internal";
  const date = candidate.doc.publishedAt ? candidate.doc.publishedAt.toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10);

  const funnel: ContentIdea["funnel_stage"] =
    /(customer|case study|benchmark)/.test(text)
      ? "business_case"
      : /(pricing|security|compliance)/.test(text)
        ? "validation"
        : /(migration|remediation|onboarding)/.test(text)
          ? "expansion"
          : "awareness";

  const successMetric: ContentIdea["success_metric"] =
    candidate.channel === "event_talk" || candidate.channel === "webinar"
      ? "event_registrations"
      : candidate.channel === "SEO_page"
        ? "organic_traffic"
        : funnel === "business_case"
          ? "late_stage_acceleration"
          : "pipeline_influence";

  const title = `FinServ ${candidate.segment === "Other" ? "Platform" : candidate.segment}: ${candidate.doc.title}`.slice(0, 120);

  return {
    title,
    thesis: "Package this signal into GTM content that reinforces Sourcegraph's context-layer and cross-repo code intelligence position.",
    target_segment: candidate.segment,
    target_persona: candidate.persona,
    funnel_stage: funnel,
    channel: candidate.channel,
    why_now: "A timely external development aligns with active playbook priorities and can be converted into near-term pipeline influence.",
    playbook_alignment: [
      ...candidate.policyBasis,
      ...(state.campaign_themes.slice(0, 2)),
    ],
    policy_basis: candidate.policyBasis,
    evidence_basis: [`${candidate.doc.title} (${evidenceSource}, ${date})`],
    core_claim: "Sourcegraph complements existing assistants by providing enterprise-grade cross-repo context, search, and change management.",
    proof_required: ["product evidence", "external trend", "customer story"],
    guardrails: state.messaging_guardrails,
    package: {
      primary_asset: `${candidate.channel}: ${title}`,
      repurposes: [
        "sales_one_pager",
        "email_sequence",
        "blog",
      ],
    },
    success_metric: successMetric,
    priority_score: Number(candidate.score.toFixed(3)),
  };
}

export async function generateContentIdeas(options: {
  periodDays?: number;
  focus?: string | null;
  numIdeas?: number;
} = {}): Promise<ContentIdeasOutput> {
  const state = loadPlaybookState();
  const periodDays = options.periodDays ?? 30;
  const numIdeas = options.numIdeas ?? 10;

  const docs = await retrieveForAgent("content_ideas", {
    periodDays,
    query: options.focus ?? null,
    maxEnrich: 0,
  });
  const ranked = await rankForAgent("content_ideas", docs);

  const candidates = ranked
    .map((doc) => scoreCandidate(doc, state))
    .filter((c) => !c.guardrailViolation)
    .sort((a, b) => b.score - a.score);

  const ideas = candidates.slice(0, numIdeas).map((c) => toIdea(c, state));

  return {
    generated_at: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    playbook_confidence_flags: state.confidence_flags,
    ideas,
  };
}
