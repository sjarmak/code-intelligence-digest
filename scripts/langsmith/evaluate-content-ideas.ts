import dotenv from "dotenv";
import path from "path";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import type { Run, Example } from "langsmith/schemas";
import { generateContentIdeas } from "../../src/lib/agents/content-ideas";
import type { RetrievedDoc } from "../../src/lib/pipeline/agentRetrieval";
import {
  CONTENT_IDEAS_DATASET_NAME,
  type ContentIdeasEvalInput,
  type ContentIdeasEvalReference,
} from "./content-ideas-dataset";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4),
  );
}

function overlapRatio(a: string, b: string): number {
  const aTokens = tokenize(a);
  const bTokens = tokenize(b);
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of aTokens) {
    if (bTokens.has(token)) overlap++;
  }
  return overlap / Math.max(1, Math.min(aTokens.size, bTokens.size));
}

function asReference(example: Example): ContentIdeasEvalReference {
  return (example.outputs ?? {}) as ContentIdeasEvalReference;
}

function asOutput(outputs: Record<string, any>) {
  const ideas = Array.isArray(outputs.ideas) ? outputs.ideas : [];
  return {
    ideas,
    titles: ideas.map((idea: any) => String(idea.title ?? "")),
    sourceTitles: ideas.flatMap((idea: any) =>
      Array.isArray(idea.sources) ? idea.sources.map((source: any) => String(source.title ?? "")) : [],
    ),
  };
}

const SCORE_GATE_THRESHOLDS: Record<string, number> = {
  min_ideas: 1,
  broad_theme_fit: 0.55,
  literal_source_title_penalty: 1,
  generic_update_leakage: 1,
  summary_source_diversity: 7,
};

function fixtureDoc(
  url: string,
  title: string,
  snippet: string,
  publishedAt: string,
): RetrievedDoc {
  return {
    source: "web",
    url,
    title,
    snippet,
    content: snippet,
    publishedAt: new Date(publishedAt),
    metadata: {},
  };
}

const FIXTURE_CORPUS: Record<
  string,
  { marketBriefDocs: RetrievedDoc[]; competitorDocs: RetrievedDoc[] }
