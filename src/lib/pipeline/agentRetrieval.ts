/**
 * Multi-source retrieval for specialized agents.
 * Combines Postgres (items) and web search, with merge/dedup and optional full-text enrichment.
 */

import type { AgentGoal } from "../../config/agents";
import { getAgentGoalConfig } from "../../config/agents";
import { getCompetitorDomains } from "../../config/competitors";
import { loadItemsByCategory } from "../db/items";
import { dbFullTextSearch } from "../db/search";
import type { FeedItem } from "../model";
import { fetchFullText } from "./fulltext";
import { logger } from "../logger";
import { searchWeb } from "../retrieval/webSearch";
import {
  captureGoalConfigSnapshot,
  CURATOR_TRACE_SCHEMA_VERSION,
  type GoalConfigSnapshot,
} from "../retrieval/curator-trace";

export type RetrievalSource = "postgres_items" | "postgres_papers" | "web";

export interface RetrievedDoc {
  id?: string;
  source: RetrievalSource;
  url?: string;
  title: string;
  snippet?: string;
  content?: string;
  publishedAt?: Date;
  metadata: Record<string, unknown>;
}

export interface RetrieveForAgentOptions {
  periodDays?: number;
  query?: string | null;
  /** Enrich Postgres docs that lack full text by fetching from URL (max N to avoid slowdown) */
  maxEnrich?: number;
  /**
   * When set, populate this object with step-by-step retrieval diagnostics (queries, counts, merges).
   * Intended for debugging/tuning pipelines; keep off in normal user-facing flows.
   */
  trace?: AgentRetrievalTrace | null;
}

export interface AgentRetrievalTrace {
  /** Aligns with `CURATOR_TRACE_SCHEMA_VERSION` in `curator-trace.ts`. */
  schemaVersion?: number;
  /** Goal config at run time (categories, caps, weights) — for cross-run comparison. */
  configSnapshot?: GoalConfigSnapshot;
  goal: AgentGoal;
  periodDays: number;
  effectiveQuery?: string;
  postgres: {
    categories: Array<{ category: string; itemsLoaded: number; perCategoryCap: number }>;
    fts?: { query: string; period: "day" | "week" | "month" | "all"; limit: number; hits: number };
  };
  web: {
    timeRange?: "day" | "week" | "month" | "year";
    competitorDomains?: number;
    queries: Array<{
      query: string;
      topic: "news" | "general";
      numResults: number;
      domains?: number;
      hits: number;
      kind: "primary" | "include_domains";
    }>;
  };
  merge: {
    postgresIn: number;
    webIn: number;
    mergedUnique: number;
    /**
     * @deprecated Same as `caps.maxPostgresDocs` — kept for backward compatibility with saved JSON.
     * Was misread as “count capped to”; it is the configured cap.
     */
    postgresCappedTo: number;
    /**
     * @deprecated Same as `caps.maxWebDocs`.
     */
    webCappedTo: number;
    /** Configured per-source ceilings (from `retrievalStrategies`). */
    caps?: { maxPostgresDocs: number; maxWebDocs: number };
    /** Docs that survived merge into the dedupe map (by primary source). */
    countsMerged?: { postgres: number; web: number };
    /** Dropped by blockedDomains / excludeSelfDomains before merge. */
    blockedDropped: { postgres: number; web: number };
    dedupedByIdOrUrl: number;
  };
  date: {
    cutoffIso: string;
    requirePublishedDate: boolean;
    beforeFilter: number;
    afterHydrate: number;
    afterFilter: number;
    droppedMissingDate?: number;
    droppedTooOld?: number;
    inferredDatesApplied?: number;
  };
}

export type { GoalConfigSnapshot } from "../retrieval/curator-trace";

/** Map periodDays to FTS period. Use "month" for 8–90 days so we never pass "all" when user requested a time window. */
function periodDaysToFtsPeriod(periodDays: number): "day" | "week" | "month" | "all" {
  if (periodDays <= 1) return "day";
  if (periodDays <= 7) return "week";
  if (periodDays <= 90) return "month";
  return "all";
}

/** Map periodDays to web search timeRange. Undefined = no filter (provider may return any date). */
function periodDaysToWebTimeRange(
  periodDays: number
): "day" | "week" | "month" | "year" | undefined {
  if (periodDays <= 1) return "day";
  if (periodDays <= 7) return "week";
  if (periodDays <= 30) return "month";
  if (periodDays <= 365) return "year";
  return undefined;
}

