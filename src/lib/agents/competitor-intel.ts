import type { Category } from "../model";
import { VALID_CATEGORIES } from "../model";
import { getSqlite } from "../db/index";
import { detectDriver, getDbClient } from "../db/driver";
import { dbFullTextSearch } from "../db/search";
import { searchWeb } from "../retrieval/webSearch";
import {
  buildCompetitorQueries,
  classifyOverlapWithSourcegraph,
  classifySourceTypeByDomain,
  getCompetitorIntelEntries,
  getDomainFromUrl,
  type CompetitorIntelEntry,
  type IntelSourceType,
} from "../../config/competitor-intel";
import { classifySourcegraphIntegrationOpportunity, type IntegrationOpportunityLevel } from "./sourcegraph-integration-opportunity";

export interface RankedCompetitorIntelItem {
  competitor: string;
  date: string | null;
  date_confidence: "exact" | "inferred" | "unknown";
  title: string;
  source: string;
  source_type: IntelSourceType;
  url: string;
  update_type: string;
  overlap_with_sourcegraph: string[];
  summary: string;
  why_it_matters: string;
  threat_level: "high" | "medium" | "low" | "negative";
  confidence: "high" | "medium" | "low";
  novelty_score: number;
  relevance_score: number;
  actionability: string[];
  integration_opportunity: IntegrationOpportunityLevel;
  sourcegraph_integration_play: string[];
  evidence_notes: string[];
  debug_scores: Record<string, number>;
}

interface CompetitorIntelQualityRubric {
  requireCanonicalUrl: boolean;
  minSummaryLength: number;
  maxSummaryLength: number;
  maxSummarySentences: number;
  maxHighThreatWithoutStrongOverlap: boolean;
  requireEvidenceNotes: boolean;
}

const DEFAULT_COMPETITOR_INTEL_RUBRIC: CompetitorIntelQualityRubric = {
  requireCanonicalUrl: true,
  minSummaryLength: 40,
  maxSummaryLength: 420,
  maxSummarySentences: 3,
  maxHighThreatWithoutStrongOverlap: true,
  requireEvidenceNotes: true,
};

interface CandidateDoc {
  competitorId: string;
  title: string;
  summary: string;
  content: string;
  url: string;
  source: string;
  source_type: IntelSourceType;
  publishedAt?: Date;
  dateConfidence?: "exact" | "inferred" | "unknown";
  retrievalScore: number;
}

interface InternalDoc {
  id: string;
  title: string;
  url: string;
  sourceTitle?: string;
  publishedAt?: Date;
  summary: string;
  snippet: string;
  searchText: string;
}

function looksNoisyCompetitorUrl(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("#comment") ||
    lower.includes("/comment") ||
    lower.includes("/comments") ||
    lower.includes("utm_source=") && lower.includes("subscribe") ||
    lower.includes("reddit.com/") ||
    lower.includes("news.ycombinator.com/")
  );
}

interface EventCluster {
  competitor: CompetitorIntelEntry;
  eventKey: string;
  canonicalTitle: string;
  docs: CandidateDoc[];
  representative: CandidateDoc;
}

const SOURCE_PRIORITY: Record<IntelSourceType, number> = {
  primary: 4,
  internal_curated: 3,
  secondary: 2,
  community: 1,
};

const STOPWORDS = new Set([
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
  "introducing",
  "announces",
  "announce",
  "launches",
  "launch",
  "new",
]);

function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t))
    .slice(0, 12)
    .join(" ");
}

function inferUpdateType(text: string): string {
  const t = text.toLowerCase();
  // Prefer benchmark proof and launch classification before pricing:
  // launch posts can include temporary pricing notes, but the primary
  // competitive move is still product availability/performance.
  if (/(case study|customer story|customer evidence|fortune 500|swe[\s-]?bench|leaderboard)/.test(t))
    return "market_proof";
  if (
    /(introducing|now available|general availability|\bga\b|release notes|changelog|preview|beta|launch|launches|released)/.test(t)
  ) {
    return "product_launch";
  }
  if (/(pricing|package|packaging|tier|enterprise plan|credits? pricing|promotional pricing)/.test(t))
    return "pricing_packaging";
  if (/(security|compliance|audit|policy|rbac|sso|self-hosted|on-prem)/.test(t)) return "security_enterprise";
  return "product_update";
}

function confidenceLevel(sourceType: IntelSourceType, docsCount: number): "high" | "medium" | "low" {
  if (sourceType === "primary" && docsCount >= 1) return "high";
  if (sourceType === "internal_curated" || sourceType === "secondary") return "medium";
  return "low";
}

function threatLevel(scoreMap: Record<string, number>): "high" | "medium" | "low" | "negative" {
  const score = scoreMap.final_score;
  if (
    score >= 5.1 &&
    (scoreMap.direct_overlap ?? 0) >= 3 &&
    (scoreMap.enterprise_relevance ?? 0) >= 4
  ) {
    return "high";
  }
  if (score >= 3.6) return "medium";
  if ((scoreMap.enterprise_relevance ?? 0) >= 4 && score >= 3.2) return "medium";
  if ((scoreMap.benchmark_signal ?? 0) >= 4 && (scoreMap.direct_overlap ?? 0) >= 3 && score >= 3.4) return "medium";
  if (score >= 2.2) return "low";
  return "negative";
}

function noveltyScore(publishedAt?: Date): number {
  if (!publishedAt) return 1;
  const ageDays = (Date.now() - publishedAt.getTime()) / (24 * 60 * 60 * 1000);
  if (ageDays <= 14) return 5;
  if (ageDays <= 30) return 4;
  if (ageDays <= 90) return 3;
  if (ageDays <= 180) return 2;
  return 1;
}

function isWithinWindow(publishedAt: Date | undefined, periodDays: number): boolean {
  if (!publishedAt) return true;
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  return publishedAt.getTime() >= cutoff;
}

function shouldKeepUndatedDoc(doc: CandidateDoc, periodDays: number, ownDomain: boolean): boolean {
  if (doc.publishedAt) return true;
  const text = `${doc.title} ${doc.summary} ${doc.content}`.toLowerCase();
  const titleUrl = `${doc.title} ${doc.url}`.toLowerCase();
  const urlLower = doc.url.toLowerCase();
  const looksOfficial =
    /\/blog\/|\/news\/|\/updates\/|\/changelog\/|\/articles\/|\/post\/|\/insights\/|\/resources\/|release|changelog/.test(urlLower) ||
    /release|changelog|blog|what'?s new|article|insight/.test(titleUrl);
  const highSignalBenchmark =
    /swe[\s-]?bench|benchmark|leaderboard|eval/.test(titleUrl) &&
    /\/blog\/|\/news\/|\/updates\//.test(urlLower) &&
    !/\/tools\/|(\bvs\b)|\bbest\b|\bcomparison\b/.test(titleUrl);

  if (periodDays <= 7) {
    return (
      ownDomain &&
      doc.source_type === "primary" &&
      (highSignalBenchmark ? doc.retrievalScore >= 3.8 : (looksOfficial && doc.retrievalScore >= 2))
    );
  }
  if (periodDays <= 31) {
    return (
      ownDomain &&
      doc.source_type === "primary" &&
      (highSignalBenchmark ? doc.retrievalScore >= 2.6 : (looksOfficial && doc.retrievalScore >= 2))
    );
  }
  if (periodDays <= 90) {
    return (
      doc.source_type === "primary" &&
      /(ga|general availability|launch|release|changelog|pricing|enterprise|benchmark|swe[\s-]?bench|case study|customer)/.test(text)
    );
  }
  return true;
}

function chooseRepresentative(docs: CandidateDoc[]): CandidateDoc {
  return [...docs].sort((a, b) => {
    const aScore = SOURCE_PRIORITY[a.source_type] + a.retrievalScore;
    const bScore = SOURCE_PRIORITY[b.source_type] + b.retrievalScore;
    if (bScore !== aScore) return bScore - aScore;
    return (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0);
  })[0];
}

function buildEventKey(competitorId: string, title: string, publishedAt?: Date): string {
  const month = publishedAt ? `${publishedAt.getUTCFullYear()}-${String(publishedAt.getUTCMonth() + 1).padStart(2, "0")}` : "unknown";
  return `${competitorId}|${month}|${title}`;
}

function clusterDocs(docs: CandidateDoc[], competitor: CompetitorIntelEntry): EventCluster[] {
  const grouped = new Map<string, CandidateDoc[]>();
  for (const doc of docs) {
    const canonicalTitle = normalizeTitle(doc.title);
    const key = buildEventKey(competitor.id, canonicalTitle, doc.publishedAt);
    const bucket = grouped.get(key) ?? [];
    bucket.push(doc);
    grouped.set(key, bucket);
  }

  return Array.from(grouped.entries()).map(([eventKey, bucket]) => {
    const rep = chooseRepresentative(bucket);
    return {
      competitor,
      eventKey,
      canonicalTitle: normalizeTitle(rep.title),
      docs: bucket,
      representative: rep,
    };
  });
}

