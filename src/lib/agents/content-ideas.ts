import { retrieveForAgent } from "../pipeline/agentRetrieval";
import { rankForAgent, type AgentRankedDoc } from "../pipeline/agentRank";
import { loadPlaybookState, type PlaybookState } from "./playbook-state";
import { classifySourceTypeByDomain, getDomainFromUrl as getDomainFromUrlCompetitor } from "../../config/competitor-intel";
import {
  classifySourcegraphIntegrationOpportunity,
  type IntegrationOpportunityLevel,
} from "./sourcegraph-integration-opportunity";
import { AgentScoringDebugger } from "./agent-scoring-debug";

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
  channel: "whitepaper" | "webinar" | "event_talk" | "blog" | "SEO_page" | "case_study" | "email_sequence" | "sales_one_pager";
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
  };
  ideas: ContentIdea[];
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

interface PlannedIdea {
  candidate: ScoredIdeaCandidate;
  targetSegment: ContentIdea["target_segment"];
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

/**
 * True iff the doc is clearly relevant to GTM content ideas: developer tools, code intelligence,
 * enterprise dev, competitors, or control plane. Excludes web-search noise that has no real
 * relevance to our positioning or product.
 */
function hasMinimumContentIdeasRelevance(doc: AgentRankedDoc): boolean {
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
  const evidenceStyle =
    /(launch|release|\bga\b|pricing|customer|case study|benchmark|coding assistant|developer platform)/.test(
      text,
    );
  return competitive || enterprise || messageImpact || controlPlane || evidenceStyle;
}

const NOISY_DOMAINS = new Set([
  "xcancel.com",
  "twitter.com",
  "x.com",
  "click.kit-mail3.com",
  "click.kit-mail.com",
  "link.mail.beehiiv.com",
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

function isGenericIdeaPage(url: string): boolean {
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
  if (/(batch changes|codemod|migration|remediation)/.test(text)) {
    return "Cross-Repo Remediation and Migration";
  }
  if (/(mcp|model context protocol|context layer|repo context)/.test(text)) {
    return "MCP Context Layer for Enterprise Codebases";
  }
  if (/(compliance|audit|byok|self-hosted|self hosted|security)/.test(text)) {
    return "Secure and Compliant AI Coding Workflows";
  }
  if (/(onboarding|knowledge transfer|legacy|complex codebase|monorepo|multi-repo)/.test(text)) {
    return "Developer Onboarding in Large Codebases";
  }
  if (/(deep search|code search|semantic search|cross-repo search)/.test(text)) {
    return "Cross-Repo Code Search and Deep Code Understanding";
  }
  return "Enterprise Code Intelligence for Modern Development Teams";
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

function buildSourcegraphIdeaTitle(
  _segment: ContentIdea["target_segment"],
  channel: ContentIdea["channel"],
  text: string,
): string {
  const frame = detectTopicFrame(text);

  const channelVerb: Record<ContentIdea["channel"], string> = {
    whitepaper: "Guide",
    webinar: "Webinar",
    event_talk: "Talk Track",
    blog: "Brief",
    SEO_page: "Playbook",
    case_study: "Case Study",
    email_sequence: "Email Series",
    sales_one_pager: "One-Pager",
  };

  return `${channelVerb[channel]}: ${frame}`.slice(0, 120);
}

function buildSourcegraphThesis(
  segment: ContentIdea["target_segment"],
  persona: ContentIdea["target_persona"],
  text: string,
): string {
  const frame = detectTopicFrame(text);
  const segmentContext =
    segment === "Other"
      ? "platform and engineering teams"
      : `${segment} and adjacent regulated-industry teams`;
  return `Show ${segmentContext} ${persona} buyers how Sourcegraph strengthens ${frame.toLowerCase()} while complementing existing coding assistants.`;
}

function buildKeyInsights(
  segment: ContentIdea["target_segment"],
  persona: ContentIdea["target_persona"],
  text: string,
): string[] {
  const frame = detectTopicFrame(text);
  return [
    `${segment === "Other" ? "Enterprise platform teams" : segment} ${persona} buyers need reliable cross-repo context, not another assistant surface.`,
    `Sourcegraph’s differentiation in ${frame.toLowerCase()} should be framed as complementary to Cursor/Copilot/Claude Code.`,
    "GTM motion should emphasize enterprise controls (compliance, BYOK/self-hosted, auditability) with concrete operational examples.",
  ];
}

function buildContentOutline(
  segment: ContentIdea["target_segment"],
  persona: ContentIdea["target_persona"],
  channel: ContentIdea["channel"],
  text: string,
): string[] {
  const frame = detectTopicFrame(text);
  const channelLabelMap: Record<ContentIdea["channel"], string> = {
    event_talk: "talk",
    webinar: "webinar",
    whitepaper: "whitepaper",
    blog: "blog",
    SEO_page: "SEO page",
    case_study: "case study",
    email_sequence: "email sequence",
    sales_one_pager: "sales one-pager",
  };
  const channelLabel = channelLabelMap[channel];
  return [
    `Context: why ${segment === "Other" ? "platform teams" : segment} teams care about ${frame.toLowerCase()} now`,
    `Problem framing for ${persona}: limits of assistant-only workflows in large, complex codebases`,
    "Sourcegraph POV: context layer + cross-repo search + deep understanding + safe bulk change",
    "Proof section: product evidence + customer signal + external market trigger",
    `CTA for ${channelLabel}: convert to a scoped next step (buyer workshop, follow-up meeting, or technical validation).`,
  ];
}

function buildDistributionPlan(
  channel: ContentIdea["channel"],
  text: string,
): ContentIdea["distribution_plan"] {
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
  if (/(security|compliance|audit|byok|self-hosted|self hosted)/.test(text)) return "Security/Compliance";
  if (/(platform team|developer platform|platform engineering)/.test(text)) return "Head of Developer Platform";
  if (/(vp engineering|cto|engineering leader)/.test(text)) return "VP Engineering";
  return "Staff Engineer";
}

function detectChannel(text: string, state: PlaybookState): ContentIdea["channel"] {
  void state;
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
  return /(launch|release|\bga\b|pricing|customer|case study|benchmark|docs|documentation|security|compliance|audit|byok|self-hosted|report)/.test(
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
  if (/(compliance|security|audit|byok|self-hosted)/.test(text)) {
    return "Sourcegraph provides the control layer for AI coding workflows in regulated, enterprise environments.";
  }
  if (/(migration|remediation|codemod|batch changes)/.test(text)) {
    return "Sourcegraph turns large-scale code change work into a controlled, cross-repo workflow with verification loops.";
  }
  if (/(mcp|context layer|repo context)/.test(text)) {
    return "Sourcegraph acts as the repo context layer that makes existing assistants more reliable across complex codebases.";
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

function scoreCandidate(doc: AgentRankedDoc, state: PlaybookState): ScoredIdeaCandidate {
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
    seedType === "research_report" ? 0.95 :
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
  const source_quality_score = sourceType === "primary" ? 1 : sourceType === "secondary" ? 0.7 : sourceType === "internal_curated" ? 0.85 : 0.35;
  
  // Penalties
  const noisy_domain_penalty = isNoisyDomain(domain) ? 0.3 : 0;

  // Rebalanced scoring: prioritize content seed value over pure GTM intensity
  const contentSeedScore =
    0.15 * seedFormatScore +        // Format quality (case study > blog > newsletter > other)
    0.15 * channel_efficiency_score +  // Channel fit
    0.12 * proof_feasibility_score +   // Evidence availability
    0.35 * message_fit_score +         // Message fit
    0.08 * timeliness_score +          // Recency boost (lighter weight for month)
    0.05 * source_quality_score -      // Source quality (light weight)
    noisy_domain_penalty;

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
  const title = buildSourcegraphIdeaTitle(targetSegment, candidate.channel, text);
  const thesis = buildSourcegraphThesis(targetSegment, candidate.persona, text);
  const keyInsights = buildKeyInsights(targetSegment, candidate.persona, text);
  const contentOutline = buildContentOutline(targetSegment, candidate.persona, candidate.channel, text);
  const distributionPlan = buildDistributionPlan(candidate.channel, text);

  return {
    title,
    thesis: stripBoilerplateNoise(thesis),
    target_segment: targetSegment,
    target_persona: candidate.persona,
    funnel_stage: funnel,
    channel: candidate.channel,
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
    sourcegraph_integration_play: integration.sourcegraph_integration_play,
    distribution_plan: distributionPlan,
    priority_score: Number(candidate.score.toFixed(3)),
  };
}

export function postProcessContentIdeasOutput(payload: ContentIdeasOutput): ContentIdeasOutput {
  const ideas = payload.ideas
    .map((idea) => {
      const sources = idea.sources
        .map((s) => ({ ...s, url: canonicalizeUrl(s.url) }))
        .filter((s) => !!s.url && !isGenericIdeaPage(s.url) && !isNoisyDomain(sourceFromUrl(s.url)));
      if (sources.length === 0) return null;
      return {
        ...idea,
        title: stripBoilerplateNoise(idea.title),
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

  return {
    ...payload,
    ideas,
  };
}

/** Synthetic doc ID for injected market brief context (not a real URL). */
const MARKET_BRIEF_CONTEXT_ID = "internal://market-brief-highlights";

export async function generateContentIdeas(options: {
  periodDays?: number;
  focus?: string | null;
  numIdeas?: number;
  /** When provided, market brief findings are injected as context so content ideas are informed by the same research. */
  marketBriefSummary?: string | null;
  debug?: boolean;
} = {}): Promise<ContentIdeasOutput> {
  const state = loadPlaybookState();
  const periodDays = options.periodDays ?? 30;
  const numIdeas = options.numIdeas ?? 10;
  const debugLog = options.debug ? new AgentScoringDebugger("content_ideas", periodDays) : null;

  const docs = await retrieveForAgent("content_ideas", {
    periodDays,
    query: options.focus ?? null,
    maxEnrich: 0,
  });

  // If market brief summary was passed (e.g. when run after market brief), inject it so findings inform ideas
  const docsWithBrief =
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
          ...docs,
        ]
      : docs;

  // Broaden the research pool: include sources used for market brief and competitor intel
  // so content ideas can synthesize from the same landscape and competitive evidence.
  const marketDocs = await retrieveForAgent("market_brief", {
    periodDays,
    maxEnrich: 0,
  });
  const competitorDocs = await retrieveForAgent("competitor_intel", {
    periodDays,
    maxEnrich: 0,
  });

  const existingIds = new Set(
    docsWithBrief.map((d) => d.id).filter((id): id is string => !!id),
  );
  const existingUrls = new Set(
    docsWithBrief.map((d) => canonicalizeUrl(d.url)).filter((u) => !!u),
  );

  const extraDocsRaw = [...marketDocs, ...competitorDocs];
  const extraDocs = extraDocsRaw.filter((d) => {
    if (d.id && existingIds.has(d.id)) return false;
    const url = canonicalizeUrl(d.url);
    if (!url) return false;
    if (existingUrls.has(url)) return false;
    existingUrls.add(url);
    return true;
  });

  const allDocs = [...docsWithBrief, ...extraDocs];

  const ranked = await rankForAgent("content_ideas", allDocs);

  const windowMs = periodDays * 24 * 60 * 60 * 1000;
  const cutoffMs = Date.now() - windowMs;

  const candidates = ranked
    .map((doc) => scoreCandidate(doc, state))
    .filter((c) => {
      if (c.doc.id === MARKET_BRIEF_CONTEXT_ID) return true;
      const text = textOf(c.doc);
      const domain = sourceFromUrl(c.doc.url);
      const sourceType = classifySourceTypeByDomain(domain);
      const canonicalUrl = canonicalizeUrl(c.doc.url);
      const isLongWindow = periodDays > 14;
      if (c.guardrailViolation) return false;
      if (!hasMinimumContentIdeasRelevance(c.doc)) return false;
      if (!canonicalUrl) return false;
      if (isNoisyDomain(domain)) return false;
      if (isGenericIdeaPage(canonicalUrl) && !/(benchmark|case study|customer|ga|release|pricing|security|compliance|enterprise)/.test(text)) {
        return false;
      }
      // For short windows, keep community sources only when they point to concrete GTM/content signals
      if (!isLongWindow && sourceType === "community" && !/(benchmark|case study|customer|ga|release notes)/.test(text)) {
        return false;
      }
      // For short windows, require strong concrete evidence for secondary/community sources.
      if (!isLongWindow && (sourceType === "secondary" || sourceType === "community") && !hasConcreteEvidence(text)) {
        return false;
      }
      // For longer windows (e.g. month), allow a slightly broader set of sources while upstream
      // gates continue to block off-topic or obviously low-signal docs.
      const minScore = periodDays > 14 ? 0.38 : 0.44;
      return c.score >= minScore;
    })
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

  // Select top ideas by score only (product relevance); no ICP/beachhead quotas.
  const selected = candidates.slice(0, numIdeas);

  const planned: PlannedIdea[] = selected.map((candidate) => ({
    candidate,
    targetSegment: normalizeTargetSegment(candidate.segment),
  }));

  const rawIdeas = planned
    .map(({ candidate, targetSegment }) => ({ candidate, idea: toIdea(candidate, state, targetSegment) }))
    .filter(({ candidate, idea }) => {
      const overlap = titleOverlapRatio(idea.title, candidate.doc.title);
      // Similarity guard: reject ideas that are too close to source title phrasing.
      return overlap < 0.65;
    })
    .map(({ idea }) => idea);
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
    // Dedupe by core_claim so we don't surface multiple ideas with the same "Core claim" line.
    const byCoreClaim = new Map<string, ContentIdea>();
    for (const idea of afterTitle) {
      const key = (idea.core_claim ?? "").toLowerCase().replace(/\s+/g, " ").trim().slice(0, 120);
      if (!key) {
        byCoreClaim.set(`title:${normalizeIdeaTitleKey(idea.title)}`, idea);
        continue;
      }
      const existing = byCoreClaim.get(key);
      if (!existing || idea.priority_score > existing.priority_score) {
        byCoreClaim.set(key, idea);
      }
    }
    const deduped = Array.from(byCoreClaim.values()).sort(
      (a, b) => b.priority_score - a.priority_score,
    );

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

    return diversified;
  })();
  const achievedBucketCounts = {
    beachhead: ideas.filter((i) => toSegmentBucket(i.target_segment, state) === "beachhead").length,
    adjacent: ideas.filter((i) => toSegmentBucket(i.target_segment, state) === "adjacent").length,
    broader: ideas.filter((i) => toSegmentBucket(i.target_segment, state) === "broader").length,
    total: ideas.length,
  };
  const achievedMix = achievedBucketCounts.total > 0
    ? {
        beachhead: Number((achievedBucketCounts.beachhead / achievedBucketCounts.total).toFixed(3)),
        adjacent: Number((achievedBucketCounts.adjacent / achievedBucketCounts.total).toFixed(3)),
        broader: Number((achievedBucketCounts.broader / achievedBucketCounts.total).toFixed(3)),
      }
    : { beachhead: 0, adjacent: 0, broader: 0 };
  const achievedSegmentCounts = ideas.reduce<Record<string, number>>((acc, idea) => {
    acc[idea.target_segment] = (acc[idea.target_segment] ?? 0) + 1;
    return acc;
  }, {});

  // Debug logging for final ideas
  if (debugLog) {
    for (const idea of ideas) {
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

  return postProcessContentIdeasOutput({
    generated_at: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    periodDays,
    playbook_confidence_flags: state.confidence_flags,
    selection_debug: {
      target_mix: { beachhead: 0, adjacent: 0, broader: 0 },
      achieved_mix: achievedMix,
      achieved_counts: achievedBucketCounts,
      achieved_segment_counts: achievedSegmentCounts,
    },
    ideas,
  });
}
