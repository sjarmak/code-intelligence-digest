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

    // Apply aggressive re-rank formula to actually favor prompt-relevant items
    // Prompt alignment is primary signal; baseline score is floor
    const promptAlignmentScore = 
      Math.min(1.0, tagMatchScore) * 0.5 +
      Math.min(1.0, termPresenceScore) * 0.5;

    // Boost items that match prompt topics significantly
    // For well-matched items (alignment > 0.4), boost by 1.5-2.5x
    // For somewhat-matched items (alignment > 0.2), boost by 1.2-1.5x
    // For non-matched items, preserve baseline
    let boostFactor = 1.0;
    if (promptAlignmentScore > 0.4) {
      boostFactor = 1.5 + (promptAlignmentScore * 1.0); // 1.5-2.5x boost
    } else if (promptAlignmentScore > 0.2) {
      boostFactor = 1.2 + (promptAlignmentScore * 1.5); // 1.2-1.5x boost
    }

    const adjustedScore = item.finalScore * boostFactor;

    logger.debug(
      `Item "${item.title}": baseline=${item.finalScore.toFixed(3)}, ` +
      `tagMatch=${tagMatchScore.toFixed(2)}, termMatch=${termPresenceScore.toFixed(2)}, ` +
      `alignment=${promptAlignmentScore.toFixed(2)}, boost=${boostFactor.toFixed(2)}x, ` +
      `adjusted=${adjustedScore.toFixed(3)}`
    );

    return {
      ...item,
      finalScore: adjustedScore,
      reasoning: `${item.reasoning} [PROMPT-RERANK: alignment=${promptAlignmentScore.toFixed(2)}, boost=${boostFactor.toFixed(2)}x]`,
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