/**
 * Load items from Postgres for the given goal: categories + time window from config,
 * optionally filtered by a search query.
 */
async function retrieveFromPostgres(
  goal: AgentGoal,
  options: RetrieveForAgentOptions
): Promise<RetrievedDoc[]> {
  const config = getAgentGoalConfig(goal);
  const periodDays = options.periodDays ?? config.timeHorizonDays;
  const maxDocs = config.retrievalStrategies.maxPostgresDocs;
  const perCategory = Math.max(5, Math.ceil(maxDocs / config.primaryCategories.length));
  const effectiveQuery =
    options.query?.trim() ||
    config.postgresQueryTerms.slice(0, 8).join(" ");

  const trace = options.trace ?? null;
  if (trace) {
    trace.effectiveQuery = effectiveQuery;
    trace.postgres.categories = [];
  }

  const byId = new Map<string, RetrievedDoc>();

  for (const category of config.primaryCategories) {
    const items = await loadItemsByCategory(category, periodDays);
    const ordered = items.slice(0, perCategory);
    trace?.postgres.categories.push({
      category,
      itemsLoaded: ordered.length,
      perCategoryCap: perCategory,
    });
    for (const item of ordered) {
      if (byId.has(item.id)) continue;
      byId.set(item.id, feedItemToRetrievedDoc(item));
    }
  }

  if (effectiveQuery) {
    const period = periodDaysToFtsPeriod(periodDays);
    const ftsLimit = Math.ceil(maxDocs / 2);
    const searchResults = await dbFullTextSearch(effectiveQuery, {
      period,
      limit: ftsLimit,
    });
    if (trace) {
      trace.postgres.fts = { query: effectiveQuery, period, limit: ftsLimit, hits: searchResults.length };
    }
    for (const r of searchResults) {
      if (byId.has(r.id)) continue;
      byId.set(r.id, {
        id: r.id,
        source: "postgres_items",
        url: r.url,
        title: r.title,
        snippet: r.headline ?? r.summary ?? r.contentSnippet ?? undefined,
        publishedAt: new Date(r.publishedAt * 1000),
        metadata: { sourceTitle: r.sourceTitle, category: r.category, score: r.score },
      });
    }
  }

  const list = Array.from(byId.values());
  logger.info("Postgres retrieval for agent", {
    goal,
    periodDays,
    docCount: list.length,
  });
  return list;
}

function feedItemToRetrievedDoc(item: FeedItem): RetrievedDoc {
  const snippet = item.summary || item.contentSnippet;
  return {
    id: item.id,
    source: "postgres_items",
    url: item.url,
    title: item.title,
    snippet: snippet ?? undefined,
    content: item.fullText,
    publishedAt: item.publishedAt,
    metadata: {
      sourceTitle: item.sourceTitle,
      category: item.category,
      streamId: item.streamId,
    },
  };
}

/**
 * Run web search with goal-specific queries and optional domain filter.
 */
