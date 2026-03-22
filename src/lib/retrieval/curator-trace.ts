/**
 * Shared, versioned trace types for curator agents (content ideas, market brief, competitor intel, etc.)
 * so retrieval + ranking can be audited, compared across runs, and reused when tuning pipelines.
 */

import type { AgentGoal } from "../../config/agents";
import { getAgentGoalConfig } from "../../config/agents";
/** Mirrors `RetrievalSource` in agentRetrieval (keeps this module free of circular imports). */
export type RankingDocSource = "postgres_items" | "postgres_papers" | "web";

/** Bump when changing trace shape (UI/API consumers). */
export const CURATOR_TRACE_SCHEMA_VERSION = 1 as const;

/** Snapshot of goal config at retrieval time (interpretable, no secrets). */
export interface GoalConfigSnapshot {
  goal: AgentGoal;
  primaryCategories: string[];
  timeHorizonDays: number;
  maxPostgresDocs: number;
  maxWebDocs: number;
  postgresWeight: number;
  webWeight: number;
  rankingProfile: {
    baseScoreWeight: number;
    competitorMatchWeight: number;
    icpMatchWeight: number;
    formatTypeWeight: number;
    recencyWeight: number;
    trendLandscapeWeight?: number;
  };
  blockedDomainsCount: number;
  excludeSelfDomainsCount: number;
  webQueryTemplateCount: number;
  postgresQueryTermCount: number;
  includeDomainsCount: number;
}

export function captureGoalConfigSnapshot(goal: AgentGoal): GoalConfigSnapshot {
  const c = getAgentGoalConfig(goal);
  return {
    goal,
    primaryCategories: [...c.primaryCategories],
    timeHorizonDays: c.timeHorizonDays,
    maxPostgresDocs: c.retrievalStrategies.maxPostgresDocs,
    maxWebDocs: c.retrievalStrategies.maxWebDocs,
    postgresWeight: c.retrievalStrategies.postgresWeight,
    webWeight: c.retrievalStrategies.webWeight,
    rankingProfile: { ...c.rankingProfile },
    blockedDomainsCount: c.blockedDomains?.length ?? 0,
    excludeSelfDomainsCount: c.excludeSelfDomains?.length ?? 0,
    webQueryTemplateCount: c.webQueryTemplates.length,
    postgresQueryTermCount: c.postgresQueryTerms.length,
    includeDomainsCount: c.includeDomains?.length ?? 0,
  };
}

/** Top-ranked docs after `rankForAgent` (sample for audit; full pool size in `totalRanked`). */
export interface AgentRankingTrace {
  schemaVersion: typeof CURATOR_TRACE_SCHEMA_VERSION;
  goal: AgentGoal;
  totalRanked: number;
  sampleSize: number;
  documents: Array<{
    rank: number;
    id?: string;
    url?: string;
    title: string;
    source: RankingDocSource;
    baseScore: number;
    goalScore: number;
    agentScore: number;
  }>;
}

export function createEmptyRankingTrace(
  goal: AgentGoal,
  sampleSize: number
): AgentRankingTrace {
  return {
    schemaVersion: CURATOR_TRACE_SCHEMA_VERSION,
    goal,
    totalRanked: 0,
    sampleSize,
    documents: [],
  };
}

/** Ordered, human-readable steps derived from a retrieval trace (for UI / logs). */
export interface CuratorTraceStep {
  id: string;
  label: string;
  detail: string;
  metrics?: Record<string, number | string>;
}

/** Minimal shape for `retrievalTraceToSteps` (avoids circular imports with agentRetrieval). */
export interface RetrievalTraceForSteps {
  configSnapshot?: GoalConfigSnapshot;
  postgres: {
    categories: Array<{ category: string; itemsLoaded: number; perCategoryCap: number }>;
    fts?: { query: string; period: string; limit: number; hits: number };
  };
  web: {
    timeRange?: string;
    queries: unknown[];
  };
  merge: {
    postgresIn: number;
    webIn: number;
    mergedUnique: number;
    postgresCappedTo: number;
    webCappedTo: number;
    blockedDropped: { postgres: number; web: number };
    dedupedByIdOrUrl: number;
    caps?: { maxPostgresDocs: number; maxWebDocs: number };
    countsMerged?: { postgres: number; web: number };
  };
  date: {
    cutoffIso: string;
    beforeFilter: number;
    afterHydrate: number;
    afterFilter: number;
    droppedMissingDate?: number;
    droppedTooOld?: number;
    inferredDatesApplied?: number;
  };
}

