/**
 * Goal-aware features for agent ranking.
 * Computes competitorMatch, formatType, icpMatch, and recency from doc content.
 */

import type { AgentGoal } from "../../config/agents";
import {
  getCompetitorKeywords,
  getDirectCompetitorKeywords,
} from "../../config/competitors";
import type { RetrievedDoc } from "./agentRetrieval";
import { computeRecencyScore } from "./scoring-utils";

/**
 * Half-life (days) for the goal-feature recency signal. Routes goal-feature
 * recency through the single canonical scoring source (computeRecencyScore)
 * instead of a private step function. hl=20 tracks the prior day-bucket ladder
 * (<=1d -> 1.0, <=7d -> 0.85, <=14d -> 0.7, <=30d -> 0.5) closely at those
 * early boundary values; note the exponential is smooth, so mid-bucket and
 * post-boundary values differ, and for content older than ~30 days it keeps
 * decaying toward the 0.2 floor rather than holding flat at the old 0.3
 * bucket. Accepted shift (arch-review 2026-07-10 finding #1).
 */
export const RECENCY_HALF_LIFE_DAYS = 20;

export interface GoalFeatures {
  competitorMatch: number;
  formatType: number;
  icpMatch: number;
  recency: number;
  trendLandscape: number;
}

const FORMAT_TERMS: Record<string, string[]> = {
  webinar: ["webinar", "webinars", "live session", "live event"],
  whitepaper: ["white paper", "whitepaper", "whitepapers", "ebook", "e-book"],
  case_study: ["case study", "case studies", "customer story", "success story"],
  blog: ["blog", "article", "post", "tutorial", "how-to"],
  video: ["video", "watch", "youtube", "vimeo", "recording"],
};

const ICP_TERMS: string[] = [
  "large codebase",
  "monorepo",
  "enterprise",
  "developer productivity",
  "code search",
  "codebase",
  "complex code",
  "legacy",
  "refactoring",
  "scale",
  "developer tools",
  "code intelligence",
  "AI coding",
  "coding agent",
  "context retrieval",
  "code review",
  "documentation",
  "onboarding",
  "vulnerability",
  "remediation",
  "batch changes",
  "monitoring",
  "observability",
];

const TREND_LANDSCAPE_TERMS: string[] = [
  "trend",
  "adoption",
  "market",
  "landscape",
  "shift",
  "emerging",
  "report",
  "survey",
  "go to market",
  "gtm",
];

function textFromDoc(doc: RetrievedDoc): string {
  const parts = [
    doc.title,
    doc.snippet ?? "",
    doc.content ?? "",
  ].filter(Boolean);
  return parts.join(" ").toLowerCase();
}

/**
 * Compute goal-specific features for a retrieved doc (0–1 scale).
 * For competitor_intel, direct competitor keywords (Augment, Moderne, OpenGrok, GitHub MCP) contribute more than augmenting.
 */
export function computeGoalFeatures(doc: RetrievedDoc, goal: AgentGoal): GoalFeatures {
  const text = textFromDoc(doc);
  const keywords = getCompetitorKeywords();
  const directKeywords = getDirectCompetitorKeywords();

  let competitorMatch = 0;
  if (goal === "competitor_intel") {
    for (const kw of directKeywords) {
      if (text.includes(kw.toLowerCase())) {
        competitorMatch = Math.min(1, competitorMatch + 0.35);
        if (competitorMatch >= 1) break;
      }
    }
    for (const kw of keywords) {
      if (directKeywords.includes(kw)) continue;
      if (text.includes(kw.toLowerCase())) {
        competitorMatch = Math.min(1, competitorMatch + 0.15);
        if (competitorMatch >= 1) break;
      }
    }
  } else {
    for (const kw of keywords) {
      if (text.includes(kw.toLowerCase())) {
        competitorMatch = Math.min(1, competitorMatch + 0.25);
        if (competitorMatch >= 1) break;
      }
    }
  }

  let formatType = 0;
  for (const terms of Object.values(FORMAT_TERMS)) {
    if (terms.some((t) => text.includes(t))) {
      formatType = Math.min(1, formatType + 0.3);
      if (formatType >= 1) break;
    }
  }

  let icpMatch = 0;
  for (const term of ICP_TERMS) {
    if (text.includes(term)) {
      icpMatch = Math.min(1, icpMatch + 0.2);
      if (icpMatch >= 1) break;
    }
  }

  const recency = doc.publishedAt
    ? computeRecencyScore(doc.publishedAt, RECENCY_HALF_LIFE_DAYS)
    : 0.5;

  let trendLandscape = 0;
  for (const term of TREND_LANDSCAPE_TERMS) {
    if (text.includes(term)) {
      trendLandscape = Math.min(1, trendLandscape + 0.25);
      if (trendLandscape >= 1) break;
    }
  }

  return {
    competitorMatch,
    formatType,
    icpMatch,
    recency,
    trendLandscape,
  };
}