function clusterScore(cluster: EventCluster): Record<string, number> {
  const rep = cluster.representative;
  const text = `${rep.title} ${rep.summary} ${rep.content}`;
  const titleUrl = `${rep.title} ${rep.url}`.toLowerCase();
  const overlap = classifyOverlapWithSourcegraph(text);
  const strategicNarrative = /(benchmark|swe[\s-]?bench|case study|customer story|customer evidence|pricing|packaging|enterprise plan|leaderboard|eval)/i.test(
    text,
  )
    ? 4.5
    : 1.5;
  const benchmark_signal = /(swe[\s-]?bench|benchmark|leaderboard|eval)/i.test(titleUrl) ? 2 : 1;
  const benchmark_evidence_boost =
    /\/blog\//.test(rep.url.toLowerCase()) && /(swe[\s-]?bench|benchmark|leaderboard|eval)/i.test(titleUrl) ? 0.15 : 0;
  const seo_comparison_penalty = /\/tools\/|(\bvs\b)|\bbest\b|\bcomparison\b/.test(titleUrl) ? -1.2 : 0;
  const urlPath = rep.url.toLowerCase().replace(/\?.*$/, "");
  const isIndexOrPagination =
    /\/$|\/blog\/?$|\/blog\/page\/\d+(\/)?$|\/docs\/?$|\/changelog\/?$|\/pricing\/?$|\/context-engine\/?$/.test(urlPath);
  const generic_page_penalty = isIndexOrPagination ? -1 : 0;

  const direct_overlap = Math.max(1, Math.min(5, overlap.length));
  const agent_mcp_overlap = overlap.some((s) => s === "mcp" || s === "agent_context") ? 5 : 1;
  const enterprise_relevance = overlap.some((s) => s === "enterprise_control" || s === "governance") ? 5 : 2;
  const product_materiality = /(ga|general availability|launch|preview|beta|release|pricing|packaging|tier)/i.test(text) ? 4.2 : 2.4;
  const market_signal = /(case study|customer|benchmark|fortune 500)/i.test(text) ? 3 : 1.5;
  const novelty = noveltyScore(rep.publishedAt);
  const source_quality = rep.source_type === "primary" ? 5 : rep.source_type === "internal_curated" ? 4.5 : rep.source_type === "secondary" ? 3 : 1.5;
  const evidence_strength = Math.min(5, 2 + cluster.docs.length);
  const actionability = direct_overlap >= 3 || enterprise_relevance >= 4 || strategicNarrative >= 4 ? 5 : 2;
  const generic_news_penalty = overlap.length === 0 && strategicNarrative < 4 ? -4 : 0;
  const operational_update_penalty = /(metrics report|usage metrics|telemetry|allowlist|cdn|download urls|api endpoint|cli activity)/i.test(
    text,
  )
    ? -1.5
    : 0;
  const material_update_boost = /(pricing|packaging|tier|enterprise|security|compliance|sso|rbac|ga|general availability|release|self[-\s]?host|on[-\s]?prem|admin|governance|policy)/i.test(
    text,
  )
    ? 0.9
    : 0;
  const benchmark_marketing_penalty =
    /(swe[\s-]?bench|benchmark|leaderboard|eval)/i.test(titleUrl) &&
    !/(pricing|packaging|tier|enterprise|security|compliance|sso|rbac|ga|general availability|release|self[-\s]?host|on[-\s]?prem|admin|governance|policy|case study|customer)/i.test(text)
      ? -0.9
      : 0;

  const final_score =
    0.24 * direct_overlap +
    0.14 * agent_mcp_overlap +
    0.14 * enterprise_relevance +
    0.14 * product_materiality +
    0.08 * market_signal +
    0.08 * strategicNarrative +
    0.04 * benchmark_signal +
    0.1 * novelty +
    0.08 * source_quality +
    0.04 * evidence_strength +
    0.04 * actionability +
    material_update_boost +
    operational_update_penalty +
    benchmark_marketing_penalty +
    generic_news_penalty +
    seo_comparison_penalty +
    generic_page_penalty +
    benchmark_evidence_boost;

  return {
    direct_overlap,
    agent_mcp_overlap,
    enterprise_relevance,
    product_materiality,
    market_signal,
    strategic_narrative: strategicNarrative,
    benchmark_signal,
    benchmark_evidence_boost,
    novelty,
    source_quality,
    evidence_strength,
    actionability,
    duplication_penalty: 0,
    material_update_boost,
    operational_update_penalty,
    benchmark_marketing_penalty,
    generic_news_penalty,
    seo_comparison_penalty,
    generic_page_penalty,
    final_score,
  };
}

function enrichOverlapWithSignals(base: string[], text: string): string[] {
  const out = new Set(base);
  const t = text.toLowerCase();
  if (/(swe[\s-]?bench|benchmark|retrieval|indexing|cross[-\s]?file|repo[-\s]?aware|codebase context)/.test(t)) {
    out.add("agent_context");
    out.add("large_codebase_understanding");
  }
  if (/(semantic search|code search|retrieval|deep search)/.test(t)) {
    out.add("code_search");
  }
  return Array.from(out);
}

function deriveActionability(
  score: Record<string, number>,
  tl: "high" | "medium" | "low" | "negative",
  overlap: string[],
): string[] {
  const out = new Set<string>();
  if (score.enterprise_relevance >= 4) out.add("sales");
  if (score.direct_overlap >= 3 || (score.benchmark_signal ?? 1) >= 4) {
    out.add("product");
    out.add("messaging");
  }
  if (overlap.some((o) => o === "batch_changes" || o === "agent_context" || o === "code_search")) {
    out.add("product");
    out.add("messaging");
  }
  if (tl === "high" || (tl === "medium" && score.final_score >= 3.8)) out.add("exec");
  if (out.size === 0) out.add("monitoring");
  return Array.from(out);
}

function whyItMatters(
  competitor: CompetitorIntelEntry,
  overlap: string[],
  score: Record<string, number>,
  text: string,
  actionability: string[],
): string {
  const surfaces = overlap.length > 0 ? overlap.join(", ") : "adjacent workflow surfaces";
  const update = inferUpdateType(text).replace(/_/g, " ");
  const benchmark = (score.benchmark_signal ?? 0) >= 4;
  const enterprise = (score.enterprise_relevance ?? 0) >= 4;
  const workflow = overlap.includes("agent_context")
    ? "agent context retrieval quality"
    : overlap.includes("code_search")
      ? "code search and grounding quality"
      : overlap.includes("batch_changes")
        ? "large-scale edit execution and review flow"
        : "agent workflow reliability";
  const nextAction = actionability.includes("product")
    ? "Product: evaluate parity gaps and ship a concrete integration demo."
    : actionability.includes("sales")
      ? "Sales: update deal qualification and competitive handling for active evaluations."
      : actionability.includes("messaging")
        ? "Messaging: refresh battlecards with workflow-specific proof points."
        : "Monitoring: track for follow-on customer adoption and integration depth.";

  const evidenceAngle =
    benchmark && enterprise
      ? "This combines benchmark signal with enterprise workflow relevance."
      : benchmark
        ? "This adds benchmark signal that can influence tool evaluation criteria."
        : enterprise
          ? "This is materially relevant to enterprise implementation workflows."
          : "This is a directional signal for workflow evolution.";

  return `Change: ${competitor.display_name} published a ${update} move touching ${surfaces}. Why this matters for Sourcegraph: it affects ${workflow}. ${evidenceAngle} ${nextAction}`;
}

function tokenizedSignalPool(competitor: CompetitorIntelEntry, queries: string[]): string[] {
  const pool = new Set<string>([
    competitor.company,
    competitor.display_name,
    ...competitor.aliases,
    ...competitor.products,
    ...competitor.overlap_terms,
    ...competitor.watch_terms,
    ...queries,
  ]);

  const tokens = Array.from(pool)
    .flatMap((s) => s.toLowerCase().split(/[^a-z0-9]+/g))
    .filter((t) => t.length >= 3);
  return Array.from(new Set(tokens));
}

function clampText(text: string | undefined, maxLen: number): string {
  if (!text) return "";
  return text.length > maxLen ? text.slice(0, maxLen) : text;
}

function toInternalDoc(item: {
  id: string;
  title: string;
  url: string;
  sourceTitle?: string | null;
  publishedAt?: Date;
  summary?: string | null;
  snippet?: string | null;
  fullText?: string | null;
}): InternalDoc {
  const summary = clampText(item.summary ?? undefined, 1200);
  const snippet = clampText(item.snippet ?? undefined, 1600);
  const full = clampText(item.fullText ?? undefined, 2400);
  return {
    id: item.id,
    title: item.title,
    url: item.url,
    sourceTitle: item.sourceTitle ?? undefined,
    publishedAt: item.publishedAt,
    summary,
    snippet,
    searchText: `${item.title} ${summary} ${snippet} ${full}`.toLowerCase(),
  };
}

function internalRetrievalScore(item: InternalDoc, competitor: CompetitorIntelEntry, tokens: string[]): number {
  const text = item.searchText;
  const signalMatches = tokens.reduce((acc, t) => acc + (text.includes(t) ? 1 : 0), 0);
  const competitorMention = [competitor.display_name, competitor.company, ...competitor.aliases, ...competitor.products]
    .map((x) => x.toLowerCase())
    .some((term) => text.includes(term));
  const ownDomain = domainMatchesCompetitor(item.url, competitor);

  const overlap = classifyOverlapWithSourcegraph(text).length;
  const recency = noveltyScore(item.publishedAt);
  if (!competitorMention && !ownDomain) {
    return 1.2 + overlap * 0.3 + signalMatches * 0.02 + recency * 0.15;
  }
  return (competitorMention ? 2.7 : 2.1) + overlap * 0.8 + signalMatches * 0.08 + recency * 0.3;
}

