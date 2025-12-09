/**
 * Source relevance management
 * Allows tuning how much each source/feed contributes to scoring
 */

import { getSqlite } from "./index";
import { logger } from "../logger";

export type SourceRelevance = 0 | 1 | 2 | 3;

export const RELEVANCE_LABELS: Record<SourceRelevance, string> = {
  0: "Ignore",
  1: "Neutral",
  2: "Relevant",
  3: "Highly Relevant",
};

/**
 * Set relevance rating for a source/feed
 */
export async function setSourceRelevance(
  streamId: string,
  relevance: SourceRelevance
): Promise<void> {
  try {
    const sqlite = getSqlite();
    const now = Math.floor(Date.now() / 1000);

    sqlite
      .prepare(
        `UPDATE feeds SET source_relevance = ?, updated_at = ? WHERE stream_id = ?`
      )
      .run(relevance, now, streamId);

    logger.info(`Set source relevance`, {
      streamId,
      relevance,
      label: RELEVANCE_LABELS[relevance],
    });
  } catch (error) {
    logger.error("Failed to set source relevance", { streamId, error });
    throw error;
  }
}

/**
 * Get relevance rating for a source
 */
export async function getSourceRelevance(
  streamId: string
): Promise<SourceRelevance> {
  try {
    const sqlite = getSqlite();
    const feed = sqlite
      .prepare(`SELECT source_relevance FROM feeds WHERE stream_id = ?`)
      .get(streamId) as { source_relevance: number } | undefined;

    return (feed?.source_relevance ?? 1) as SourceRelevance;
  } catch (error) {
    logger.warn("Failed to get source relevance, defaulting to 1", {
      streamId,
      error,
    });
    return 1;
  }
}

/**
 * Get all sources with their relevance ratings
 */
export async function getAllSourcesWithRelevance() {
  try {
    const sqlite = getSqlite();
    const sources = sqlite
      .prepare(
        `SELECT stream_id, canonical_name, source_relevance, default_category 
         FROM feeds ORDER BY canonical_name ASC`
      )
      .all() as Array<{
      stream_id: string;
      canonical_name: string;
      source_relevance: number;
      default_category: string;
    }>;

    return sources.map((s) => ({
      streamId: s.stream_id,
      canonicalName: s.canonical_name,
      sourceRelevance: s.source_relevance,
      defaultCategory: s.default_category,
      relevanceLabel: RELEVANCE_LABELS[s.source_relevance as SourceRelevance],
    }));
  } catch (error) {
    logger.error("Failed to get all sources with relevance", error);
    return [];
  }
}

/**
 * Get relevance multiplier for scoring
 * Maps 0-3 scale to adjustment factor:
 * 0 (Ignore) → 0.0 (filtered out)
 * 1 (Neutral) → 1.0 (no adjustment)
 * 2 (Relevant) → 1.3 (boost)
 * 3 (Highly Relevant) → 1.6 (strong boost)
 */
export function getRelevanceMultiplier(relevance: SourceRelevance): number {
  const multipliers: Record<SourceRelevance, number> = {
    0: 0.0, // filtered
    1: 1.0, // neutral
    2: 1.3, // relevant boost
    3: 1.6, // high boost
  };
  return multipliers[relevance];
}