async function retrieveFromWeb(
  goal: AgentGoal,
  options: RetrieveForAgentOptions
): Promise<RetrievedDoc[]> {
  const config = getAgentGoalConfig(goal);
  const maxWeb = config.retrievalStrategies.maxWebDocs;
  const templates = config.webQueryTemplates;
  // Researcher-style: web discovery is inspired by but not limited by Postgres; run more diverse queries for brief and content ideas
  const templateLimit =
    goal === "competitor_intel"
      ? Math.min(templates.length, 8)
      : goal === "market_brief" || goal === "content_ideas"
        ? Math.min(templates.length, 8)
        : 4;
  const queries =
    options.query?.trim()
      ? [options.query, ...templates.slice(0, 2)]
      : templates.slice(0, templateLimit);

  const domains =
    goal === "competitor_intel" ? getCompetitorDomains() : undefined;
  const numPerQuery = Math.max(3, Math.ceil(maxWeb / queries.length));

  const byUrl = new Map<string, RetrievedDoc>();

  const effectivePeriodDays = options.periodDays ?? config.timeHorizonDays;
  const timeRange = periodDaysToWebTimeRange(effectivePeriodDays);
  const trace = options.trace ?? null;
  if (trace) {
    trace.web.timeRange = timeRange;
    trace.web.competitorDomains = domains?.length;
    trace.web.queries = [];
  }

  for (const q of queries) {
    if (byUrl.size >= maxWeb) break;
    const results = await searchWeb(q, {
      numResults: numPerQuery,
      domains: domains?.slice(0, 100),
      topic: goal === "market_brief" ? "news" : "general",
      timeRange,
    });
    trace?.web.queries.push({
      query: q,
      topic: goal === "market_brief" ? "news" : "general",
      numResults: numPerQuery,
      domains: domains ? Math.min(100, domains.length) : undefined,
      hits: results.length,
      kind: "primary",
    });
    for (const r of results) {
      const key = normalizeUrl(r.url);
      if (byUrl.has(key)) continue;
      byUrl.set(key, {
        source: "web",
        url: r.url,
        title: r.title,
        snippet: r.content,
        content: r.content,
        publishedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
        metadata: { score: r.score },
      });
    }
  }

  // Optional pass: include our product (e.g. changelog, product pages) for content_ideas.
  const includeDomains = config.includeDomains;
  const includeTemplates = config.includeDomainsQueryTemplates;
  if (
    includeDomains?.length &&
    includeTemplates?.length &&
    byUrl.size < maxWeb
  ) {
    const maxInclude = Math.min(10, maxWeb - byUrl.size);
    const numPerInclude = Math.max(2, Math.ceil(maxInclude / includeTemplates.length));
    for (const q of includeTemplates.slice(0, 4)) {
      if (byUrl.size >= maxWeb) break;
      const results = await searchWeb(q, {
        numResults: numPerInclude,
        domains: includeDomains.slice(0, 20),
        topic: "general",
        timeRange,
      });
      trace?.web.queries.push({
        query: q,
        topic: "general",
        numResults: numPerInclude,
        domains: Math.min(20, includeDomains.length),
        hits: results.length,
        kind: "include_domains",
      });
      for (const r of results) {
        const key = normalizeUrl(r.url);
        if (byUrl.has(key)) continue;
        byUrl.set(key, {
          source: "web",
          url: r.url,
          title: r.title,
          snippet: r.content,
          content: r.content,
          publishedAt: r.publishedDate ? new Date(r.publishedDate) : undefined,
          metadata: { score: r.score, primarySource: "include_domains" },
        });
      }
    }
    logger.info("Web retrieval includeDomains pass", {
      goal,
      domains: includeDomains.length,
    });
  }

  const list = Array.from(byUrl.values()).slice(0, maxWeb);
  logger.info("Web retrieval for agent", { goal, docCount: list.length });
  return list;
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    u.search = "";
    return u.href.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

function parseDateLike(raw: string | undefined): Date | undefined {
  if (!raw) return undefined;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return undefined;
  return parsed;
}

function inferDateFromDocText(doc: RetrievedDoc): Date | undefined {
  // Keep inference conservative: URL/title/snippet often contain publication dates,
  // while full content frequently mentions historical dates that should not age out a fresh post.
  const text = `${doc.url ?? ""} ${doc.title} ${doc.snippet ?? ""}`;
  const patterns = [
    /\b(20\d{2})[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/,
    /\b(20\d{2})(0[1-9]|1[0-2])([0-2]\d|3[01])\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\s+([0-2]?\d|3[01]),?\s+(20\d{2})\b/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) continue;
    const parsed = parseDateLike(match[0]);
    if (parsed) return parsed;
  }

  return undefined;
}

/**
 * Choose a conservative effective date for filtering:
 * - Use provider date when it's the only signal.
 * - If text/URL contains an explicit date and it is older than provider date,
 *   prefer the older date to avoid "freshened" evergreen pages leaking into short windows.
 */
export function effectivePublishedAtForFiltering(doc: RetrievedDoc): Date | undefined {
  const inferred = inferDateFromDocText(doc);
  if (!doc.publishedAt) return inferred;
  if (!inferred) return doc.publishedAt;
  return inferred.getTime() < doc.publishedAt.getTime() ? inferred : doc.publishedAt;
}

/** Return true if url's host equals or ends with any of the given domains (e.g. instagram.com matches www.instagram.com). */
function urlHostInList(url: string | undefined, domains: string[]): boolean {
  if (!url || domains.length === 0) return false;
  try {
    const host = new URL(url).hostname.toLowerCase();
    return domains.some((d) => host === d || host.endsWith("." + d));
  } catch {
    return false;
  }
}

/** Filter out docs whose URL is in blocked or exclude-self lists for this goal. */
function filterDocsByDomain(
  docs: RetrievedDoc[],
  goal: AgentGoal
): RetrievedDoc[] {
  const config = getAgentGoalConfig(goal);
  const blocked = config.blockedDomains ?? [];
  const excludeSelf = config.excludeSelfDomains ?? [];
  return docs.filter((doc) => {
    if (urlHostInList(doc.url, blocked)) return false;
    if (urlHostInList(doc.url, excludeSelf)) return false;
    return true;
  });
}

/**
 * Merge and deduplicate Postgres + web results. Dedup by canonical URL and by id.
 * Applies per-source caps, filters blocked/excludeSelf domains, and marks primarySource.
 */
export function mergeRetrievedDocs(
  postgresDocs: RetrievedDoc[],
  webDocs: RetrievedDoc[],
  goal: AgentGoal,
  trace?: AgentRetrievalTrace | null
): RetrievedDoc[] {
  const config = getAgentGoalConfig(goal);
  const maxPostgres = config.retrievalStrategies.maxPostgresDocs;
  const maxWeb = config.retrievalStrategies.maxWebDocs;

  const filteredPostgres = filterDocsByDomain(postgresDocs, goal);
  const filteredWeb = filterDocsByDomain(webDocs, goal);
  const postgresBlockedDropped = postgresDocs.length - filteredPostgres.length;
  const webBlockedDropped = webDocs.length - filteredWeb.length;

  const byKey = new Map<string, RetrievedDoc>();
  const seenUrls = new Set<string>();
  let deduped = 0;

  let postgresMergedCount = 0;
  let webMergedCount = 0;

  for (const doc of filteredPostgres.slice(0, maxPostgres)) {
    const key = doc.id ?? `url:${doc.url ? normalizeUrl(doc.url) : doc.title}`;
    if (byKey.has(key)) {
      deduped++;
      continue;
    }
    const urlKey = doc.url ? normalizeUrl(doc.url) : "";
    if (urlKey && seenUrls.has(urlKey)) {
      deduped++;
      continue;
    }
    if (urlKey) seenUrls.add(urlKey);
    byKey.set(key, { ...doc, metadata: { ...doc.metadata, primarySource: "postgres" } });
    postgresMergedCount++;
  }

  for (const doc of filteredWeb.slice(0, maxWeb)) {
    const urlKey = doc.url ? normalizeUrl(doc.url) : "";
    const key = urlKey || `web:${doc.title}`;
    if (byKey.has(key) || (urlKey && seenUrls.has(urlKey))) {
      deduped++;
      continue;
    }
    if (urlKey) seenUrls.add(urlKey);
    byKey.set(key, { ...doc, metadata: { ...doc.metadata, primarySource: "web" } });
    webMergedCount++;
  }

  if (trace) {
    trace.merge.postgresIn = postgresDocs.length;
    trace.merge.webIn = webDocs.length;
    trace.merge.postgresCappedTo = maxPostgres;
    trace.merge.webCappedTo = maxWeb;
    trace.merge.caps = { maxPostgresDocs: maxPostgres, maxWebDocs: maxWeb };
    trace.merge.countsMerged = { postgres: postgresMergedCount, web: webMergedCount };
    trace.merge.mergedUnique = byKey.size;
    trace.merge.blockedDropped = { postgres: postgresBlockedDropped, web: webBlockedDropped };
    trace.merge.dedupedByIdOrUrl = deduped;
  }

  return Array.from(byKey.values());
}

/**
 * Enrich docs that have a URL but no or short content by fetching full text (e.g. Readability).
 * Respects maxEnrich to avoid slow requests.
 */
export async function enrichWithFullText(
  docs: RetrievedDoc[],
  maxEnrich: number
): Promise<RetrievedDoc[]> {
  const toEnrich = docs.filter(
    (d) =>
      d.source === "postgres_items" &&
      d.url &&
      !d.url.includes("inoreader.com") &&
      (!d.content || d.content.length < 300)
  );
  const slice = toEnrich.slice(0, maxEnrich);
  const out = [...docs];

  for (const doc of slice) {
    if (!doc.url) continue;
    const minimalItem: FeedItem = {
      id: doc.id ?? doc.url,
      streamId: "",
      sourceTitle: (doc.metadata.sourceTitle as string) ?? "",
      title: doc.title,
      url: doc.url,
      publishedAt: doc.publishedAt ?? new Date(),
      categories: [],
      category: "tech_articles",
      raw: {},
    };
    try {
      const result = await fetchFullText(minimalItem);
      if (result.text && result.length >= 100) {
        const idx = out.findIndex(
          (d) => (d.id && d.id === doc.id) || (d.url === doc.url && d.title === doc.title)
        );
        if (idx >= 0) {
          out[idx] = { ...out[idx], content: result.text };
        }
      }
    } catch (err) {
      logger.debug("Full-text enrichment failed for doc", {
        url: doc.url?.slice(0, 60),
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return out;
}

/**
 * Filter merged docs to only those with publishedAt within the last periodDays.
 * For short windows (<= 31 days), docs without publishedAt are excluded so we don't surface
 * old undated web results in "last month" reports.
 */
function filterRetrievedDocsByDate(
  docs: RetrievedDoc[],
  periodDays: number,
  trace?: AgentRetrievalTrace | null
): RetrievedDoc[] {
  const cutoffMs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const requireDate = periodDays <= 31;
  let droppedMissingDate = 0;
  let droppedTooOld = 0;
  const filtered = docs.filter((doc) => {
    const effectiveDate = effectivePublishedAtForFiltering(doc);
    if (!effectiveDate) {
      if (requireDate) droppedMissingDate++;
      return !requireDate;
    }
    const ok = effectiveDate.getTime() >= cutoffMs;
    if (!ok) droppedTooOld++;
    return ok;
  });
  if (trace) {
    trace.date.droppedMissingDate = droppedMissingDate;
    trace.date.droppedTooOld = droppedTooOld;
  }
  return filtered;
}

function hydrateMissingDates(
  docs: RetrievedDoc[],
  periodDays: number,
  trace?: AgentRetrievalTrace | null
): RetrievedDoc[] {
  // Date filtering is strict for month-or-shorter windows. Infer dates from URL/title/snippet
  // so relevant web/blog results aren't discarded solely because provider metadata is sparse.
  if (periodDays > 31) return docs;

  let inferredCount = 0;
  const out = docs.map((doc) => {
    if (doc.publishedAt) return doc;
    const inferred = inferDateFromDocText(doc);
    if (!inferred) return doc;
    inferredCount++;
    return {
      ...doc,
      publishedAt: inferred,
      metadata: { ...doc.metadata, dateInferred: true },
    };
  });
  if (trace) {
    trace.date.inferredDatesApplied = inferredCount;
  }
  return out;
}

/**
 * Retrieve documents for an agent goal from Postgres and web, then merge and optionally enrich.
 * Respects options.periodDays for date filtering; docs older than that window are dropped after merge.
 */
export async function retrieveForAgent(
  goal: AgentGoal,
  options: RetrieveForAgentOptions = {}
): Promise<RetrievedDoc[]> {
  const config = getAgentGoalConfig(goal);
  const periodDays = options.periodDays ?? config.timeHorizonDays;
  const trace = options.trace;
  if (trace) {
    trace.schemaVersion = CURATOR_TRACE_SCHEMA_VERSION;
    trace.configSnapshot = captureGoalConfigSnapshot(goal);
    trace.goal = goal;
    trace.periodDays = periodDays;
    trace.postgres = trace.postgres ?? { categories: [] };
    trace.web = trace.web ?? { queries: [] };
    trace.merge = trace.merge ?? {
      postgresIn: 0,
      webIn: 0,
      mergedUnique: 0,
      postgresCappedTo: 0,
      webCappedTo: 0,
      blockedDropped: { postgres: 0, web: 0 },
      dedupedByIdOrUrl: 0,
    };
    const cutoffMs = Date.now() - periodDays * 24 * 60 * 60 * 1000;
    trace.date = trace.date ?? {
      cutoffIso: new Date(cutoffMs).toISOString(),
      requirePublishedDate: periodDays <= 31,
      beforeFilter: 0,
      afterHydrate: 0,
      afterFilter: 0,
    };
  }

  const [postgresDocs, webDocs] = await Promise.all([
    retrieveFromPostgres(goal, options),
    retrieveFromWeb(goal, options),
  ]);

  const merged = mergeRetrievedDocs(postgresDocs, webDocs, goal, trace);
  const hydrated = hydrateMissingDates(merged, periodDays, trace);
  if (trace) {
    trace.date.beforeFilter = merged.length;
    trace.date.afterHydrate = hydrated.length;
  }
  const dateFiltered = filterRetrievedDocsByDate(hydrated, periodDays, trace);
  if (trace) {
    trace.date.afterFilter = dateFiltered.length;
  }

  const maxEnrich = options.maxEnrich ?? 0;
  if (maxEnrich > 0) {
    return enrichWithFullText(dateFiltered, maxEnrich);
  }

  return dateFiltered;
}