async function loadInternalDocs(periodDays: number, maxDocs: number): Promise<InternalDoc[]> {
  const categories = VALID_CATEGORIES as readonly Category[];
  const byId = new Map<string, InternalDoc>();
  const perCategoryLimit = Math.max(20, Math.ceil(maxDocs / Math.max(1, categories.length)));
  const cutoffTime = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);
  const driver = detectDriver();

  for (const category of categories) {
    if (driver === "postgres") {
      const client = await getDbClient();
      const result = await client.query(
        `SELECT id, title, url, source_title, published_at, summary, content_snippet,
                LEFT(COALESCE(full_text, ''), 2400) AS full_text_excerpt
         FROM items
         WHERE category = $1
           AND published_at >= $2
           AND url IS NOT NULL
         ORDER BY published_at DESC
         LIMIT $3`,
        [category, cutoffTime, perCategoryLimit],
      );
      for (const row of result.rows as Array<{
        id: string;
        title: string;
        url: string;
        source_title?: string | null;
        published_at: number;
        summary?: string | null;
        content_snippet?: string | null;
        full_text_excerpt?: string | null;
      }>) {
        if (!row.id || !row.title || !row.url || byId.has(row.id)) continue;
        byId.set(
          row.id,
          toInternalDoc({
            id: row.id,
            title: row.title,
            url: row.url,
            sourceTitle: row.source_title,
            publishedAt: row.published_at ? new Date(row.published_at * 1000) : undefined,
            summary: row.summary,
            snippet: row.content_snippet,
            fullText: row.full_text_excerpt,
          }),
        );
      }
    } else {
      const sqlite = getSqlite();
      const rows = sqlite
        .prepare(
          `SELECT id, title, url, source_title, published_at, summary, content_snippet,
                  substr(COALESCE(full_text, ''), 1, 2400) AS full_text_excerpt
           FROM items
           WHERE category = ? AND published_at >= ? AND url IS NOT NULL
           ORDER BY published_at DESC
           LIMIT ?`,
        )
        .all(category, cutoffTime, perCategoryLimit) as Array<{
          id: string;
          title: string;
          url: string;
          source_title?: string | null;
          published_at: number;
          summary?: string | null;
          content_snippet?: string | null;
          full_text_excerpt?: string | null;
        }>;

      for (const row of rows) {
        if (!row.id || !row.title || !row.url || byId.has(row.id)) continue;
        byId.set(
          row.id,
          toInternalDoc({
            id: row.id,
            title: row.title,
            url: row.url,
            sourceTitle: row.source_title,
            publishedAt: row.published_at ? new Date(row.published_at * 1000) : undefined,
            summary: row.summary,
            snippet: row.content_snippet,
            fullText: row.full_text_excerpt,
          }),
        );
      }
    }
  }

  return Array.from(byId.values())
    .sort((a, b) => (b.publishedAt?.getTime() ?? 0) - (a.publishedAt?.getTime() ?? 0))
    .slice(0, maxDocs);
}

function toCandidateFromFeed(item: InternalDoc, competitorId: string, retrievalScore: number): CandidateDoc {
  const domain = getDomainFromUrl(item.url);
  const sourceType = classifySourceTypeByDomain(domain);
  return {
    competitorId,
    title: item.title,
    summary: item.summary ?? item.snippet ?? "",
    content: item.snippet ?? item.summary ?? "",
    url: item.url,
    source: domain || item.sourceTitle || "unknown",
    source_type: sourceType === "secondary" ? "internal_curated" : sourceType,
    publishedAt: item.publishedAt,
    dateConfidence: item.publishedAt ? "exact" : "unknown",
    retrievalScore,
  };
}

function periodDaysToWebTimeRange(
  periodDays: number
): "day" | "week" | "month" | "year" | undefined {
  if (periodDays <= 1) return "day";
  if (periodDays <= 7) return "week";
  if (periodDays <= 30) return "month";
  if (periodDays <= 365) return "year";
  return undefined;
}

async function retrieveWebDocs(
  competitor: CompetitorIntelEntry,
  queries: string[],
  webDocsPerQuery: number,
  maxQueries: number,
  periodDays: number,
): Promise<CandidateDoc[]> {
  const docs: CandidateDoc[] = [];
  const strategicQueryPattern = /(benchmark|swe[\s-]?bench|case study|customer|pricing|packaging|enterprise)/i;
  const strategicSeeds = [
    `${competitor.display_name} case study`,
    `${competitor.display_name} pricing`,
    `${competitor.display_name} enterprise`,
  ];
  const strategic = [...strategicSeeds, ...queries].filter((q) => strategicQueryPattern.test(q));
  const routine = queries.filter((q) => !strategicQueryPattern.test(q));
  const strategicCap = Math.min(2, maxQueries);
  const selectedQueries = Array.from(
    new Set([...strategic.slice(0, strategicCap), ...routine.slice(0, maxQueries - strategicCap)]),
  ).slice(0, maxQueries);

  const timeRange = periodDaysToWebTimeRange(periodDays);

  for (const query of selectedQueries) {
    const q = query.toLowerCase();
    const isNarrativeQuery = /(benchmark|swe[\s-]?bench|case study|customer|pricing|packaging|enterprise)/.test(q);
    const results = await searchWeb(query, {
      numResults: isNarrativeQuery ? Math.max(webDocsPerQuery, 8) : webDocsPerQuery,
      domains: competitor.domains,
      topic: "general",
      // Apply requested window so "last month" doesn't pull in old articles.
      timeRange: isNarrativeQuery ? timeRange ?? "year" : timeRange ?? "year",
    });

    for (const result of results) {
      if (!result.url || !result.title) continue;
      const domain = getDomainFromUrl(result.url);
      docs.push({
        competitorId: competitor.id,
        title: result.title,
        summary: result.content ?? "",
        content: result.content ?? "",
        url: result.url,
        source: domain || "web",
        source_type: classifySourceTypeByDomain(domain),
        publishedAt: result.publishedDate ? new Date(result.publishedDate) : undefined,
        dateConfidence: result.publishedDate ? "exact" : "unknown",
        retrievalScore: (result.score ?? 0.5) * 2,
      });
    }
  }
  return docs;
}

async function retrieveStrategicBackfillDocs(
  competitor: CompetitorIntelEntry,
  periodDays: number,
  limit = 8,
): Promise<CandidateDoc[]> {
  const queries = [
    `${competitor.display_name} benchmark swe bench`,
    `${competitor.display_name} case study customer enterprise`,
    `${competitor.display_name} pricing packaging enterprise`,
  ];
  const byUrl = new Map<string, CandidateDoc>();

  for (const query of queries) {
    const period = periodDays <= 1 ? "day" : periodDays <= 7 ? "week" : periodDays <= 31 ? "month" : "all";
    const rows = await dbFullTextSearch(query, { period, limit: Math.max(12, limit * 2) });
    for (const row of rows) {
      if (!row.url || !row.title) continue;
      if (!domainMatchesCompetitor(row.url, competitor)) continue;

      const text = `${row.title} ${row.summary ?? ""} ${row.contentSnippet ?? ""}`.toLowerCase();
      if (!/(benchmark|swe[\s-]?bench|case study|customer|pricing|packaging|enterprise)/.test(text)) continue;

      const domain = getDomainFromUrl(row.url);
      const sourceType = classifySourceTypeByDomain(domain);
      const scoreBoost = /(benchmark|swe[\s-]?bench)/.test(text) ? 3.4 : 3.2;
      const publishedAt = row.publishedAt ? new Date(row.publishedAt * 1000) : undefined;
      if (!isWithinWindow(publishedAt, periodDays)) continue;

      byUrl.set(row.url, {
        competitorId: competitor.id,
        title: row.title,
        summary: row.summary ?? row.contentSnippet ?? "",
        content: row.contentSnippet ?? row.summary ?? "",
        url: row.url,
        source: domain || row.sourceTitle || "unknown",
        source_type: sourceType === "secondary" ? "internal_curated" : sourceType,
        publishedAt,
        dateConfidence: publishedAt ? "exact" : "unknown",
        retrievalScore: scoreBoost,
      });
      if (byUrl.size >= limit) break;
    }
    if (byUrl.size >= limit) break;
  }

  return Array.from(byUrl.values());
}

