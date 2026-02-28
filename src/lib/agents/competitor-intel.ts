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
  detectCompetitorSignals,
  getCompetitorIntelEntries,
  getDomainFromUrl,
  type CompetitorIntelEntry,
  type IntelSourceType,
} from "../../config/competitor-intel";

export interface RankedCompetitorIntelItem {
  competitor: string;
  date: string | null;
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
  evidence_notes: string[];
  debug_scores: Record<string, number>;
}

interface CandidateDoc {
  competitorId: string;
  title: string;
  summary: string;
  content: string;
  url: string;
  source: string;
  source_type: IntelSourceType;
  publishedAt?: Date;
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
  if (/(ga|general availability|launch|preview|beta|release notes|changelog)/.test(t)) return "product_launch";
  if (/(pricing|package|packaging|tier|enterprise plan)/.test(t)) return "pricing_packaging";
  if (/(case study|customer|benchmark|fortune 500)/.test(t)) return "market_proof";
  if (/(security|compliance|audit|policy|rbac|sso|self-hosted|on-prem)/.test(t)) return "security_enterprise";
  return "product_update";
}

function confidenceLevel(sourceType: IntelSourceType, docsCount: number): "high" | "medium" | "low" {
  if (sourceType === "primary" && docsCount >= 1) return "high";
  if (sourceType === "internal_curated" || sourceType === "secondary") return "medium";
  return "low";
}

function threatLevel(score: number): "high" | "medium" | "low" | "negative" {
  if (score >= 4.2) return "high";
  if (score >= 3.0) return "medium";
  if (score >= 2.0) return "low";
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
  const overlap = classifyOverlapWithSourcegraph(text);

  const direct_overlap = Math.max(1, Math.min(5, overlap.length));
  const agent_mcp_overlap = overlap.some((s) => s === "mcp" || s === "agent_context") ? 5 : 1;
  const enterprise_relevance = overlap.some((s) => s === "enterprise_control" || s === "governance") ? 5 : 2;
  const product_materiality = /(ga|general availability|launch|preview|beta|release|pricing|packaging|tier)/i.test(text) ? 4.2 : 2.4;
  const market_signal = /(case study|customer|benchmark|fortune 500)/i.test(text) ? 3 : 1.5;
  const novelty = noveltyScore(rep.publishedAt);
  const source_quality = rep.source_type === "primary" ? 5 : rep.source_type === "internal_curated" ? 4.5 : rep.source_type === "secondary" ? 3 : 1.5;
  const evidence_strength = Math.min(5, 2 + cluster.docs.length);
  const actionability = direct_overlap >= 3 || enterprise_relevance >= 4 ? 5 : 2;
  const generic_news_penalty = overlap.length === 0 ? -4 : 0;

  const final_score =
    0.24 * direct_overlap +
    0.14 * agent_mcp_overlap +
    0.14 * enterprise_relevance +
    0.14 * product_materiality +
    0.08 * market_signal +
    0.1 * novelty +
    0.08 * source_quality +
    0.04 * evidence_strength +
    0.04 * actionability +
    generic_news_penalty;

  return {
    direct_overlap,
    agent_mcp_overlap,
    enterprise_relevance,
    product_materiality,
    market_signal,
    novelty,
    source_quality,
    evidence_strength,
    actionability,
    duplication_penalty: 0,
    generic_news_penalty,
    final_score,
  };
}

function whyItMatters(competitor: CompetitorIntelEntry, overlap: string[], score: Record<string, number>): string {
  const surfaces = overlap.length > 0 ? overlap.join(", ") : "adjacent workflow surfaces";
  const functions: string[] = [];
  if (score.enterprise_relevance >= 4) functions.push("sales");
  if (score.direct_overlap >= 3) functions.push("product", "messaging");
  if (functions.length === 0) functions.push("exec awareness");

  const net = threatLevel(score.final_score);
  return `what changed: competitor published a material update tied to ${surfaces}; which Sourcegraph surface it overlaps with: ${surfaces}; whether this affects sales, product, messaging, or exec awareness: ${Array.from(new Set(functions)).join(", ")}; whether this is a net threat, neutral development, or competitor weakness: ${net}.`;
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

  const overlap = classifyOverlapWithSourcegraph(text).length;
  const recency = noveltyScore(item.publishedAt);

  return (competitorMention ? 2.5 : 0.6) + overlap * 0.8 + signalMatches * 0.08 + recency * 0.3;
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
    retrievalScore,
  };
}

async function retrieveWebDocs(
  competitor: CompetitorIntelEntry,
  queries: string[],
  webDocsPerQuery: number,
  maxQueries: number,
): Promise<CandidateDoc[]> {
  const docs: CandidateDoc[] = [];
  for (const query of queries.slice(0, maxQueries)) {
    const q = query.toLowerCase();
    const isNarrativeQuery = /(benchmark|swe-?bench|case study|customer|pricing|packaging|enterprise)/.test(q);
    const results = await searchWeb(query, {
      numResults: webDocsPerQuery,
      domains: competitor.domains,
      // "general" captures primary docs/changelogs/blog posts better than "news"
      // for competitive intel workflows.
      topic: "general",
      // Keep recency bias for routine queries, but allow older narrative-defining
      // benchmark/pricing/case-study pages to surface.
      timeRange: isNarrativeQuery ? undefined : "year",
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
        retrievalScore: (result.score ?? 0.5) * 2,
      });
    }
  }
  return docs;
}

