/**
 * Prompt-based re-ranking
 * Boosts items relevant to user prompt while respecting baseline ranking
 */

import { RankedItem } from "../model";
import { PromptProfile } from "./promptProfile";
import { logger } from "../logger";

/**
 * Compute tag match score between item tags and prompt focus topics
 */
function computeTagMatchScore(itemTags: string[], focusTopics: string[]): number {
  if (focusTopics.length === 0 || itemTags.length === 0) {
    return 0;
  }

  const lowerItemTags = itemTags.map(t => t.toLowerCase());
  const lowerTopics = focusTopics.map(t => t.toLowerCase());

  const matches = lowerItemTags.filter(tag =>
    lowerTopics.some(topic => tag.includes(topic) || topic.includes(tag))
  ).length;

  return Math.min(1.0, matches / focusTopics.length);
}

/**
 * Compute term presence score in item text
 */
function computeTermPresenceScore(
  title: string,
  summary: string | undefined,
  fullText: string | undefined,
  focusTerms: string[]
): number {
  if (focusTerms.length === 0) {
    return 0;
  }

  const text = `${title} ${summary || ""} ${fullText || ""}`.toLowerCase();
  const lowerTerms = focusTerms.map(t => t.toLowerCase());

  const matches = lowerTerms.filter(term => text.includes(term)).length;
  return Math.min(1.0, matches / focusTerms.length);
}

/**
 * Re-rank items based on prompt profile
 * Applies soft boost for prompt-relevant items without overriding baseline ranking
 */
export function rerankWithPrompt(
  items: RankedItem[],
  profile: PromptProfile
): RankedItem[] {
  if (!profile || profile.focusTopics.length === 0) {
    return items;
  }

  logger.info(
    `Re-ranking ${items.length} items based on prompt topics: ${profile.focusTopics.join(", ")}`
  );

  const reranked = items.map((item) => {
    // Compute match scores
    const tagMatchScore = computeTagMatchScore(item.llmScore.tags, profile.focusTopics);
    const termPresenceScore = computeTermPresenceScore(
      item.title,
      item.summary,
      item.fullText,
      profile.focusTopics
    );

    // Apply re-rank formula (conservative, don't override baseline)
    const rerankBoost =
      Math.min(1.0, item.finalScore) * 0.65 +
      Math.min(1.0, tagMatchScore) * 0.25 +
      Math.min(1.0, termPresenceScore) * 0.10;

    const adjustedScore = item.finalScore * (0.8 + 0.2 * rerankBoost);

    logger.debug(
      `Item "${item.title}": baseline=${item.finalScore.toFixed(3)}, ` +
      `tagMatch=${tagMatchScore.toFixed(2)}, termMatch=${termPresenceScore.toFixed(2)}, ` +
      `adjusted=${adjustedScore.toFixed(3)}`
    );

    return {
      ...item,
      finalScore: adjustedScore,
      reasoning: `${item.reasoning} [PROMPT-RERANK: tags=${tagMatchScore.toFixed(2)}, terms=${termPresenceScore.toFixed(2)}]`,
    };
  });

  // Re-sort by adjusted score
  reranked.sort((a, b) => b.finalScore - a.finalScore);

  return reranked;
}

/**
 * Filter items based on exclusion topics in profile
 */
export function filterByExclusions(
  items: RankedItem[],
  profile: PromptProfile | null
): RankedItem[] {
  if (!profile || !profile.excludeTopics || profile.excludeTopics.length === 0) {
    return items;
  }

  const lowerExcluded = profile.excludeTopics.map(t => t.toLowerCase());

  return items.filter((item) => {
    const itemText = `${item.title} ${item.summary || ""} ${item.llmScore.tags.join(" ")}`.toLowerCase();
    const shouldExclude = lowerExcluded.some(
      excluded => itemText.includes(excluded) || item.llmScore.tags.some(tag => tag.toLowerCase().includes(excluded))
    );

    if (shouldExclude) {
      logger.debug(`Filtered out item "${item.title}" due to exclusion profile`);
    }

    return !shouldExclude;
  });
}