async function retrieveStrategicUrlBackfillDocs(
  competitor: CompetitorIntelEntry,
  periodDays: number,
  limit = 6,
): Promise<CandidateDoc[]> {
  const patterns = ["%swe-bench%", "%swebench%", "%benchmark%"];
  const out: CandidateDoc[] = [];
  const driver = detectDriver();

  if (driver === "postgres") {
    const client = await getDbClient();
    for (const domain of competitor.domains) {
      const result = await client.query(
        `SELECT id, title, url, source_title, published_at, summary, content_snippet
         FROM items
         WHERE lower(url) LIKE $1
           AND published_at >= $2
           AND (
             lower(url) LIKE $3 OR lower(url) LIKE $4 OR lower(url) LIKE $5
           )
         ORDER BY published_at DESC
         LIMIT $6`,
        [
          `%${domain.toLowerCase()}%`,
          Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000),
          patterns[0],
          patterns[1],
          patterns[2],
          limit,
        ],
      );
      for (const row of result.rows as Array<{
        title: string;
        url: string;
        source_title?: string | null;
        published_at: number;
        summary?: string | null;
        content_snippet?: string | null;
      }>) {
        const domainMatch = domainMatchesCompetitor(row.url, competitor);
        if (!domainMatch) continue;
        const sourceDomain = getDomainFromUrl(row.url);
        const sourceType = classifySourceTypeByDomain(sourceDomain);
        out.push({
          competitorId: competitor.id,
          title: row.title,
          summary: row.summary ?? row.content_snippet ?? "",
          content: row.content_snippet ?? row.summary ?? "",
          url: row.url,
          source: sourceDomain || row.source_title || "unknown",
          source_type: sourceType === "secondary" ? "internal_curated" : sourceType,
          publishedAt: row.published_at ? new Date(row.published_at * 1000) : undefined,
          dateConfidence: row.published_at ? "exact" : "unknown",
          retrievalScore: 4.6,
        });
      }
    }
  } else {
    const sqlite = getSqlite();
    for (const domain of competitor.domains) {
      const rows = sqlite
        .prepare(
          `SELECT title, url, source_title, published_at, summary, content_snippet
           FROM items
           WHERE lower(url) LIKE ?
             AND published_at >= ?
             AND (
               lower(url) LIKE ? OR lower(url) LIKE ? OR lower(url) LIKE ?
             )
           ORDER BY published_at DESC
           LIMIT ?`,
        )
        .all(
          `%${domain.toLowerCase()}%`,
          Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000),
          patterns[0],
          patterns[1],
          patterns[2],
          limit,
        ) as Array<{
          title: string;
          url: string;
          source_title?: string | null;
          published_at: number;
          summary?: string | null;
          content_snippet?: string | null;
        }>;
      for (const row of rows) {
        const domainMatch = domainMatchesCompetitor(row.url, competitor);
        if (!domainMatch) continue;
        const sourceDomain = getDomainFromUrl(row.url);
        const sourceType = classifySourceTypeByDomain(sourceDomain);
        out.push({
          competitorId: competitor.id,
          title: row.title,
          summary: row.summary ?? row.content_snippet ?? "",
          content: row.content_snippet ?? row.summary ?? "",
          url: row.url,
          source: sourceDomain || row.source_title || "unknown",
          source_type: sourceType === "secondary" ? "internal_curated" : sourceType,
          publishedAt: row.published_at ? new Date(row.published_at * 1000) : undefined,
          dateConfidence: row.published_at ? "exact" : "unknown",
          retrievalScore: 4.6,
        });
      }
    }
  }

  return dedupeDocs(out).slice(0, limit);
}

async function retrieveRecentDomainDocs(
  competitor: CompetitorIntelEntry,
  periodDays: number,
  limit = 10,
): Promise<CandidateDoc[]> {
  const out: CandidateDoc[] = [];
  const cutoff = Math.floor((Date.now() - periodDays * 24 * 60 * 60 * 1000) / 1000);
  const driver = detectDriver();
  if (driver === "postgres") {
    const client = await getDbClient();
    for (const domain of competitor.domains) {
      const result = await client.query(
        `SELECT title, url, source_title, published_at, summary, content_snippet
         FROM items
         WHERE lower(url) LIKE $1
           AND published_at >= $2
         ORDER BY published_at DESC
         LIMIT $3`,
        [`%${domain.toLowerCase()}%`, cutoff, limit],
      );
      for (const row of result.rows as Array<{
        title: string;
        url: string;
        source_title?: string | null;
        published_at: number;
        summary?: string | null;
        content_snippet?: string | null;
      }>) {
        if (!domainMatchesCompetitor(row.url, competitor)) continue;
        const text = `${row.title ?? ""} ${row.summary ?? ""} ${row.content_snippet ?? ""}`.toLowerCase();
        if (!hasMaterialSignal({
          competitorId: competitor.id,
          title: row.title ?? "",
          summary: row.summary ?? "",
          content: row.content_snippet ?? "",
          url: row.url ?? "",
          source: row.source_title ?? "unknown",
          source_type: "primary",
          retrievalScore: 3.1,
        })) {
          continue;
        }
        out.push({
          competitorId: competitor.id,
          title: row.title,
          summary: row.summary ?? row.content_snippet ?? "",
          content: row.content_snippet ?? row.summary ?? "",
          url: row.url,
          source: getDomainFromUrl(row.url) || row.source_title || "unknown",
          source_type: "primary",
          publishedAt: row.published_at ? new Date(row.published_at * 1000) : undefined,
          dateConfidence: row.published_at ? "exact" : "unknown",
          retrievalScore: /(benchmark|swe[\s-]?bench|pricing|enterprise|security|mcp|release)/i.test(text) ? 3.8 : 3.1,
        });
      }
    }
  } else {
    const sqlite = getSqlite();
    for (const domain of competitor.domains) {
      const rows = sqlite
        .prepare(
          `SELECT title, url, source_title, published_at, summary, content_snippet
           FROM items
           WHERE lower(url) LIKE ?
             AND published_at >= ?
           ORDER BY published_at DESC
           LIMIT ?`,
        )
        .all(`%${domain.toLowerCase()}%`, cutoff, limit) as Array<{
          title: string;
          url: string;
          source_title?: string | null;
          published_at: number;
          summary?: string | null;
          content_snippet?: string | null;
        }>;
      for (const row of rows) {
        if (!domainMatchesCompetitor(row.url, competitor)) continue;
        const text = `${row.title ?? ""} ${row.summary ?? ""} ${row.content_snippet ?? ""}`.toLowerCase();
        if (!hasMaterialSignal({
          competitorId: competitor.id,
          title: row.title ?? "",
          summary: row.summary ?? "",
          content: row.content_snippet ?? "",
          url: row.url ?? "",
          source: row.source_title ?? "unknown",
          source_type: "primary",
          retrievalScore: 3.1,
        })) {
          continue;
        }
        out.push({
          competitorId: competitor.id,
          title: row.title,
          summary: row.summary ?? row.content_snippet ?? "",
          content: row.content_snippet ?? row.summary ?? "",
          url: row.url,
          source: getDomainFromUrl(row.url) || row.source_title || "unknown",
          source_type: "primary",
          publishedAt: row.published_at ? new Date(row.published_at * 1000) : undefined,
          dateConfidence: row.published_at ? "exact" : "unknown",
          retrievalScore: /(benchmark|swe[\s-]?bench|pricing|enterprise|security|mcp|release)/i.test(text) ? 3.8 : 3.1,
        });
      }
    }
  }
  return dedupeDocs(out).slice(0, limit);
}

const BLOG_INDEX_PATHS = ["/blog", "/news", "/updates", "/changelog"];

/**
 * Fetch the competitor's blog index page(s) and parse recent post links.
 * Does not depend on search ranking — we get whatever is listed on their blog page.
 */
async function retrieveRecentBlogListing(
  competitor: CompetitorIntelEntry,
  limit = 20,
): Promise<CandidateDoc[]> {
  const docs: CandidateDoc[] = [];
  const seen = new Set<string>();

  for (const domain of competitor.domains) {
    const origins = [`https://www.${domain}`, `https://${domain}`];
    for (const origin of origins) {
      for (const path of BLOG_INDEX_PATHS) {
        const url = `${origin}${path}`;
        try {
          const response = await fetch(url, {
            headers: { "User-Agent": "code-intel-digest/1.0 competitor-intel" },
            signal: AbortSignal.timeout(10000),
          });
          if (!response.ok) continue;
          const html = await response.text();
          const baseUrl = new URL(url);
          // Links to posts: href contains /blog/ (or /news/, etc.) with at least one path segment after
          const linkRe =
            /<a\s[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;
          let match: RegExpExecArray | null;
          while ((match = linkRe.exec(html)) !== null) {
            const rawHref = match[1].trim();
            let linkText = match[2].replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
            if (!rawHref || !linkText || linkText.length < 5) continue;
            const hasPostPath = /\/blog\/[^/]|\/news\/[^/]|\/updates\/[^/]|\/changelog\/[^/]/.test(rawHref);
            if (!hasPostPath) continue;
            let absolute: string;
            try {
              absolute = new URL(rawHref, baseUrl).href;
            } catch {
              continue;
            }
            const docDomain = getDomainFromUrl(absolute);
            if (!competitor.domains.some((d) => docDomain === d || docDomain.endsWith(`.${d}`))) continue;
            const norm = absolute.replace(/#.*$/, "").replace(/\?.*$/, "");
            if (seen.has(norm)) continue;
            seen.add(norm);
            const contextBefore = html.slice(Math.max(0, match.index - 500), match.index);
            const dateFromContext = html.slice(Math.max(0, match.index - 80), match.index + 200).match(
              /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2}/i,
            );
            const publishedAt = dateFromContext ? parseDate(dateFromContext[0]) : undefined;
            const linkTextLooksLikeDate = /^(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s*\d|^\d{4}-\d{2}-\d{2}/i.test(linkText) || linkText.length < 15;
            const precedingHeading = linkTextLooksLikeDate
              ? contextBefore.match(/<h[123][^>]*>([\s\S]*?)<\/h[123]>/gi)?.pop()?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim()
              : null;
            let rawTitle = (precedingHeading && precedingHeading.length >= 10 ? precedingHeading : linkText).slice(0, 300);
            const dateSuffix = rawTitle.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})/i);
            if (dateSuffix && dateSuffix.index != null && dateSuffix.index > 5) {
              rawTitle = rawTitle.slice(0, dateSuffix.index).trim();
            }
            const title = rawTitle;
            const urlLooksLikeBenchmark = /swe[\s-]?bench|benchmark|results?|ranking|eval/i.test(absolute);
            docs.push({
              competitorId: competitor.id,
              title,
              summary: "",
              content: urlLooksLikeBenchmark ? title : "",
              url: absolute,
              source: docDomain || domain,
              source_type: classifySourceTypeByDomain(docDomain),
              publishedAt,
              dateConfidence: publishedAt ? "inferred" : "unknown",
              retrievalScore: urlLooksLikeBenchmark ? 3.8 : 3.4,
            });
            if (docs.length >= limit) return dedupeDocs(docs).slice(0, limit);
          }
        } catch {
          continue;
        }
      }
    }
  }
  return dedupeDocs(docs).slice(0, limit);
}