> = {
  "governed ai coding workflows enterprise compliance cross-repo context": {
    marketBriefDocs: [
      fixtureDoc(
        "https://about.gitlab.com/blog/agentic-ai-software-lifecycle",
        "Enterprise governance controls for agentic AI across the software lifecycle",
        "Enterprise launch focused on compliance, auditability, BYOK, self-hosted deployment, policy control, and verification for AI code changes.",
        "2026-03-19",
      ),
      fixtureDoc(
        "https://www.infoq.com/articles/ai-code-governance-enterprise",
        "Why enterprise AI code governance needs audit trails and policy controls",
        "Case study coverage of compliance, audit trails, policy enforcement, and verification for enterprise developer platforms.",
        "2026-03-18",
      ),
      fixtureDoc(
        "https://martinfowler.com/articles/ai-change-governance.html",
        "Governing AI-assisted changes in large codebases",
        "Policy guardrails, audit readiness, compliance reviews, and verification help teams ship safely with coding agents.",
        "2026-03-17",
      ),
    ],
    competitorDocs: [
      fixtureDoc(
        "https://sourcegraph.com/blog/enterprise-context-layer",
        "Auditability and policy controls for enterprise coding agents",
        "Code Search and Deep Search support auditability, policy enforcement, compliance, and governed AI code changes.",
        "2026-03-19",
      ),
      fixtureDoc(
        "https://thenewstack.io/verification-for-coding-agents",
        "Verification becomes the bottleneck for coding agents",
        "Teams need policy, compliance, auditability, and verification instead of assistant-only workflows.",
        "2026-03-18",
      ),
      fixtureDoc(
        "https://www.cio.com/article/enterprise-ai-compliance-coding.html",
        "Compliance questions every enterprise team should ask of coding agents",
        "Audit readiness, BYOK, self-hosted controls, policy enforcement, and verification define enterprise adoption.",
        "2026-03-17",
      ),
    ],
  },
  "mcp context layer retrieval precision repository context developer platform": {
    marketBriefDocs: [
      fixtureDoc(
        "https://modelcontextprotocol.io/introduction",
        "Guide: Model Context Protocol for repository-aware coding agents",
        "MCP documentation covering repository context, retrieval precision, and developer platform integration for coding agents.",
        "2026-03-19",
      ),
      fixtureDoc(
        "https://github.blog/ai-and-ml/mcp-repository-context",
        "Case study: Repository context patterns for agentic development",
        "Launch coverage showing how Code Search, Deep Search, MCP, and retrieval precision improve coding-agent reliability in large codebases.",
        "2026-03-18",
      ),
      fixtureDoc(
        "https://www.cncf.io/blog/2026/03/18/platform-engineering-context-layer/",
        "Webinar: Developer platforms need a context layer for AI agents",
        "Developer platform teams are adopting repository context, code search, and deep search workflows for coding agents.",
        "2026-03-18",
      ),
      fixtureDoc(
        "https://sourcegraph.com/blog/retrieval-precision-code-search-agents",
        "Guide: Retrieval precision with Code Search and Deep Search for coding agents",
        "Product documentation and case study on retrieval precision, code search, deep search, and enterprise agents.",
        "2026-03-19",
      ),
    ],
    competitorDocs: [
      fixtureDoc(
        "https://www.infoq.com/news/2026/03/retrieval-precision-coding-agents/",
        "Retrieval precision becomes a core requirement for coding agents",
        "MCP, code search, deep search, and repository context are emerging as key controls for developer platforms.",
        "2026-03-17",
      ),
      fixtureDoc(
        "https://sourcegraph.com/blog/deep-search-context-layer",
        "Deep Search as a repository context layer",
        "Deep Search, Code Search, repository context, and retrieval precision improve enterprise coding-agent workflows.",
        "2026-03-19",
      ),
      fixtureDoc(
        "https://www.thoughtworks.com/insights/blog/developer-platforms/repository-context",
        "Repository context is becoming platform infrastructure",
        "Developer platforms need MCP, retrieval precision, repository context, and code search tooling for AI coding.",
        "2026-03-16",
      ),
      fixtureDoc(
        "https://thenewstack.io/mcp-needs-repository-context-and-code-search/",
        "MCP needs repository context and code search",
        "MCP adoption depends on repository context, code search, deep search, and retrieval precision in large codebases.",
        "2026-03-17",
      ),
    ],
  },
  "cross-repo migration remediation batch changes governed rollout": {
    marketBriefDocs: [
      fixtureDoc(
        "https://engineering.atspotify.com/2026/03/cross-repo-upgrade-workflows",
        "Case study: Cross-repo upgrade workflows for platform teams",
        "Migration case study covering cross-repo upgrade workflows, governed rollout, and verification for platform teams.",
        "2026-03-19",
      ),
      fixtureDoc(
        "https://shopify.engineering/repo-wide-remediation-rollout",
        "Guide: Repo-wide remediation without regression blind spots",
        "Batch changes, cross-repo remediation, verification, and rollout control reduce migration risk.",
        "2026-03-18",
      ),
      fixtureDoc(
        "https://www.infoq.com/articles/large-scale-code-migrations/",
        "Webinar: Large-scale code migrations need verification loops",
        "Cross-repo migration, remediation, batch changes, and governed rollout are hard without verification loops.",
        "2026-03-17",
      ),
      fixtureDoc(
        "https://sourcegraph.com/blog/batch-changes-migration-verification",
        "Brief: Batch Changes for migration verification at scale",
        "Documentation and customer evidence for batch changes, cross-repo remediation, migration, rollout, and verification.",
        "2026-03-19",
      ),
    ],
    competitorDocs: [
      fixtureDoc(
        "https://sourcegraph.com/blog/batch-changes-rollout-patterns",
        "Batch Changes rollout patterns for large codebases",
        "Batch Changes supports cross-repo remediation, migration, verification, and staged rollout.",
        "2026-03-19",
      ),
      fixtureDoc(
        "https://thenewstack.io/cross-repo-remediation-at-scale/",
        "Cross-repo remediation at scale",
        "Platform teams need migration controls, batch changes, rollback, and verification for governed rollout.",
        "2026-03-18",
      ),
      fixtureDoc(
        "https://www.techzine.eu/blogs/applications/123456/governed-rollout-for-ai-assisted-code-remediation/",
        "Governed rollout for AI-assisted code remediation",
        "Verification, batch execution, cross-repo remediation, and governed rollout are key enterprise requirements.",
        "2026-03-17",
      ),
      fixtureDoc(
        "https://martinfowler.com/articles/cross-repo-batch-migrations.html",
        "Cross-repo batch migrations need verification and rollout controls",
        "Batch changes, migration, remediation, verification, and rollout controls reduce regression risk in large codebases.",
        "2026-03-16",
      ),
    ],
  },
  "platform updates release notes cli updates product launches": {
    marketBriefDocs: [
      fixtureDoc(
        "https://www.infoq.com/articles/product-churn-to-governance-narratives/",
        "Turning product churn into governance and verification narratives",
        "Recent launches matter when they reveal repository context, governance, and cross-repo workflow gaps.",
        "2026-03-19",
      ),
      fixtureDoc(
        "https://martinfowler.com/articles/platform-update-patterns.html",
        "What platform updates reveal about cross-repo engineering work",
        "Platform updates often signal migration, verification, and repository-context problems at scale.",
        "2026-03-18",
      ),
      fixtureDoc(
        "https://sourcegraph.com/blog/governance-questions-hidden-in-platform-updates",
        "The governance questions hidden inside platform updates",
        "Use release activity as evidence for governance, verification, and context-layer narratives instead of literal headlines.",
        "2026-03-18",
      ),
    ],
    competitorDocs: [
      fixtureDoc(
        "https://thenewstack.io/why-release-churn-demands-better-repository-context/",
        "Why release churn demands better repository context",
        "Repository context, verification, and cross-repo change management matter more than generic release announcements.",
        "2026-03-17",
      ),
      fixtureDoc(
        "https://www.cio.com/article/platform-update-governance-enterprise-dev.html",
        "Platform updates are really governance stories for enterprise development",
        "Enterprise teams should interpret product launches through governance, verification, and context-layer needs.",
        "2026-03-17",
      ),
      fixtureDoc(
        "https://www.thoughtworks.com/insights/blog/engineering-effectiveness/repository-context-launches",
        "Repository context is the real story behind launch cycles",
        "Cross-repo understanding and verification turn noisy launch cycles into durable engineering narratives.",
        "2026-03-16",
      ),
    ],
  },
};

