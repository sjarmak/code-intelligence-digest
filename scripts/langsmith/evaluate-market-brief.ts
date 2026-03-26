import dotenv from "dotenv";
import path from "path";
import { Client } from "langsmith";
import { evaluate } from "langsmith/evaluation";
import type { Example, Run } from "langsmith/schemas";
import { generateMarketBrief } from "../../src/lib/agents/market-brief";
import type { RetrievedDoc } from "../../src/lib/pipeline/agentRetrieval";
import {
  MARKET_BRIEF_DATASET_NAME,
  type MarketBriefEvalInput,
  type MarketBriefEvalReference,
} from "./market-brief-dataset";

dotenv.config({ path: path.resolve(process.cwd(), ".env.local") });
dotenv.config();

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

const FIXTURE_CORPUS: Record<string, RetrievedDoc[]> = {
  "governed enterprise coding agents compliance auditability context layer": [
    fixtureDoc(
      "https://example.com/enterprise-governance",
      "Enterprise coding assistant adds BYOK audit controls",
      "Security and platform teams requested governance, auditability, BYOK, and compliance controls for agentic coding workflows.",
      "2026-03-20",
    ),
    fixtureDoc(
      "https://example.com/context-layer",
      "Why enterprise coding agents need a context layer",
      "Repository context, code search, and verification are becoming the control plane for enterprise coding agents.",
      "2026-03-19",
    ),
    fixtureDoc(
      "https://example.com/release-governance",
      "Release governance becomes table stakes for AI dev tools",
      "Enterprise buyers now expect admin controls, compliance posture, and governed rollout for AI-assisted SDLC products.",
      "2026-03-18",
    ),
    fixtureDoc(
      "https://marketsandmarkets.com/fake-report",
      "AI Code Assistants Market worth $127.05 billion by 2032",
      "Global market forecast and CAGR report.",
      "2026-03-17",
    ),
  ],
  "retrieval precision repository context cross-repo developer platform": [
    fixtureDoc(
      "https://example.com/retrieval-precision",
      "Retrieval precision becomes a core requirement for coding agents",
      "Developer platform teams are converging on retrieval precision, repository context, and code search as reliability controls.",
      "2026-03-20",
    ),
    fixtureDoc(
      "https://example.com/cross-repo",
      "Cross-repo context is becoming platform infrastructure",
      "Platform engineering teams need cross-repo understanding and search to support agentic development in large codebases.",
      "2026-03-19",
    ),
    fixtureDoc(
      "https://example.com/verification",
      "Verification loops define production agent workflows",
      "Teams are moving from assistant UX to governed workflows built on retrieval, verification, and repository context.",
      "2026-03-18",
    ),
    fixtureDoc(
      "https://example.com/how-to-prompts",
      "How to write better prompts in your IDE",
      "Tactical prompt-writing advice for solo users.",
      "2026-03-17",
    ),
  ],
};

function asReference(example: Example): MarketBriefEvalReference {
  return (example.outputs ?? {}) as MarketBriefEvalReference;
}

function asOutput(outputs: Record<string, any>) {
  const executive = Array.isArray(outputs.executive_delta) ? outputs.executive_delta : [];
  const watch = Array.isArray(outputs.watch_items) ? outputs.watch_items : [];
  const trace =
    outputs.pipeline_trace && typeof outputs.pipeline_trace === "object" ? outputs.pipeline_trace : null;
  return {
    executive,
    watch,
    executiveTitles: executive.map((item: any) => String(item.title ?? "")),
    summaries: executive.map((item: any) => String(item.summary ?? "")),
    trace,
  };
}

const SCORE_GATE_THRESHOLDS: Record<string, number> = {
  min_executive_deltas: 1,
  keyword_theme_fit: 0.55,
  forbidden_title_leakage: 1,
  trace_presence: 1,
};