/**
 * Fetch recent blog/release content from the competitor's own domains via web search.
 * Does not depend on Postgres ingest; ensures we surface competitor blog posts and
 * release notes even when they are not in our curated feeds.
 */
async function retrieveCompetitorBlogFromWeb(
  competitor: CompetitorIntelEntry,
  periodDays: number,
  limit = 16,
): Promise<CandidateDoc[]> {
  const timeRange = periodDaysToWebTimeRange(periodDays) ?? "month";
  const queries = [
    `${competitor.display_name} blog`,
    `${competitor.display_name} release notes changelog`,
    `${competitor.display_name} results benchmark evaluation`,
    `${competitor.display_name} updates`,
  ];
  const docs: CandidateDoc[] = [];
  const byUrl = new Map<string, CandidateDoc>();

  for (const query of queries) {
    const results = await searchWeb(query, {
      numResults: Math.max(10, Math.ceil(limit / queries.length)),
      domains: competitor.domains,
      timeRange,
      topic: "general",
    });
    for (const result of results) {
      if (!result.url || !result.title) continue;
      if (byUrl.has(result.url)) continue;
      const domain = getDomainFromUrl(result.url);
      if (!competitor.domains.some((d) => domain === d || domain.endsWith(`.${d}`))) continue;
      const doc: CandidateDoc = {
        competitorId: competitor.id,
        title: result.title,
        summary: result.content ?? "",
        content: result.content ?? "",
        url: result.url,
        source: domain || "web",
        source_type: classifySourceTypeByDomain(domain),
        publishedAt: result.publishedDate ? new Date(result.publishedDate) : undefined,
        dateConfidence: result.publishedDate ? "exact" : "unknown",
        retrievalScore: 3.5,
      };
      byUrl.set(result.url, doc);
      docs.push(doc);
      if (docs.length >= limit) break;
    }
    if (docs.length >= limit) break;
  }
  return dedupeDocs(docs).slice(0, limit);
}

function dedupeDocs(docs: CandidateDoc[]): CandidateDoc[] {
  const byUrl = new Map<string, CandidateDoc>();
  for (const doc of docs) {
    const existing = byUrl.get(doc.url);
    if (!existing) {
      byUrl.set(doc.url, doc);
      continue;
    }

    const replace =
      SOURCE_PRIORITY[doc.source_type] > SOURCE_PRIORITY[existing.source_type] ||
      doc.content.length > existing.content.length ||
      doc.retrievalScore > existing.retrievalScore;
    if (replace) {
      byUrl.set(doc.url, doc);
    }
  }

  return Array.from(byUrl.values());
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizedIdentityTerms(competitor: CompetitorIntelEntry): string[] {
  const companyTokens = competitor.company
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((t) => t.length >= 4);
  const companyAnchor = companyTokens[0] ?? "";
  const brandQualifiedProducts = competitor.products.filter((p) =>
    companyAnchor ? p.toLowerCase().includes(companyAnchor) : false,
  );

  const raw = [
    competitor.company,
    competitor.display_name,
    ...competitor.aliases,
    ...brandQualifiedProducts,
  ]
    .map((x) => x.toLowerCase().trim())
    .filter(Boolean);

  // Drop very short or obviously generic single tokens that create false positives.
  const blockedSingles = new Set(["ai", "agent", "agents", "enterprise", "tools", "tool", "code"]);
  const terms = raw.filter((term) => {
    const parts = term.split(/\s+/).filter(Boolean);
    if (parts.length === 1) {
      if (parts[0].length < 4) return false;
      if (blockedSingles.has(parts[0])) return false;
    }
    return true;
  });

  return Array.from(new Set(terms));
}

const AMBIGUOUS_SINGLE_IDENTITY_TERMS = new Set([
  "augment",
  "duo",
  "cursor",
  "windsurf",
  "cascade",
  "rovo",
  "bitbucket",
  "github",
  "gitlab",
  "claude",
  "code",
]);

function mentionsCompetitorIdentity(doc: CandidateDoc, competitor: CompetitorIntelEntry): boolean {
  const text = `${doc.title} ${doc.summary} ${doc.content}`.toLowerCase();
  const terms = normalizedIdentityTerms(competitor);
  const phraseTerms = terms.filter((t) => t.includes(" ") || t.includes("/"));
  const singleTerms = terms.filter((t) => !t.includes(" ") && !t.includes("/"));

  // High precision: any phrase/company/product match is enough.
  if (phraseTerms.some((term) => text.includes(term))) return true;

  // For single-token aliases, require 2+ distinct hits and skip ambiguous terms.
  const singleHits = new Set<string>();
  for (const term of singleTerms) {
    if (AMBIGUOUS_SINGLE_IDENTITY_TERMS.has(term)) continue;
    if (term.length < 5) continue;
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    if (re.test(text)) singleHits.add(term);
  }
  return singleHits.size >= 2;
}

function mentionsCompetitorIdentityInTitle(doc: CandidateDoc, competitor: CompetitorIntelEntry): boolean {
  const title = (doc.title ?? "").toLowerCase();
  if (!title) return false;

  const terms = normalizedIdentityTerms(competitor);
  const phraseTerms = terms.filter((t) => t.includes(" ") || t.includes("/"));
  if (phraseTerms.some((term) => title.includes(term))) return true;

  const singleHits = new Set<string>();
  for (const term of terms) {
    if (term.includes(" ") || term.includes("/")) continue;
    if (AMBIGUOUS_SINGLE_IDENTITY_TERMS.has(term)) continue;
    if (term.length < 5) continue;
    const re = new RegExp(`\\b${escapeRegex(term)}\\b`, "i");
    if (re.test(title)) singleHits.add(term);
  }
  return singleHits.size >= 1;
}

function domainMatchesCompetitor(url: string, competitor: CompetitorIntelEntry): boolean {
  const domain = getDomainFromUrl(url);
  if (!domain) return false;
  return competitor.domains.some((d) => {
    const base = d.toLowerCase();
    return domain === base || domain.endsWith(`.${base}`);
  });
}

function domainMatchesAnyTrackedCompetitor(url: string, competitors: CompetitorIntelEntry[]): boolean {
  const domain = getDomainFromUrl(url);
  if (!domain) return false;
  return competitors.some((competitor) =>
    competitor.domains.some((d) => {
      const base = d.toLowerCase();
      return domain === base || domain.endsWith(`.${base}`);
    }),
  );
}

/** UI/nav chrome to strip from competitor intel summaries (same class as market-brief Watch Items). */
const COMPETITOR_SUMMARY_CHROME: RegExp[] = [
  /\bselect your language\s+english\s+deutsch\s+español[\s\S]{0,120}?/gi,
  /\byou signed in with another tab or window[\s\S]{0,80}?reload to refresh[\s\S]{0,40}/gi,
  /\byou signed out of your session[\s\S]{0,60}/gi,
  /\breload to refresh your session[\s\S]{0,40}/gi,
  /\bdismiss alert[\s\S]{0,30}/gi,
  /\bnotifications\s+you must be signed in[\s\S]{0,60}/gi,
  /\bskip to main content[\s\S]{0,20}/gi,
  /\bskip to footer[\s\S]{0,20}/gi,
  /\s*\[[^\]]*\]\s*\(\s*https?:\/\/[^\s)]+\)/g,
];

function compactSummary(text: string, maxLen = 900): string {
  let stripped = text;
  for (const re of COMPETITOR_SUMMARY_CHROME) {
    stripped = stripped.replace(re, " ");
  }
  stripped = stripped
    .replace(/<[^>]+>/g, " ")
    .replace(/section title:\s*/gi, " ")
    .replace(/table of contents/gi, " ")
    .replace(/navigation menu/gi, " ")
    .replace(/toggle navigation/gi, " ")
    .replace(/search or jump to/gi, " ")
    .replace(/\bhome\.jpg\b/gi, " ")
    .replace(/\bimage-\d+\.(jpg|png|webp)\b/gi, " ")
    .replace(/\b[a-f0-9]{8,}-[a-f0-9-]{8,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const normalized = stripped;
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function stripBoilerplateNoise(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/\bcontent:\s*/gi, " ")
    .replace(/\bsummary:\s*/gi, " ")
    .replace(/\bsection title:\s*/gi, " ")
    .replace(/\b(table of contents|navigation menu|toggle navigation|search or jump to)\b/gi, " ")
    .replace(/\b(appearance settings|view docs|follow us|open source|resources|install)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isCanonicalHttpUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:";
  } catch {
    return false;
  }
}

function canonicalizeReportUrl(url: string): string {
  if (!isCanonicalHttpUrl(url)) return "";
  const parsed = new URL(url);
  parsed.hash = "";
  ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "ref", "source"].forEach((key) => {
    parsed.searchParams.delete(key);
  });
  const query = parsed.searchParams.toString();
  parsed.search = query ? `?${query}` : "";
  return parsed.toString();
}

function cleanIntelSummary(text: string, fallbackTitle: string, rubric: CompetitorIntelQualityRubric): string {
  const raw = stripBoilerplateNoise(text);
  const candidate = raw.length > 0 ? raw : fallbackTitle;
  const sentences = candidate
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 18)
    .filter((s) => !/^content[:\s]/i.test(s))
    .slice(0, rubric.maxSummarySentences);

  const summary = (sentences.length > 0 ? sentences.join(" ") : candidate)
    .replace(/\s+/g, " ")
    .trim();

  if (summary.length < rubric.minSummaryLength) {
    return fallbackTitle;
  }
  if (summary.length > rubric.maxSummaryLength) {
    return `${summary.slice(0, rubric.maxSummaryLength - 3).trim()}...`;
  }
  return summary;
}

