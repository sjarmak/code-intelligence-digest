import { retrieveForAgent } from "../pipeline/agentRetrieval";
import { rankForAgent, type AgentRankedDoc } from "../pipeline/agentRank";
import { loadPlaybookState, type PlaybookState } from "./playbook-state";
import { classifySourceTypeByDomain, getDomainFromUrl } from "../../config/competitor-intel";
import {
  classifySourcegraphIntegrationOpportunity,
  type IntegrationOpportunityLevel,
} from "./sourcegraph-integration-opportunity";

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

interface ScoredIdeaCandidate {
  doc: AgentRankedDoc;
  score: number;
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

const NOISY_DOMAINS = new Set([
  "xcancel.com",
  "twitter.com",
  "x.com",
  "click.kit-mail3.com",
  "click.kit-mail.com",
  "link.mail.beehiiv.com",
]);

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
  const domain = getDomainFromUrl(url);
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
  const domain = sourceFromUrl(doc.url);
  const sourceType = classifySourceTypeByDomain(domain);
  const segment = detectSegment(text);
  const persona = detectPersona(text);
  const channel = detectChannel(text, state);
  const guardrailViolation = detectGuardrailViolation(text);
  const hasGtmSignal = GTM_SIGNAL_TERMS.some((t) => text.includes(t));

  const segment_priority_score = segment === "Capital Markets" ? 0.8 : segment === "Other" ? 0.55 : 0.7;
  const channel_efficiency_score = ["event_talk", "whitepaper", "SEO_page", "blog"].includes(channel) ? 0.9 : 0.6;
  const persona_fit_score = ["Head of Developer Platform", "VP Engineering", "Security/Compliance"].includes(persona) ? 0.9 : 0.7;
  const proof_feasibility_score = /(benchmark|customer|case study|release notes|docs|ga)/.test(text) ? 0.9 : 0.5;
  const message_fit_score = /(code search|cross-repo|batch changes|mcp|context layer|compliance|byok|self-hosted)/.test(text) ? 1 : 0.2;
  const timeliness_score = doc.publishedAt ? Math.max(0.2, 1 - ((Date.now() - doc.publishedAt.getTime()) / (1000 * 60 * 60 * 24 * 120))) : 0.5;
  const source_quality_score =
    sourceType === "primary" ? 1 : sourceType === "secondary" ? 0.7 : sourceType === "internal_curated" ? 0.85 : 0.35;
  const noisy_domain_penalty = isNoisyDomain(domain) ? 0.3 : 0;

  const score =
    0.12 * segment_priority_score +
    0.18 * channel_efficiency_score +
    0.16 * persona_fit_score +
    0.14 * proof_feasibility_score +
    0.32 * message_fit_score +
    0.06 * timeliness_score +
    0.02 * source_quality_score -
    noisy_domain_penalty;