async function target(input: ContentIdeasEvalInput) {
  const retrievalOverride = input.focus ? FIXTURE_CORPUS[input.focus] : undefined;
  const payload = await generateContentIdeas({
    periodDays: input.periodDays,
    numIdeas: input.numIdeas,
    focus: input.focus ?? null,
    pipelineTrace: true,
    retrievalOverride,
  });
  return payload;
}

async function minIdeasEvaluator({
  outputs,
  example,
}: {
  run: Run;
  example: Example;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}) {
  const ref = asReference(example);
  const minIdeas = ref.minIdeas ?? 1;
  const count = Array.isArray(outputs.ideas) ? outputs.ideas.length : 0;
  return {
    key: "min_ideas",
    score: count >= minIdeas ? 1 : 0,
    comment: `Produced ${count} ideas, expected at least ${minIdeas}.`,
  };
}

async function broadThemeEvaluator({
  outputs,
  example,
}: {
  run: Run;
  example: Example;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}) {
  const ref = asReference(example);
  const keywords = ref.broadThemeKeywords ?? [];
  if (keywords.length === 0) {
    return { key: "broad_theme_fit", score: null, comment: "No theme keywords configured." };
  }

  const { titles } = asOutput(outputs);
  const joined = titles.join(" ").toLowerCase();
  const matched = keywords.filter((keyword) => joined.includes(keyword.toLowerCase()));
  const missing = keywords.filter((keyword) => !joined.includes(keyword.toLowerCase()));
  const score = matched.length / keywords.length;
  return {
    key: "broad_theme_fit",
    score,
    comment: `Matched ${matched.length}/${keywords.length} expected theme keywords in titles. Missing: ${missing.join(", ") || "none"}.`,
  };
}

async function literalTitleEvaluator({
  outputs,
  example,
}: {
  run: Run;
  example: Example;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}) {
  const ref = asReference(example);
  if (!ref.discourageLiteralSourceTitles) {
    return { key: "literal_source_title_penalty", score: null, comment: "Literal title check disabled." };
  }

  const { titles, sourceTitles } = asOutput(outputs);
  if (titles.length === 0 || sourceTitles.length === 0) {
    return { key: "literal_source_title_penalty", score: 0, comment: "Missing titles or sources." };
  }

  let maxObserved = 0;
  let worstTitle = "";
  let worstSourceTitle = "";
  for (const title of titles) {
    for (const sourceTitle of sourceTitles) {
      const overlap = overlapRatio(title, sourceTitle);
      if (overlap > maxObserved) {
        maxObserved = overlap;
        worstTitle = title;
        worstSourceTitle = sourceTitle;
      }
    }
  }

  return {
    key: "literal_source_title_penalty",
    score: maxObserved < 0.8 ? 1 : 0,
    comment: `Max title/source overlap ratio: ${maxObserved.toFixed(3)}. Idea title: "${worstTitle}". Source title: "${worstSourceTitle}".`,
  };
}

