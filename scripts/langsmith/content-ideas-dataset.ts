export interface ContentIdeasEvalInput {
  periodDays: number;
  numIdeas: number;
  focus?: string | null;
}

export interface ContentIdeasEvalReference {
  minIdeas?: number;
  broadThemeKeywords?: string[];
  disallowGenericUpdateSources?: boolean;
  discourageLiteralSourceTitles?: boolean;
  referenceGoodIdeas?: Array<{
    title: string;
    rationale: string;
  }>;
  notes?: string;
}

export const CONTENT_IDEAS_DATASET_NAME =
  process.env.LANGSMITH_CONTENT_IDEAS_DATASET?.trim() || "code-intel-digest-content-ideas";

export const CONTENT_IDEAS_DATASET_DESCRIPTION =
  "Focus scenarios for evaluating content_ideas output quality: broad theming, weak-fit leakage, and source-title literalness.";

export const CONTENT_IDEAS_EXAMPLES: Array<{
  id: string;
  inputs: ContentIdeasEvalInput;
  outputs: ContentIdeasEvalReference;
}> = [
  {
    id: "governance-short-window",
    inputs: {
      periodDays: 7,
      numIdeas: 5,
      focus: "governed ai coding workflows enterprise compliance cross-repo context",
    },
    outputs: {
      minIdeas: 3,
      broadThemeKeywords: ["govern", "compliance", "context", "cross-repo", "verification"],
      discourageLiteralSourceTitles: true,
      referenceGoodIdeas: [
        {
          title: "Guide: Governing AI Code Changes Across the Software Lifecycle",
          rationale: "Broad Sourcegraph-owned theme; the vendor announcement is just the hook.",
        },
        {
          title: "Talk Track: Enterprise Context and Auditability for Agentic Coding Workflows",
          rationale: "Keeps the narrative on governance, context, and enterprise controls instead of the source title.",
        },
      ],
      notes: "Should bias toward durable governance/context themes instead of literal announcement titles.",
    },
  },
  {
    id: "retrieval-context-short-window",
    inputs: {
      periodDays: 7,
      numIdeas: 5,
      focus: "mcp context layer retrieval precision repository context developer platform",
    },
    outputs: {
      minIdeas: 3,
      broadThemeKeywords: ["context", "retrieval", "mcp", "code search", "deep search"],
      discourageLiteralSourceTitles: true,
      referenceGoodIdeas: [
        {
          title: "Guide: Retrieval Precision as the Control Layer for Enterprise Coding Agents",
          rationale: "Centers Sourcegraph's context and retrieval strengths rather than mirroring any single source.",
        },
        {
          title: "Brief: Why Developer Platforms Need a Repository Context Layer for MCP and Agents",
          rationale: "Broadens the topic into a durable developer-platform narrative.",
        },
      ],
    },
  },
  {
    id: "cross-repo-change-short-window",
    inputs: {
      periodDays: 7,
      numIdeas: 5,
      focus: "cross-repo migration remediation batch changes governed rollout",
    },
    outputs: {
      minIdeas: 2,
      broadThemeKeywords: ["cross-repo", "migration", "remediation", "batch changes", "verification"],
      discourageLiteralSourceTitles: true,
      referenceGoodIdeas: [
        {
          title: "Case Study: Cross-Repo Upgrade Workflows Without Regression Blind Spots",
          rationale: "Frames migrations as a repeatable large-codebase workflow.",
        },
        {
          title: "Guide: Governing Batch Remediation and Rollout Across Large Codebases",
          rationale: "Keeps the story on controlled execution, verification, and rollout.",
        },
      ],
    },
  },
  {
    id: "generic-product-update-avoidance",
    inputs: {
      periodDays: 7,
      numIdeas: 5,
      focus: "platform updates release notes cli updates product launches",
    },
    outputs: {
      minIdeas: 2,
      broadThemeKeywords: ["context", "govern", "cross-repo", "verification"],
      disallowGenericUpdateSources: true,
      discourageLiteralSourceTitles: true,
      referenceGoodIdeas: [
        {
          title: "Guide: Turning Product Churn Into Durable Engineering Narratives",
          rationale: "Shows the desired abstraction level when the source pool is noisy.",
        },
        {
          title: "Brief: The Governance and Verification Questions Hidden Inside Platform Updates",
          rationale: "Uses updates as evidence, not as the literal headline.",
        },
      ],
      notes: "Should avoid weak-fit ideas driven by generic platform or CLI updates.",
    },
  },
];
