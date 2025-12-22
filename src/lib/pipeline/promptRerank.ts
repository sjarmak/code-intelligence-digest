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
 * Makes USER PROMPT the PRIMARY signal: items matching user's explicit focus get massive boost,
 * items not matching get penalized, items contradicting get filtered.
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

     // User prompt alignment is the PRIMARY signal
     const promptAlignmentScore = 
       Math.min(1.0, tagMatchScore) * 0.5 +
       Math.min(1.0, termPresenceScore) * 0.5;

     // AGGRESSIVE re-ranking: user prompt focus topics drive final ranking
     // - Well-matched items (alignment > 0.5): 4-6x boost (dominates ranking)
     // - Somewhat-matched items (alignment 0.3-0.5): 2.5-4x boost
     // - Weakly-matched items (alignment 0.1-0.3): 1.5-2.5x boost
     // - Non-matched items (alignment <= 0.1): 0.3x penalty (pushed down significantly)
     let boostFactor = 1.0;
     if (promptAlignmentScore > 0.5) {
       // Strong alignment: 4-6x boost
       boostFactor = 4.0 + (promptAlignmentScore * 4.0); // 4.0-6.0x
     } else if (promptAlignmentScore > 0.3) {
       // Moderate alignment: 2.5-4x boost
       boostFactor = 2.5 + (promptAlignmentScore * 4.0); // 2.5-4.0x
     } else if (promptAlignmentScore > 0.1) {
       // Weak alignment: 1.5-2.5x boost
       boostFactor = 1.5 + (promptAlignmentScore * 5.0); // 1.5-2.5x
     } else {
       // No alignment: penalize by 70% (keep for diversity but deprioritize heavily)
       boostFactor = 0.3;
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
