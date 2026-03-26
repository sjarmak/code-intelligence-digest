export interface MarketBriefEvalInput {
  periodDays: number;
  maxItems: number;
  focus?: string | null;
}

export interface MarketBriefEvalReference {
  minExecutiveDeltas?: number;
  requiredKeywords?: string[];
  forbiddenTitles?: string[];
  minTraceRankedDocs?: number;
  notes?: string;
}

export const MARKET_BRIEF_DATASET_NAME =
  process.env.LANGSMITH_MARKET_BRIEF_DATASET?.trim() || "code-intel-digest-market-brief";

export const MARKET_BRIEF_DATASET_DESCRIPTION =
  "Focused scenarios for evaluating market_brief output quality: durable GTM themes, low-signal suppression, and pipeline trace coverage.";

export const MARKET_BRIEF_EXAMPLES: Array<{
  id: string;
  inputs: MarketBriefEvalInput;
  outputs: MarketBriefEvalReference;
}> = [
  {
    id: "governed-enterprise-coding-agents",
    inputs: {
      periodDays: 7,
      maxItems: 6,
      focus: "governed enterprise coding agents compliance auditability context layer",
    },
    outputs: {
      minExecutiveDeltas: 2,
      requiredKeywords: ["govern", "compliance", "audit", "context", "enterprise"],
      forbiddenTitles: ["AI Code Assistants Market worth $127.05 billion by 2032"],
      minTraceRankedDocs: 3,
      notes: "Should surface governance and context-layer themes, not generic market-size noise.",
    },
  },
  {
    id: "retrieval-context-and-cross-repo",
    inputs: {
      periodDays: 7,
      maxItems: 6,
      focus: "retrieval precision repository context cross-repo developer platform",
    },
    outputs: {
      minExecutiveDeltas: 2,
      requiredKeywords: ["retrieval", "context", "cross-repo", "platform", "search"],
      forbiddenTitles: ["How to write better prompts in your IDE"],
      minTraceRankedDocs: 3,
      notes: "Should prefer durable repository-context narratives over tactical how-to content.",
    },
  },
];
