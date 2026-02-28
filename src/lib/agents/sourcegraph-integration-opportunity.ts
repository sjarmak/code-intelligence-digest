export type IntegrationOpportunityLevel = "high_opportunity" | "medium_opportunity" | "monitor_only";

export interface SourcegraphIntegrationOpportunity {
  level: IntegrationOpportunityLevel;
  score: number;
  workflow_fit: string[];
  integration_surface: string[];
  agent_failure_modes: string[];
  sourcegraph_integration_play: string[];
}

function uniq(items: string[]): string[] {
  return Array.from(new Set(items));
}

function detectWorkflowFit(text: string): string[] {
  const out: string[] = [];
  if (/(context|codebase|cross[-\s]?repo|multi[-\s]?repo|monorepo|retrieval|mcp)/.test(text)) out.push("repo_context_fetch");
  if (/(code search|semantic search|deep search|navigate|find references|symbol)/.test(text)) out.push("code_search_retrieval");
  if (/(plan|agentic workflow|compose|orchestrate|task graph|multi[-\s]?step)/.test(text)) out.push("planning_across_files_repos");
  if (/(refactor|remediation|migration|codemod|batch|large[-\s]?scale edit|bulk change)/.test(text)) out.push("safe_large_scale_edits");
  if (/(benchmark|eval|verification|test|guardrail|quality)/.test(text)) out.push("verification_eval_loop");
  return uniq(out);
}

function detectIntegrationSurface(text: string): string[] {
  const out: string[] = [];
  if (/(mcp|model context protocol)/.test(text)) out.push("mcp");
  if (/(api|sdk|endpoint)/.test(text)) out.push("api");
  if (/(cli|command line)/.test(text)) out.push("cli");
  if (/(ide|vscode|jetbrains|editor)/.test(text)) out.push("ide");
  if (/(ci\/cd|pipeline|github actions|gitlab|review|pull request)/.test(text)) out.push("ci_code_review");
  return uniq(out);
}

function detectFailureModes(text: string): string[] {
  const out: string[] = [];
  if (/(wrong context|missing context|limited context|hallucinat|doesn.?t understand codebase)/.test(text)) out.push("context_loss");
  if (/(unsafe|regression|breaks builds|risky refactor|cannot validate)/.test(text)) out.push("unsafe_edits");
  if (/(slow|latency|too many files|can.?t navigate|stuck)/.test(text)) out.push("navigation_friction");
  if (/(benchmark|eval|quality|reliability|verification)/.test(text)) out.push("weak_eval_loop");
  return uniq(out);
}

function buildPlays(workflowFit: string[], integrationSurface: string[]): string[] {
  const plays: string[] = [];
  if (workflowFit.includes("repo_context_fetch")) {
    plays.push("Use Sourcegraph as the agent context layer: fetch cross-repo symbols, ownership, and usage paths before generation.");
  }
  if (workflowFit.includes("code_search_retrieval")) {
    plays.push("Route retrieval to Sourcegraph Code Search for precise symbol/file grounding instead of generic keyword recall.");
  }
  if (workflowFit.includes("safe_large_scale_edits")) {
    plays.push("Use Batch Changes to execute and review repo-wide edits with controlled rollout and rollback checkpoints.");
  }
  if (workflowFit.includes("verification_eval_loop")) {
    plays.push("Add a Sourcegraph-backed verification step: compare proposed edits against references/tests before merge.");
  }
  if (integrationSurface.includes("mcp") && !plays.some((p) => p.includes("MCP"))) {
    plays.push("Expose Sourcegraph via MCP so agents can call search/context tools directly in planning and execution loops.");
  }
  if (plays.length === 0) {
    plays.push("Map this workflow to Sourcegraph retrieval + navigation first, then add controlled edit/verification steps.");
  }
  return plays.slice(0, 2);
}

export function classifySourcegraphIntegrationOpportunity(input: {
  title?: string;
  summary?: string;
  content?: string;
  overlap?: string[];
  actionability?: string[];
}): SourcegraphIntegrationOpportunity {
  const text = `${input.title ?? ""} ${input.summary ?? ""} ${input.content ?? ""}`.toLowerCase();
  const workflow_fit = detectWorkflowFit(text);
  const integration_surface = detectIntegrationSurface(text);
  const agent_failure_modes = detectFailureModes(text);

  let score = 0;
  score += Math.min(4, workflow_fit.length) * 1.25;
  score += Math.min(3, integration_surface.length) * 0.8;
  score += Math.min(3, agent_failure_modes.length) * 0.9;
  score += Math.min(3, input.overlap?.length ?? 0) * 0.6;
  if (input.actionability?.some((a) => a === "product" || a === "sales")) score += 0.8;
  if (/mcp|context|cross[-\s]?repo|code search|batch changes|refactor|benchmark|eval/.test(text)) score += 0.8;

  const level: IntegrationOpportunityLevel =
    score >= 6.2 ? "high_opportunity" : score >= 3.8 ? "medium_opportunity" : "monitor_only";

  return {
    level,
    score: Number(score.toFixed(2)),
    workflow_fit,
    integration_surface,
    agent_failure_modes,
    sourcegraph_integration_play: buildPlays(workflow_fit, integration_surface),
  };
}