  return {
    doc,
    score,
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
  const integration = classifySourcegraphIntegrationOpportunity({
    title: candidate.doc.title,
    summary: candidate.doc.snippet ?? "",
    content: candidate.doc.content ?? "",
  });
  const evidenceUrl = canonicalizeUrl(candidate.doc.url ?? "");
  const evidenceSource = sourceFromUrl(evidenceUrl);
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
    why_now: "A timely external development aligns with active playbook priorities and can be converted into near-term pipeline influence.",
    playbook_alignment: state.campaign_themes.slice(0, 2),
    sources: evidenceUrl
      ? [{ title: candidate.doc.title, source: evidenceSource, url: evidenceUrl, date }]
      : [],
    core_claim: "Sourcegraph complements existing assistants by providing enterprise-grade cross-repo context, search, and change management.",
    key_insights: keyInsights.map((x) => stripBoilerplateNoise(x)),
    content_outline: contentOutline.map((x) => stripBoilerplateNoise(x)),
    proof_required: ["product evidence", "external trend", "customer story"],
    guardrails: state.messaging_guardrails,
    integration_opportunity: integration.level,
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
    .filter((c) => {
      const text = textOf(c.doc);
      const domain = sourceFromUrl(c.doc.url);
      const sourceType = classifySourceTypeByDomain(domain);
      const hasGtmSignal = GTM_SIGNAL_TERMS.some((t) => text.includes(t));
      const canonicalUrl = canonicalizeUrl(c.doc.url);
      if (c.guardrailViolation) return false;
      if (!hasGtmSignal) return false;
      if (!canonicalUrl) return false;
      if (isNoisyDomain(domain)) return false;
      if (isGenericIdeaPage(canonicalUrl) && !/(benchmark|case study|customer|ga|release|pricing|security|compliance|enterprise)/.test(text)) {
        return false;
      }
      if (sourceType === "community" && !/(benchmark|case study|customer|ga|release notes)/.test(text)) return false;
      if (c.segment === "Other" && !/(capital market|bank|insurance|finserv|regulated)/.test(text) && c.score < 0.72) return false;
      return c.score >= 0.58;
    })
    .sort((a, b) => b.score - a.score);

  // Diversity-aware selection with soft GTM mix guidance (not strict quotas).
  const selected: ScoredIdeaCandidate[] = [];
  const selectedSet = new Set<ScoredIdeaCandidate>();
  const segmentCounts = new Map<string, number>();
  const channelCounts = new Map<string, number>();
  const personaCounts = new Map<string, number>();
  const targetMix = {
    beachhead: 0.4,
    adjacent: 0.35,
    broader: 0.25,
  } as const;

  const maxOther = Math.max(2, Math.ceil(numIdeas * 0.35));
  const maxPerSegment = Math.max(2, Math.ceil(numIdeas * 0.45));
  const maxPerChannel = Math.max(3, Math.ceil(numIdeas * 0.5));
  const maxPerPersona = Math.max(4, Math.ceil(numIdeas * 0.6));

  const tryTake = (candidate: ScoredIdeaCandidate, enforceBucketQuota: boolean): boolean => {
    if (selectedSet.has(candidate)) return false;
    if (selected.length >= numIdeas) return false;

    const seg = candidate.segment;
    const ch = candidate.channel;
    const per = candidate.persona;
    const bucket = toSegmentBucket(seg, state);

    const segCount = segmentCounts.get(seg) ?? 0;
    const chCount = channelCounts.get(ch) ?? 0;
    const perCount = personaCounts.get(per) ?? 0;

    if (enforceBucketQuota && selected.length >= numIdeas) return false;
    if (seg === "Other" && segCount >= maxOther) return false;
    if (segCount >= maxPerSegment) return false;
    if (chCount >= maxPerChannel) return false;
    if (perCount >= maxPerPersona) return false;

    selected.push(candidate);
    selectedSet.add(candidate);
    segmentCounts.set(seg, segCount + 1);
    channelCounts.set(ch, chCount + 1);
    personaCounts.set(per, perCount + 1);
    return true;
  };

  // Pass 1: take top ideas with diversity caps.
  for (const candidate of candidates) {
    if (selected.length >= numIdeas) break;
    tryTake(candidate, true);
  }

  // Backfill if diversity caps were too strict.
  if (selected.length < numIdeas) {
    for (const candidate of candidates) {
      if (selected.length >= numIdeas) break;
      tryTake(candidate, false);
    }
  }

  const planned: PlannedIdea[] = selected.map((candidate) => ({
    candidate,
    targetSegment: normalizeTargetSegment(candidate.segment),
  }));

  // If detected signals are too generic, rebalance targeting toward explicit GTM priorities
  // so output isn't over-biased to "Other".
  const rebalanceBucketMinimums: Record<SegmentBucket, number> = {
    beachhead: numIdeas >= 3 ? 1 : 0,
    adjacent: numIdeas >= 5 ? 1 : 0,
    broader: numIdeas >= 3 ? 1 : 0,
  };
  const adjacentPool = state.adjacent_segments.map((s) => normalizeTargetSegment(s)).filter((s) => s !== "Other");
  let adjacentCursor = 0;
  const bucketCountForPlan = (bucket: SegmentBucket): number =>
    planned.filter((p) => toSegmentBucket(p.targetSegment, state) === bucket).length;
  const indexFromBuckets = (buckets: SegmentBucket[]): number | undefined => {
    for (const bucket of buckets) {
      const idx = planned.findIndex((p) => toSegmentBucket(p.targetSegment, state) === bucket);
      if (idx >= 0) return idx;
    }
    return undefined;
  };

  while (bucketCountForPlan("beachhead") < rebalanceBucketMinimums.beachhead) {
    const idx = indexFromBuckets(["broader", "adjacent"]);
    if (idx == null) break;
    planned[idx].targetSegment = normalizeTargetSegment(state.primary_beachhead);
  }
  while (bucketCountForPlan("adjacent") < rebalanceBucketMinimums.adjacent) {
    const idx = indexFromBuckets(["broader", "beachhead"]);
    if (idx == null) break;
    const seg = adjacentPool[adjacentCursor % Math.max(1, adjacentPool.length)] ?? "Banks";
    adjacentCursor++;
    planned[idx].targetSegment = seg;
  }

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
    const deduped = Array.from(byTitle.values())
      .sort((a, b) => b.priority_score - a.priority_score)
      .slice(0, numIdeas);
    const preferredPersonas: Array<ContentIdea["target_persona"]> = [
      "Head of Developer Platform",
      "VP Engineering",
      "Staff Engineer",
      "Security/Compliance",
    ];
    const personaCount = deduped.reduce<Record<string, number>>((acc, idea) => {
      acc[idea.target_persona] = (acc[idea.target_persona] ?? 0) + 1;
      return acc;
    }, {});
    const hasDiversity = Object.keys(personaCount).length >= 2;
    if (hasDiversity) return deduped;
    return deduped.map((idea, idx) => ({
      ...idea,
      target_persona: preferredPersonas[idx % preferredPersonas.length],
    }));
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

  return postProcessContentIdeasOutput({
    generated_at: new Date().toISOString().slice(0, 10),
    playbook_version: state.playbook_version,
    playbook_confidence_flags: state.confidence_flags,
    selection_debug: {
      target_mix: targetMix,
      achieved_mix: achievedMix,
      achieved_counts: achievedBucketCounts,
      achieved_segment_counts: achievedSegmentCounts,
    },
    ideas,
  });
}