function refineUpdateType(item: RankedCompetitorIntelItem): string {
  const text = `${item.title} ${item.summary} ${item.why_it_matters}`.toLowerCase();
  if (
    item.update_type === "pricing_packaging" &&
    /(introducing|now available|general availability|\bga\b|release|launch|benchmark|swe[\s-]?bench)/.test(text) &&
    !/(pricing|tier|credits?|promotional pricing|discount)/.test(text)
  ) {
    return "product_launch";
  }
  return inferUpdateType(text);
}

function buildEvidenceNotes(item: RankedCompetitorIntelItem): string[] {
  const notes: string[] = [];
  const dateLabel = item.date ?? "unknown date";
  notes.push(`Primary citation: ${item.source} (${item.source_type}, ${dateLabel})`);
  if (item.overlap_with_sourcegraph.length > 0) {
    notes.push(`Sourcegraph overlap: ${item.overlap_with_sourcegraph.join(", ")}`);
  } else {
    notes.push("Sourcegraph overlap: none");
  }
  notes.push(`Signal confidence: ${item.confidence}`);
  return notes;
}

function normalizeThreatByRubric(
  item: RankedCompetitorIntelItem,
  rubric: CompetitorIntelQualityRubric,
): "high" | "medium" | "low" | "negative" {
  if (!rubric.maxHighThreatWithoutStrongOverlap) return item.threat_level;
  if (item.threat_level !== "high") return item.threat_level;
  const overlapStrength = item.overlap_with_sourcegraph.length;
  const enterpriseStrength = item.debug_scores.enterprise_relevance ?? 0;
  if (overlapStrength < 3 || enterpriseStrength < 4) return "medium";
  return "high";
}