export function retrievalTraceToSteps(trace: RetrievalTraceForSteps): CuratorTraceStep[] {
  const steps: CuratorTraceStep[] = [];

  if (trace.configSnapshot) {
    const c = trace.configSnapshot;
    steps.push({
      id: "config",
      label: "Goal configuration",
      detail: `${c.goal} · ${c.primaryCategories.length} categories · horizon ${c.timeHorizonDays}d · caps pg ${c.maxPostgresDocs} / web ${c.maxWebDocs}`,
      metrics: {
        maxPostgresDocs: c.maxPostgresDocs,
        maxWebDocs: c.maxWebDocs,
        blockedDomains: c.blockedDomainsCount,
      },
    });
  }

  const pgCats = trace.postgres.categories;
  if (pgCats.length > 0) {
    steps.push({
      id: "postgres_categories",
      label: "Postgres: per-category load",
      detail: pgCats.map((x) => `${x.category}: ${x.itemsLoaded}/${x.perCategoryCap}`).join(" · "),
      metrics: Object.fromEntries(pgCats.map((x) => [`cat_${x.category}`, x.itemsLoaded])),
    });
  }

  if (trace.postgres.fts) {
    const fts = trace.postgres.fts;
    steps.push({
      id: "postgres_fts",
      label: "Postgres: full-text search",
      detail: `${fts.hits} hits · period ${fts.period} · limit ${fts.limit}`,
      metrics: { hits: fts.hits, limit: fts.limit },
    });
  }

  steps.push({
    id: "web_queries",
    label: "Web search",
    detail: `${trace.web.queries.length} query batches${trace.web.timeRange ? ` · timeRange ${trace.web.timeRange}` : ""}`,
    metrics: { queryBatches: trace.web.queries.length },
  });

  const m = trace.merge;
  const caps = m.caps;
  const capLabel = caps
    ? `caps pg ${caps.maxPostgresDocs} / web ${caps.maxWebDocs}`
    : `legacy caps pg ${m.postgresCappedTo} / web ${m.webCappedTo}`;

  steps.push({
    id: "merge",
    label: "Merge & dedupe",
    detail: `In: pg ${m.postgresIn} · web ${m.webIn} · unique ${m.mergedUnique} · ${capLabel} · domain-blocked pg ${m.blockedDropped.postgres}/web ${m.blockedDropped.web} · dedup skips ${m.dedupedByIdOrUrl}`,
    metrics: {
      mergedUnique: m.mergedUnique,
      deduped: m.dedupedByIdOrUrl,
    },
  });

  if (m.countsMerged) {
    steps.push({
      id: "merge_counts",
      label: "Merged map by source",
      detail: `Postgres docs in map: ${m.countsMerged.postgres} · Web docs in map: ${m.countsMerged.web}`,
      metrics: { postgresInMap: m.countsMerged.postgres, webInMap: m.countsMerged.web },
    });
  }

  const d = trace.date;
  steps.push({
    id: "date_gate",
    label: "Date filter",
    detail: `${d.beforeFilter} → hydrate → ${d.afterHydrate} → ${d.afterFilter} after cutoff (${d.cutoffIso})`,
    metrics: {
      droppedMissingDate: d.droppedMissingDate ?? 0,
      droppedTooOld: d.droppedTooOld ?? 0,
      inferredDates: d.inferredDatesApplied ?? 0,
    },
  });

  return steps;
}

export function rankingTraceToSteps(rt: AgentRankingTrace): CuratorTraceStep[] {
  return [
    {
      id: "ranking",
      label: "Ranking",
      detail: `goal ${rt.goal} · ${rt.totalRanked} docs ranked · sample top ${rt.sampleSize}`,
      metrics: { totalRanked: rt.totalRanked, sampleSize: rt.sampleSize },
    },
    ...rt.documents.slice(0, 5).map((doc) => ({
      id: `rank_${doc.rank}`,
      label: `#${doc.rank} ${doc.title.slice(0, 48)}${doc.title.length > 48 ? "…" : ""}`,
      detail: `agent ${doc.agentScore.toFixed(3)} · base ${doc.baseScore.toFixed(3)} · ${doc.source}`,
      metrics: { agentScore: doc.agentScore, baseScore: doc.baseScore },
    })),
  ];
}