async function target(input: MarketBriefEvalInput) {
  const retrievalOverride = input.focus ? FIXTURE_CORPUS[input.focus] : undefined;
  return generateMarketBrief({
    periodDays: input.periodDays,
    maxItems: input.maxItems,
    focus: input.focus ?? null,
    pipelineTrace: true,
    retrievalOverride,
  });
}

async function minExecutiveEvaluator({
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
  const expected = ref.minExecutiveDeltas ?? 1;
  const actual = Array.isArray(outputs.executive_delta) ? outputs.executive_delta.length : 0;
  return {
    key: "min_executive_deltas",
    score: actual >= expected ? 1 : 0,
    comment: `Produced ${actual} executive deltas, expected at least ${expected}.`,
  };
}

async function keywordThemeEvaluator({
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
  const keywords = ref.requiredKeywords ?? [];
  if (keywords.length === 0) {
    return { key: "keyword_theme_fit", score: null, comment: "No keywords configured." };
  }

  const out = asOutput(outputs);
  const joined = [...out.executiveTitles, ...out.summaries].join(" ").toLowerCase();
  const matched = keywords.filter((keyword) => joined.includes(keyword.toLowerCase()));
  const missing = keywords.filter((keyword) => !joined.includes(keyword.toLowerCase()));
  return {
    key: "keyword_theme_fit",
    score: matched.length / keywords.length,
    comment: `Matched ${matched.length}/${keywords.length} required keywords. Missing: ${missing.join(", ") || "none"}.`,
  };
}

async function forbiddenTitleEvaluator({
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
  const forbiddenTitles = ref.forbiddenTitles ?? [];
  if (forbiddenTitles.length === 0) {
    return { key: "forbidden_title_leakage", score: null, comment: "No forbidden titles configured." };
  }

  const out = asOutput(outputs);
  const leaked = forbiddenTitles.find((title) => out.executiveTitles.includes(title));
  return {
    key: "forbidden_title_leakage",
    score: leaked ? 0 : 1,
    comment: leaked ? `Forbidden title leaked into executive delta: ${leaked}` : "No forbidden titles leaked.",
  };
}

async function tracePresenceEvaluator({
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
  const minRankedDocs = ref.minTraceRankedDocs ?? 1;
  const trace = outputs.pipeline_trace as Record<string, any> | undefined;
  const rankedDocs = Array.isArray(trace?.ranking?.documents) ? trace?.ranking?.documents.length : 0;
  const hasTrace =
    trace != null &&
    trace.retrieval != null &&
    trace.ranking != null &&
    rankedDocs >= minRankedDocs &&
    Array.isArray(trace.interpretable_steps) &&
    trace.interpretable_steps.length > 0;
  return {
    key: "trace_presence",
    score: hasTrace ? 1 : 0,
    comment: `Trace ranked docs: ${rankedDocs}, minimum expected: ${minRankedDocs}.`,
  };
}

function roundScore(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function computeGateResult(rows: Array<Record<string, any>>) {
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
    data: MARKET_BRIEF_DATASET_NAME,
    experimentPrefix: "market-brief",
    description: "Market brief evaluation for durable GTM theming, low-signal suppression, and pipeline trace coverage.",
    evaluators: [
      minExecutiveEvaluator,
      keywordThemeEvaluator,
      forbiddenTitleEvaluator,
      tracePresenceEvaluator,
    ],
    maxConcurrency: 1,
  });

  const rows = experiment.results.map((row) => ({
    exampleId: row.example.id,
    inputs: row.example.inputs,
    runId: row.run.id,
    feedback: row.evaluationResults.results,
    observedExecutiveTitles: asOutput(row.run.outputs ?? {}).executiveTitles,
    traceSelection: (row.run.outputs ?? {}).pipeline_trace?.selection ?? null,
    notes: asReference(row.example).notes ?? null,
  }));
  const gate = computeGateResult(rows);

  console.log(
    JSON.stringify(
      {
        experiment: experiment.experimentName,
        rows,
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