function dedupeNarrativeNearDuplicates(items: RankedCompetitorIntelItem[]): RankedCompetitorIntelItem[] {
  const seen = new Set<string>();
  const out: RankedCompetitorIntelItem[] = [];
  for (const item of items) {
    const overlapKey = [...item.overlap_with_sourcegraph].sort().join(",");
    const titleKey = normalizeTitle(item.title)
      .replace(/\b(now|new|introducing|available|update|updates)\b/g, "")
      .replace(/\s+/g, " ")
      .trim();
    const key = `${item.competitor}|${item.update_type}|${item.date ?? "unknown"}|${overlapKey}|${titleKey}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

export function postProcessCompetitorIntelItems(
  items: RankedCompetitorIntelItem[],
  rubric: CompetitorIntelQualityRubric = DEFAULT_COMPETITOR_INTEL_RUBRIC,
): RankedCompetitorIntelItem[] {
  const cleaned: RankedCompetitorIntelItem[] = [];
  for (const item of items) {
    const canonicalUrl = canonicalizeReportUrl(item.url);
    if (rubric.requireCanonicalUrl && canonicalUrl.length === 0) continue;

    const summary = cleanIntelSummary(item.summary, item.title, rubric);
    const evidence = rubric.requireEvidenceNotes
      ? item.evidence_notes.length > 0
        ? item.evidence_notes
        : buildEvidenceNotes(item)
      : item.evidence_notes;

    cleaned.push({
      ...item,
      url: canonicalUrl || item.url,
      summary,
      update_type: refineUpdateType(item),
      threat_level: normalizeThreatByRubric(item, rubric),
      sourcegraph_integration_play:
        item.sourcegraph_integration_play.length > 0
          ? item.sourcegraph_integration_play
          : classifySourcegraphIntegrationOpportunity({
              title: item.title,
              summary: item.summary,
              content: item.why_it_matters,
              overlap: item.overlap_with_sourcegraph,
              actionability: item.actionability,
            }).sourcegraph_integration_play,
      evidence_notes: evidence,
    });
  }

  return dedupeNarrativeNearDuplicates(cleaned);
}

function hasMaterialSignal(doc: CandidateDoc): boolean {
  const text = `${doc.title} ${doc.summary} ${doc.content}`.toLowerCase();
  return /(ga|general availability|launch|release|preview|beta|docs|blog|changelog|pricing|packaging|tier|enterprise|self-host|on-prem|sso|rbac|security|compliance|audit|case study|customer|benchmark|swe[\s-]?bench|leaderboard|migration|refactor|codemod|remediation)/.test(
    text,
  );
}

function isNarrativeNoise(doc: CandidateDoc): boolean {
  const text = `${doc.title} ${doc.summary} ${doc.content} ${doc.url}`.toLowerCase();
  if (/(show hn|sponsor)/.test(text)) return true;
  if (/(podcast|episode|spotify\.com|substack|newsletter)/.test(text)) return true;
  if (/comments url:|points:\s*\d+|# comments:\s*\d+/.test(text)) return true;
  return false;
}

function isThirdPartyHowToNoise(doc: CandidateDoc): boolean {
  if (doc.source_type === "primary") return false;
  const text = `${doc.title} ${doc.summary} ${doc.url}`.toLowerCase();
  const looksHowTo = /(how to|tutorial|tips|guide|refactoring|quick review|walkthrough)/.test(text);
  const hasMaterialAnchor = /(pricing|packaging|tier|enterprise|security|compliance|sso|rbac|ga|general availability|release|benchmark|swe[\s-]?bench|case study|customer)/.test(
    text,
  );
  return looksHowTo && !hasMaterialAnchor;
}

function isOperationalTelemetryUpdate(text: string): boolean {
  return /(metrics report|usage metrics|telemetry|allowlist|cdn|download urls|api endpoint|cli activity|report urls update)/i.test(
    text,
  );
}

function cleanedScoringText(rep: CandidateDoc): string {
  return `${rep.title} ${rep.summary} ${rep.content}`
    .replace(/<[^>]+>/g, " ")
    .replace(/section title:\s*/gi, " ")
    .replace(/table of contents/gi, " ")
    .replace(/navigation menu/gi, " ")
    .replace(/toggle navigation/gi, " ")
    .replace(/search or jump to/gi, " ")
    .replace(/\bhome\.jpg\b/gi, " ")
    .replace(/\bimage-\d+\.(jpg|png|webp)\b/gi, " ")
    .replace(/\b[a-f0-9]{8,}-[a-f0-9-]{8,}\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Self-reported performance: competitor posting about how well they're doing (benchmarks, results, rankings, etc.). */
function isSelfReportedPerformance(item: RankedCompetitorIntelItem): boolean {
  const t = `${item.title} ${item.summary}`.toLowerCase();
  return /(benchmark|leaderboard|eval|results?|ranking|ranked|achieved|topped|evaluation|how we (built|achieved|reached)|swe[\s-]?bench)/.test(t);
}

function shapeOfItem(item: RankedCompetitorIntelItem): "benchmark_blog" | "comparison_seo" | "generic_page" | "other" {
  const t = `${item.title} ${item.url}`.toLowerCase();
  if (/\/tools\/|(\bvs\b)|\bbest\b|\bcomparison\b/.test(t)) return "comparison_seo";
  if (isSelfReportedPerformance(item) || /swe[\s-]?bench|benchmark|leaderboard|eval/.test(t)) return "benchmark_blog";
  const path = item.url.toLowerCase().replace(/\?.*$/, "");
  if (/\/$|\/blog\/?$|\/blog\/page\/\d+(\/)?$|\/docs\/?$|\/changelog\/?$|\/pricing\/?$|\/context-engine\/?$/.test(path)) return "generic_page";
  return "other";
}

function isMaterialRankedItem(item: RankedCompetitorIntelItem): boolean {
  if (item.update_type === "security_enterprise" || item.update_type === "pricing_packaging" || item.update_type === "product_launch") {
    return true;
  }
  const text = `${item.title} ${item.summary}`.toLowerCase();
  return /(enterprise|security|compliance|sso|rbac|self[-\s]?host|on[-\s]?prem|pricing|packaging|tier|ga|general availability|release)/.test(
    text,
  );
}

function diversifyPerCompetitor(items: RankedCompetitorIntelItem[], topN: number): RankedCompetitorIntelItem[] {
  const materialCount = items.filter(isMaterialRankedItem).length;
  const benchmarkCap = materialCount > 0 ? 1 : Math.max(2, Math.floor(topN / 2));
  const operationalCap = materialCount > 0 ? 1 : 2;
  const updateTypeCaps: Record<string, number> = {
    product_launch: 2,
    product_update: 2,
  };
  const caps: Record<string, number> = {
    benchmark_blog: benchmarkCap,
    comparison_seo: 1,
    generic_page: 1,
    other: topN,
  };
  const counts: Record<string, number> = { benchmark_blog: 0, comparison_seo: 0, generic_page: 0, other: 0 };
  const updateTypeCounts = new Map<string, number>();
  const narrativeCounts = new Map<string, number>();
  let operationalCount = 0;
  const selected: RankedCompetitorIntelItem[] = [];

  // Reserve one slot for "competitor posting about how well they're doing" when present — obviously relevant.
  const performanceItems = items.filter((i) => shapeOfItem(i) === "benchmark_blog");
  const bestPerformance = performanceItems.length
    ? performanceItems.reduce((a, b) => (a.relevance_score >= b.relevance_score ? a : b))
    : null;
  if (bestPerformance && topN >= 1) {
    selected.push(bestPerformance);
    counts.benchmark_blog = 1;
    updateTypeCounts.set(bestPerformance.update_type, (updateTypeCounts.get(bestPerformance.update_type) ?? 0) + 1);
  }

  const deferred: RankedCompetitorIntelItem[] = [];
  const remaining = items.filter((i) => i !== bestPerformance);

  for (const item of remaining) {
    const shape = shapeOfItem(item);
    const text = `${item.title} ${item.summary} ${item.url}`;
    const isOperational = isOperationalTelemetryUpdate(text);
    const typeCap = updateTypeCaps[item.update_type];
    const typeCount = updateTypeCounts.get(item.update_type) ?? 0;
    const narrativeKey = `${item.update_type}|${item.overlap_with_sourcegraph.sort().join(",")}`;
    const narrativeCount = narrativeCounts.get(narrativeKey) ?? 0;
    const narrativeCap = item.update_type === "product_launch" && item.overlap_with_sourcegraph.includes("enterprise_control") ? 2 : topN;
    const violatesTypeCap = typeCap != null && typeCount >= typeCap;
    const violatesOperationalCap = isOperational && operationalCount >= operationalCap;
    const lowPriorityMonitoring =
      item.actionability.length === 1 &&
      item.actionability[0] === "monitoring" &&
      item.threat_level === "low" &&
      selected.filter((s) => s.threat_level === "high" || s.threat_level === "medium").length >= 2;
    if (
      selected.length < topN &&
      counts[shape] < caps[shape] &&
      !violatesTypeCap &&
      !violatesOperationalCap &&
      narrativeCount < narrativeCap &&
      !lowPriorityMonitoring
    ) {
      selected.push(item);
      counts[shape] += 1;
      updateTypeCounts.set(item.update_type, typeCount + 1);
      narrativeCounts.set(narrativeKey, narrativeCount + 1);
      if (isOperational) operationalCount += 1;
    } else {
      deferred.push(item);
    }
  }

  for (const item of deferred) {
    if (selected.length >= topN) break;
    selected.push(item);
  }
  return selected.slice(0, topN);
}

function canonicalUrlKey(url: string): string {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname.replace(/\/+$/, "").toLowerCase();
    return `${host}${path}`;
  } catch {
    return url.toLowerCase();
  }
}

function dedupeRankedEvents(items: RankedCompetitorIntelItem[]): RankedCompetitorIntelItem[] {
  const seen = new Set<string>();
  const seenBenchmarkNarratives = new Set<string>();
  const seenOperationalNarratives = new Set<string>();
  const out: RankedCompetitorIntelItem[] = [];
  for (const item of items) {
    const key = `${item.competitor}|${canonicalUrlKey(item.url)}|${normalizeTitle(item.title)}`;
    if (seen.has(key)) continue;
    if (shapeOfItem(item) === "benchmark_blog") {
      const benchmarkNarrative = normalizeTitle(
        item.title
          .toLowerCase()
          .replace(/\b(top|tops|number|#\d+|open[-\s]?source|verified|pro)\b/g, " ")
          .replace(/\b\d+(\.\d+)?%?\b/g, " "),
      );
      const narrativeKey = `${item.competitor}|${benchmarkNarrative}`;
      if (seenBenchmarkNarratives.has(narrativeKey)) continue;
      seenBenchmarkNarratives.add(narrativeKey);
    }
    if (isOperationalTelemetryUpdate(`${item.title} ${item.summary} ${item.url}`)) {
      const operationalNarrative = normalizeTitle(
        item.title
          .toLowerCase()
          .replace(/\b(copilot|github|gitlab|duo|agent|coding)\b/g, " ")
          .replace(/\b(update|now|includes|report|metrics|usage|telemetry|urls?)\b/g, " "),
      );
      const opKey = `${item.competitor}|${operationalNarrative}`;
      if (seenOperationalNarratives.has(opKey)) continue;
      seenOperationalNarratives.add(opKey);
    }
    seen.add(key);
    out.push(item);
  }
  return out;
}

function capOverallPerCompetitor(items: RankedCompetitorIntelItem[], topOverall: number): RankedCompetitorIntelItem[] {
  // At most 2 per competitor so the report doesn't bunch up GitLab/Copilot; leaves room for others.
  const cap = 2;
  const tier1DisplayNames = new Set(
    getCompetitorIntelEntries()
      .filter((c) => c.tier <= 1)
      .map((c) => c.display_name),
  );

  // Ensure each tier-1 competitor with at least one item gets one slot (so e.g. Augment Code appears when it has signals).
  // Prefer that slot for a benchmark/self-reported-performance post when present, so posts like "X tops SWE-Bench" surface.
  const guaranteed: RankedCompetitorIntelItem[] = [];
  const used = new Set<RankedCompetitorIntelItem>();
  for (const name of tier1DisplayNames) {
    const forCompetitor = items.filter((i) => i.competitor === name);
    if (forCompetitor.length === 0) continue;
    const byScore = [...forCompetitor].sort((a, b) => b.relevance_score - a.relevance_score);
    const benchmark = byScore.find((i) => shapeOfItem(i) === "benchmark_blog");
    const best = benchmark ?? byScore[0];
    guaranteed.push(best);
    used.add(best);
  }

  const counts = new Map<string, number>();
  for (const g of guaranteed) {
    counts.set(g.competitor, (counts.get(g.competitor) ?? 0) + 1);
  }
  const selected: RankedCompetitorIntelItem[] = [...guaranteed];
  const remaining = items.filter((i) => !used.has(i));

  for (const item of remaining) {
    if (selected.length >= topOverall) break;
    const count = counts.get(item.competitor) ?? 0;
    if (count < cap) {
      counts.set(item.competitor, count + 1);
      selected.push(item);
    }
  }
  return selected.slice(0, topOverall);
}

function parseDate(raw: string | null | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  if (parsed.getUTCFullYear() < 2018 || parsed.getTime() > Date.now() + 24 * 60 * 60 * 1000) return undefined;
  return parsed;
}

function extractPublishedDateFromHtml(html: string): Date | undefined {
  const lower = html.toLowerCase();
  const patterns = [
    /<meta[^>]+(?:property|name)=["'](?:article:published_time|og:published_time|publishdate|pubdate|date|dc\.date|datepublished)["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["'](?:article:published_time|og:published_time|publishdate|pubdate|date|dc\.date|datepublished)["']/i,
    /<time[^>]+datetime=["']([^"']+)["']/i,
  ];
  for (const pattern of patterns) {
    const match = html.match(pattern);
    const parsed = parseDate(match?.[1]);
    if (parsed) return parsed;
  }

  const jsonLdDateMatch = lower.match(/"datepublished"\s*:\s*"([^"]+)"/i) ?? lower.match(/"datemodified"\s*:\s*"([^"]+)"/i);
  const parsedJsonLd = parseDate(jsonLdDateMatch?.[1]);
  if (parsedJsonLd) return parsedJsonLd;

  const fallbackIso = html.match(/\b(20\d{2}-\d{2}-\d{2})(?:[t\s][0-2]\d:[0-5]\d(?::[0-5]\d)?(?:\.\d+)?(?:z|[+-][0-2]\d:?[0-5]\d)?)?\b/i);
  const parsedFallback = parseDate(fallbackIso?.[1]);
  if (parsedFallback) return parsedFallback;

  return undefined;
}

async function hydratePublishedDatesFromMetadata(docs: CandidateDoc[], periodDays: number): Promise<CandidateDoc[]> {
  const maxAttempts = periodDays <= 31 ? 16 : 28;
  const targets = docs
    .filter(
      (d) =>
        !d.publishedAt &&
        d.source_type !== "community" &&
        /\/blog\/|\/news\/|\/updates\/|swe[\s-]?bench|benchmark|release|changelog|pricing|security/i.test(`${d.url} ${d.title}`),
    )
    .slice(0, maxAttempts);
  if (targets.length === 0) return docs;

  const inferredByUrl = new Map<string, Date>();
  const withTimeout = async (url: string): Promise<void> => {
    try {
      const response = await fetch(url, {
        headers: { "User-Agent": "code-intel-digest/1.0 competitor-intel" },
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) return;
      const html = await response.text();
      const date = extractPublishedDateFromHtml(html);
      if (date) inferredByUrl.set(url, date);
    } catch {
      // best-effort inference only
    }
  };

  // Small sequential batch keeps this reliable in serverless/local runs.
  for (const target of targets) {
    await withTimeout(target.url);
  }

  if (inferredByUrl.size === 0) return docs;
  return docs.map((d) => {
    if (d.publishedAt) return d;
    const inferred = inferredByUrl.get(d.url);
    if (!inferred) return d;
    return { ...d, publishedAt: inferred, dateConfidence: "inferred" };
  });
}

async function hydratePublishedDates(docs: CandidateDoc[]): Promise<CandidateDoc[]> {
  const missing = Array.from(new Set(docs.filter((d) => !d.publishedAt && !!d.url).map((d) => d.url)));
  if (missing.length === 0) return docs;

  const byUrl = new Map<string, Date>();
  const byCanonical = new Map<string, Date>();
  const canonicalMissing = Array.from(new Set(missing.map(canonicalUrlKey)));
  const driver = detectDriver();
  if (driver === "postgres") {
    const client = await getDbClient();
    const exactResult = await client.query(
      `SELECT url, MAX(published_at) AS published_at
       FROM items
       WHERE url = ANY($1)
       GROUP BY url`,
      [missing],
    );
    for (const row of exactResult.rows as Array<{ url: string; published_at: number | null }>) {
      if (row.published_at) byUrl.set(row.url, new Date(row.published_at * 1000));
    }

    const canonicalResult = await client.query(
      `SELECT regexp_replace(lower(split_part(regexp_replace(url, '^https?://', ''), '?', 1)), '/$', '') AS canonical,
              MAX(published_at) AS published_at
       FROM items
       WHERE regexp_replace(lower(split_part(regexp_replace(url, '^https?://', ''), '?', 1)), '/$', '') = ANY($1)
       GROUP BY canonical`,
      [canonicalMissing],
    );
    for (const row of canonicalResult.rows as Array<{ canonical: string; published_at: number | null }>) {
      if (row.published_at) byCanonical.set(row.canonical, new Date(row.published_at * 1000));
    }
  } else {
    const sqlite = getSqlite();
    const stmt = sqlite.prepare(`SELECT url, MAX(published_at) AS published_at FROM items WHERE url = ? GROUP BY url`);
    for (const url of missing) {
      const row = stmt.get(url) as { url?: string; published_at?: number } | undefined;
      if (row?.url && row.published_at) byUrl.set(row.url, new Date(row.published_at * 1000));
    }
  }

  return docs.map((d) => {
    if (d.publishedAt) return d;
    const inferred = byUrl.get(d.url) ?? byCanonical.get(canonicalUrlKey(d.url));
    if (!inferred) return d;
    return { ...d, publishedAt: inferred, dateConfidence: "inferred" };
  });
}

function toRankedIntel(cluster: EventCluster): RankedCompetitorIntelItem {
  const rep = cluster.representative;
  const text = cleanedScoringText(rep);
  const overlap = enrichOverlapWithSignals(classifyOverlapWithSourcegraph(text), text);
  const scores = clusterScore(cluster);
  let tl = threatLevel(scores);
  const actionability = deriveActionability(scores, tl, overlap);
  // Cap escalation when overlap is weak or absent.
  if (overlap.length === 0 && tl === "high") tl = "medium";
  if (overlap.length <= 1 && tl === "high" && (scores.direct_overlap ?? 0) < 3) tl = "medium";
  const adjustedActionability =
    overlap.length === 0
      ? actionability.filter((a) => a !== "exec" && a !== "sales")
      : actionability;
  if (adjustedActionability.length === 0) adjustedActionability.push("monitoring");
  const dateConfidence = rep.dateConfidence ?? (rep.publishedAt ? "exact" : "unknown");
  const integration = classifySourcegraphIntegrationOpportunity({
    title: rep.title,
    summary: rep.summary,
    content: rep.content,
    overlap,
    actionability: adjustedActionability,
  });

  return {
    competitor: cluster.competitor.display_name,
    date: rep.publishedAt ? rep.publishedAt.toISOString().slice(0, 10) : null,
    date_confidence: dateConfidence,
    title: rep.title,
    source: rep.source,
    source_type: rep.source_type,
    url: rep.url,
    update_type: inferUpdateType(text),
    overlap_with_sourcegraph: overlap,
    summary: compactSummary(rep.summary || rep.title),
    why_it_matters: whyItMatters(cluster.competitor, overlap, scores, text, adjustedActionability),
    threat_level: tl,
    confidence: confidenceLevel(rep.source_type, cluster.docs.length),
    novelty_score: Number(scores.novelty.toFixed(2)),
    relevance_score: Number(scores.final_score.toFixed(2)),
    actionability: adjustedActionability,
    integration_opportunity: integration.level,
    sourcegraph_integration_play: integration.sourcegraph_integration_play,
    evidence_notes: [
      `Underlying event: ${cluster.canonicalTitle}`,
      `Representative source type: ${rep.source_type}`,
      `Supporting docs in cluster: ${cluster.docs.length}`,
      `Date confidence: ${dateConfidence}`,
    ],
    debug_scores: {
      ...scores,
      retrieval_score: rep.retrievalScore,
    },
  };
}

export interface CompetitorIntelOptions {
  periodDays?: number;
  topPerCompetitor?: number;
  topOverall?: number;
  competitorId?: string;
  maxGeneratedQueries?: number;
  webDocsPerQuery?: number;
  maxWebQueriesPerCompetitor?: number;
  internalDocsLimit?: number;
}

/**
 * Retrieval and triage pipeline are intentionally separated:
 * - Retrieval (high recall): broad internal + web candidates
 * - Triage (strict): overlap scoring + clustering + source preference
 */
export async function gatherCompetitorIntel(
  options: CompetitorIntelOptions = {},
): Promise<RankedCompetitorIntelItem[]> {
  const periodDays = options.periodDays ?? 90;
  const topPerCompetitor = options.topPerCompetitor ?? 5;
  const topOverall = options.topOverall ?? 20;
  const maxGeneratedQueries = options.maxGeneratedQueries ?? 24;
  const webDocsPerQuery = options.webDocsPerQuery ?? 5;
  const maxWebQueriesPerCompetitor = options.maxWebQueriesPerCompetitor ?? 4;
  const internalDocsLimit = options.internalDocsLimit ?? 1200;

  const internalItems = await loadInternalDocs(periodDays, internalDocsLimit);
  const competitors = getCompetitorIntelEntries().filter((c) =>
    options.competitorId ? c.id === options.competitorId : true,
  );

  const allRanked: RankedCompetitorIntelItem[] = [];

  for (const competitor of competitors) {
    const queries = buildCompetitorQueries(competitor, maxGeneratedQueries);
    const tokenPool = tokenizedSignalPool(competitor, queries);

    // High-recall internal retrieval from all curated categories, not only product_news.
    const internalCandidates = internalItems
      .map((item) => ({
        item,
        score: internalRetrievalScore(item, competitor, tokenPool),
      }))
      .filter((x) => x.score >= 2.1)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.max(80, queries.length * 10))
      .map((x) => toCandidateFromFeed(x.item, competitor.id, x.score));

    const webQueryLimit =
      options.maxWebQueriesPerCompetitor != null
        ? options.maxWebQueriesPerCompetitor
        : competitor.tier <= 1
          ? Math.min(4, maxGeneratedQueries)
          : competitor.tier === 2
            ? Math.min(4, maxGeneratedQueries)
            : Math.min(2, maxGeneratedQueries);
    const webCandidates = await retrieveWebDocs(
      competitor,
      queries,
      webDocsPerQuery,
      Math.min(webQueryLimit, maxWebQueriesPerCompetitor),
      periodDays,
    );
    const strategicBackfill = await retrieveStrategicBackfillDocs(competitor, periodDays, 8);
    const strategicUrlBackfill = await retrieveStrategicUrlBackfillDocs(competitor, periodDays, 6);
    const recentDomainDocs = await retrieveRecentDomainDocs(competitor, periodDays, 10);
    const blogFromWeb = await retrieveCompetitorBlogFromWeb(competitor, periodDays, 16);
    const blogListing = await retrieveRecentBlogListing(competitor, 20);

    // Strict attribution:
    // - explicit competitor signal, OR
    // - primary source domain owned by that competitor.
    // Do NOT keep generic overlap-only items for a competitor.
    const hydratedByDb = await hydratePublishedDates(
      dedupeDocs([
        ...internalCandidates,
        ...webCandidates,
        ...strategicBackfill,
        ...strategicUrlBackfill,
        ...recentDomainDocs,
        ...blogFromWeb,
        ...blogListing,
      ]),
    );
    const hydrated = await hydratePublishedDatesFromMetadata(hydratedByDb, periodDays);
    const deduped = hydrated.filter((doc) => {
      if (looksNoisyCompetitorUrl(doc.url)) return false;
      const ownDomain = domainMatchesCompetitor(doc.url, competitor);
      if (doc.source_type === "community") return false;
      if (isNarrativeNoise(doc)) return false;
      if (isThirdPartyHowToNoise(doc)) return false;
      const operationalNoise = isOperationalTelemetryUpdate(`${doc.title} ${doc.summary} ${doc.content} ${doc.url}`);
      if (operationalNoise && periodDays <= 31) return false;
      if (!shouldKeepUndatedDoc(doc, periodDays, ownDomain)) return false;
      if (!isWithinWindow(doc.publishedAt, periodDays)) return false;
      if (!ownDomain && !hasMaterialSignal(doc)) return false;
      const identityMatch = mentionsCompetitorIdentity(doc, competitor);
      const strongIdentityMatch = mentionsCompetitorIdentityInTitle(doc, competitor);
      const isOtherCompetitorDomain =
        !ownDomain && domainMatchesAnyTrackedCompetitor(doc.url, competitors);

      // Must be explicitly about this competitor (identity mention) or come from
      // the competitor's own primary domain. Suppress cross-assignment from other
      // tracked competitor domains.
      if (isOtherCompetitorDomain && !ownDomain) return false;
      return ownDomain || strongIdentityMatch || (identityMatch && /(benchmark|swe[\s-]?bench|case study|customer|pricing|packaging|enterprise)/i.test(`${doc.title} ${doc.summary}`));
    });

    const clusters = clusterDocs(deduped, competitor);
    const ranked = clusters
      .map(toRankedIntel)
      .filter((item) => item.relevance_score >= 1.5)
      .sort((a, b) => b.relevance_score - a.relevance_score);
    const diversified = diversifyPerCompetitor(ranked, topPerCompetitor);

    allRanked.push(...diversified);
  }

  const globallyRanked = dedupeRankedEvents(allRanked.sort((a, b) => b.relevance_score - a.relevance_score));
  const postProcessed = postProcessCompetitorIntelItems(globallyRanked);
  return capOverallPerCompetitor(postProcessed, topOverall);
}
