/**
 * Goal-aware ranking for agent retrieval.
 * Applies ranking profile weights to base score + goal features.
 */

import type { AgentGoal } from "../../config/agents";
import { getAgentGoalConfig } from "../../config/agents";
import { loadScoresForItems } from "../db/items";
import { logger } from "../logger";
import type { RetrievedDoc } from "./agentRetrieval";
import { computeGoalFeatures, type GoalFeatures } from "./goalFeatures";
import { computeRecencyScore } from "./scoring-utils";
import {
  CURATOR_TRACE_SCHEMA_VERSION,
  type AgentRankingTrace,
} from "../retrieval/curator-trace";

export interface AgentRankedDoc extends RetrievedDoc {
  baseScore: number;
  goalScore: number;
  agentScore: number;
  features: GoalFeatures;
}

const DEFAULT_HALF_LIFE_DAYS = 5;

/**
 * Heuristic base score for docs without DB scores (e.g. web-only).
 * Uses simple term overlap with goal query terms.
 */
function heuristicBaseScore(doc: RetrievedDoc, goal: AgentGoal): number {
  const config = getAgentGoalConfig(goal);
  const text = [doc.title, doc.snippet, doc.content].filter(Boolean).join(" ").toLowerCase();
  const terms = config.postgresQueryTerms.map((t) => t.toLowerCase());
  let hits = 0;
  for (const t of terms) {
    if (text.includes(t)) hits++;
  }
  const raw = 0.3 + Math.min(0.6, (hits / Math.max(1, terms.length)) * 0.6);
  const recency = doc.publishedAt
    ? computeRecencyScore(doc.publishedAt, DEFAULT_HALF_LIFE_DAYS)
    : 0.5;
  return Math.min(1, raw * 0.7 + recency * 0.3);
}

export interface RankForAgentOptions {
  /** When set, populated with a top-N score sample for curator audit traces. */
  rankingTrace?: AgentRankingTrace;
  rankingSampleSize?: number;
}

/**
 * Rank retrieved docs for an agent goal using base scores (from DB or heuristic)
 * and goal-aware feature weights.
 */
export async function rankForAgent(
  goal: AgentGoal,
  docs: RetrievedDoc[],
  options?: RankForAgentOptions
): Promise<AgentRankedDoc[]> {
  if (docs.length === 0) return [];

  const config = getAgentGoalConfig(goal);
  const profile = config.rankingProfile;

  const postgresIds = docs.filter((d) => d.source === "postgres_items" && d.id).map((d) => d.id!);
  const scoresById = await loadScoresForItems(postgresIds);

  const ranked: AgentRankedDoc[] = docs.map((doc) => {
    const stored = doc.source === "postgres_items" && doc.id ? scoresById[doc.id]?.final_score : undefined;
    const baseScore =
      stored != null ? Math.min(1, stored) : heuristicBaseScore(doc, goal);

    const features = computeGoalFeatures(doc, goal);

    const trendWeight = profile.trendLandscapeWeight ?? 0;
    const goalScore =
      profile.baseScoreWeight * baseScore +
      profile.competitorMatchWeight * features.competitorMatch +
      profile.icpMatchWeight * features.icpMatch +
      profile.formatTypeWeight * features.formatType +
      profile.recencyWeight * features.recency +
      trendWeight * features.trendLandscape;

    const agentScore = 0.4 * baseScore + 0.6 * goalScore;

    return {
      ...doc,
      baseScore,
      goalScore,
      agentScore,
      features,
    };
  });

  ranked.sort((a, b) => b.agentScore - a.agentScore);

  if (options?.rankingTrace) {
    const n = Math.min(options.rankingSampleSize ?? 25, ranked.length);
    const rt = options.rankingTrace;
    rt.schemaVersion = CURATOR_TRACE_SCHEMA_VERSION;
    rt.goal = goal;
    rt.totalRanked = ranked.length;
    rt.sampleSize = n;
    rt.documents = ranked.slice(0, n).map((doc, i) => ({
      rank: i + 1,
      id: doc.id,
      url: doc.url,
      title: doc.title,
      source: doc.source,
      baseScore: doc.baseScore,
      goalScore: doc.goalScore,
      agentScore: doc.agentScore,
    }));
  }

  logger.info("Agent ranking complete", {
    goal,
    docCount: ranked.length,
    topScore: ranked[0]?.agentScore,
  });

  return ranked;
}
