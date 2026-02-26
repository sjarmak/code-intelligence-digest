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

  let recency = 0.5;
  if (doc.publishedAt) {
    const ageDays = (Date.now() - doc.publishedAt.getTime()) / (24 * 60 * 60 * 1000);
    if (ageDays <= 1) recency = 1;
    else if (ageDays <= 7) recency = 0.85;
    else if (ageDays <= 14) recency = 0.7;
    else if (ageDays <= 30) recency = 0.5;
    else recency = 0.3;
  }

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