async function retrieveStrategicBackfillDocs(
  competitor: CompetitorIntelEntry,
  limit = 8,
): Promise<CandidateDoc[]> {
  const queries = [
    `${competitor.display_name} benchmark swe bench`,
    `${competitor.display_name} case study customer enterprise`,
    `${competitor.display_name} pricing packaging enterprise`,
  ];
  const byUrl = new Map<string, CandidateDoc>();

  for (const query of queries) {
    const rows = await dbFullTextSearch(query, { period: "all", limit: Math.max(12, limit * 2) });
    for (const row of rows) {
      if (!row.url || !row.title) continue;
      if (!domainMatchesCompetitor(row.url, competitor)) continue;

      const text = `${row.title} ${row.summary ?? ""} ${row.contentSnippet ?? ""}`.toLowerCase();
      if (!/(benchmark|swe[\s-]?bench|case study|customer|pricing|packaging|enterprise)/.test(text)) continue;

      const domain = getDomainFromUrl(row.url);
      const sourceType = classifySourceTypeByDomain(domain);
      const scoreBoost = /(benchmark|swe[\s-]?bench)/.test(text) ? 4.2 : 3.2;

      byUrl.set(row.url, {
        competitorId: competitor.id,
        title: row.title,
        summary: row.summary ?? row.contentSnippet ?? "",
        content: row.contentSnippet ?? row.summary ?? "",
        url: row.url,
        source: domain || row.sourceTitle || "unknown",
        source_type: sourceType === "secondary" ? "internal_curated" : sourceType,
        publishedAt: row.publishedAt ? new Date(row.publishedAt * 1000) : undefined,
        retrievalScore: scoreBoost,
      });
      if (byUrl.size >= limit) break;
    }
    if (byUrl.size >= limit) break;
  }

  return Array.from(byUrl.values());
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

function domainMatchesCompetitor(url: string, competitor: CompetitorIntelEntry): boolean {
  const domain = getDomainFromUrl(url);
  if (!domain) return false;
  return competitor.domains.some((d) => {
    const base = d.toLowerCase();
    return domain === base || domain.endsWith(`.${base}`);
  });
}

function compactSummary(text: string, maxLen = 900): string {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, maxLen)}...`;
}

function toRankedIntel(cluster: EventCluster): RankedCompetitorIntelItem {
  const rep = cluster.representative;
  const text = `${rep.title} ${rep.summary} ${rep.content}`;
  const overlap = classifyOverlapWithSourcegraph(text);
  const scores = clusterScore(cluster);
  const tl = threatLevel(scores.final_score);

  const actionability = [
    scores.enterprise_relevance >= 4 ? "sales" : null,
    scores.direct_overlap >= 3 ? "product" : null,
    scores.direct_overlap >= 3 ? "messaging" : null,
    tl === "high" ? "exec" : null,
  ].filter((x): x is string => Boolean(x));

  return {
    competitor: cluster.competitor.display_name,
    date: rep.publishedAt ? rep.publishedAt.toISOString().slice(0, 10) : null,
    title: rep.title,
    source: rep.source,
    source_type: rep.source_type,
    url: rep.url,
    update_type: inferUpdateType(text),
    overlap_with_sourcegraph: overlap,
    summary: compactSummary(rep.summary || rep.title),
    why_it_matters: whyItMatters(cluster.competitor, overlap, scores),
    threat_level: tl,
    confidence: confidenceLevel(rep.source_type, cluster.docs.length),
    novelty_score: Number(scores.novelty.toFixed(2)),
    relevance_score: Number(scores.final_score.toFixed(2)),
    actionability: actionability.length > 0 ? actionability : ["monitoring"],
    evidence_notes: [
      `Underlying event: ${cluster.canonicalTitle}`,
      `Representative source type: ${rep.source_type}`,
      `Supporting docs in cluster: ${cluster.docs.length}`,
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
            ? Math.min(3, maxGeneratedQueries)
            : Math.min(2, maxGeneratedQueries);
    const webCandidates = await retrieveWebDocs(
      competitor,
      queries,
      webDocsPerQuery,
      Math.min(webQueryLimit, maxWebQueriesPerCompetitor),
    );
    const strategicBackfill = await retrieveStrategicBackfillDocs(competitor, 8);

    // Strict attribution:
    // - explicit competitor signal, OR
    // - primary source domain owned by that competitor.
    // Do NOT keep generic overlap-only items for a competitor.
    const deduped = dedupeDocs([...internalCandidates, ...webCandidates, ...strategicBackfill]).filter((doc) => {
      const signals = detectCompetitorSignals(`${doc.title} ${doc.summary} ${doc.content}`);
      return signals.competitorIds.includes(competitor.id) || domainMatchesCompetitor(doc.url, competitor);
    });

    const clusters = clusterDocs(deduped, competitor);
    const ranked = clusters
      .map(toRankedIntel)
      .filter((item) => item.relevance_score >= 2)
      .sort((a, b) => b.relevance_score - a.relevance_score)
      .slice(0, topPerCompetitor);

    allRanked.push(...ranked);
  }

  return allRanked.sort((a, b) => b.relevance_score - a.relevance_score).slice(0, topOverall);
}