async function genericUpdateEvaluator({
  outputs,
  example,
}: {
  run: Run;
  example: Example;
  inputs: Record<string, any>;
  outputs: Record<string, any>;
  referenceOutputs?: Record<string, any>;
}) {
  const ref = asReference(example);
  if (!ref.disallowGenericUpdateSources) {
    return { key: "generic_update_leakage", score: null, comment: "Generic update check disabled." };
  }

  const { sourceTitles } = asOutput(outputs);
  const genericMatch = sourceTitles.find((title) =>
    /(cli|command line|platform update|march 20\d{2} update|release notes|changelog|v\d+\b|modernizing)/i.test(
      title,
    ),
  );

  return {
    key: "generic_update_leakage",
    score: genericMatch ? 0 : 1,
    comment: genericMatch
      ? `Weak-fit source leaked into output: ${genericMatch}`
      : "No generic update sources detected in final ideas.",
  };
}

async function summarySourceDiversity({
  outputs,
}: {
  runs: Run[];
  examples: Example[];
  inputs: Array<Record<string, any>>;
  outputs: Array<Record<string, any>>;
  referenceOutputs?: Array<Record<string, any>>;
}) {
  const domains = new Set<string>();
  for (const row of outputs) {
    for (const idea of Array.isArray(row.ideas) ? row.ideas : []) {
      for (const source of Array.isArray(idea.sources) ? idea.sources : []) {
        const url = String(source.url ?? "");
        try {
          domains.add(new URL(url).hostname.replace(/^www\./, ""));
        } catch {
          // ignore malformed URLs
        }
      }
    }
  }

  return {
    key: "summary_source_diversity",
    score: domains.size,
    comment: `Unique source domains across experiment: ${domains.size}.`,
  };
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function computeGateResult(rows: Array<Record<string, any>>, summaryResults: Array<Record<string, any>>) {
  const metricScores = new Map<string, number[]>();

  for (const row of rows) {
    for (const feedback of Array.isArray(row.feedback) ? row.feedback : []) {
      const score = typeof feedback.score === "number" ? feedback.score : null;
      if (score === null) continue;
      const current = metricScores.get(String(feedback.key)) ?? [];
      current.push(score);
      metricScores.set(String(feedback.key), current);
    }
  }

  for (const summary of summaryResults) {
    const score = typeof summary.score === "number" ? summary.score : null;
    if (score === null) continue;
    const current = metricScores.get(String(summary.key)) ?? [];
    current.push(score);
    metricScores.set(String(summary.key), current);
  }

  const metrics = Object.entries(SCORE_GATE_THRESHOLDS).map(([key, minimum]) => {
    const scores = metricScores.get(key) ?? [];
    const average = scores.length > 0 ? scores.reduce((sum, value) => sum + value, 0) / scores.length : null;
    return {
      key,
      minimum,
      average: average === null ? null : roundScore(average),
      count: scores.length,
      passed: average !== null && average >= minimum,
    };
  });

  const failures = metrics.filter((metric) => !metric.passed);
  return {
    passed: failures.length === 0,
    metrics,
    failures,
  };
}

async function main() {
  if (!process.env.LANGSMITH_API_KEY?.trim()) {
    throw new Error("LANGSMITH_API_KEY is required.");
  }

  const client = new Client({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT?.trim() || process.env.LANGCHAIN_ENDPOINT?.trim(),
    webUrl: process.env.LANGSMITH_WEB_URL?.trim(),
  });

  const experiment = await evaluate(target, {
    client,
    data: CONTENT_IDEAS_DATASET_NAME,
    experimentPrefix: "content-ideas",
    description: "Content ideas evaluation for broad theming, weak-fit leakage, and source-title literalness.",
    evaluators: [
      minIdeasEvaluator,
      broadThemeEvaluator,
      literalTitleEvaluator,
      genericUpdateEvaluator,
    ],
    summaryEvaluators: [summarySourceDiversity],
    maxConcurrency: 1,
  });

  const summary = experiment.summaryResults.results;
  const rows = experiment.results.map((row) => ({
    exampleId: row.example.id,
    inputs: row.example.inputs,
    runId: row.run.id,
    feedback: row.evaluationResults.results,
    observedTitles: asOutput(row.run.outputs ?? {}).titles,
    observedSourceTitles: asOutput(row.run.outputs ?? {}).sourceTitles,
    referenceGoodIdeas: asReference(row.example).referenceGoodIdeas ?? [],
    notes: asReference(row.example).notes ?? null,
  }));
  const gate = computeGateResult(rows, summary);

  console.log(
    JSON.stringify(
      {
        experiment: experiment.experimentName,
        rows,
        summary,
        gate,
      },
      null,
      2,
    ),
  );

  if (!gate.passed) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
