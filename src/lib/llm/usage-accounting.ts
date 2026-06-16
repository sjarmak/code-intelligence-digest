/**
 * Ambient, per-job LLM token/cost accounting (bd-zso).
 *
 * A single agent job fans LLM calls across many helpers (report writers,
 * content-idea synthesis, competitor query generation), so threading a usage
 * accumulator through every signature would be invasive and easy to miss. The
 * completion layer instead records each call into an AsyncLocalStorage context
 * that the job runner establishes once via withLlmUsageAccounting(). Outside
 * such a context recording is a no-op, so non-job callers (digest, podcast,
 * newsletter, …) are unaffected, and concurrent jobs stay isolated from each
 * other.
 */

import { AsyncLocalStorage } from "node:async_hooks";
import { estimateCostUsd, roundUsd } from "./pricing";

export interface LlmTokenUsage {
  inputTokens: number;
  outputTokens: number;
}

export interface LlmUsageCall extends LlmTokenUsage {
  provider: "anthropic" | "openai";
  model: string;
  /** Estimated USD cost, or null when the model is not in the pricing table. */
  estimatedCostUsd: number | null;
}

export interface LlmUsageSummary {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  /** Sum of per-call estimates for priced models; excludes unpriced models. */
  estimatedCostUsd: number;
  /** Distinct model ids used in the run. */
  models: string[];
  /** Models with no pricing entry — their spend is omitted from estimatedCostUsd. */
  unpricedModels: string[];
}

export interface TokenBudgetEvaluation {
  budget: number;
  totalTokens: number;
  exceeded: boolean;
  /** Tokens over budget, or 0 when within budget. */
  overBy: number;
}

interface UsageAccumulator {
  calls: LlmUsageCall[];
}

const usageStore = new AsyncLocalStorage<UsageAccumulator>();

/**
 * Run `fn` inside a fresh usage-accounting context. LLM calls made directly or
 * transitively during `fn` are recorded and readable via getLlmUsageSummary().
 */
export function withLlmUsageAccounting<T>(fn: () => Promise<T>): Promise<T> {
  return usageStore.run({ calls: [] }, fn);
}

/**
 * Record one completed LLM call into the active context. No-op when called
 * outside withLlmUsageAccounting() or when token usage is unavailable.
 */
export function recordLlmUsage(call: {
  provider: "anthropic" | "openai";
  model: string;
  usage?: LlmTokenUsage;
}): void {
  const store = usageStore.getStore();
  if (!store || !call.usage) return;
  store.calls.push({
    provider: call.provider,
    model: call.model,
    inputTokens: call.usage.inputTokens,
    outputTokens: call.usage.outputTokens,
    estimatedCostUsd: estimateCostUsd(
      call.model,
      call.usage.inputTokens,
      call.usage.outputTokens,
    ),
  });
}

/** Summary of the active context, or null when no context is established. */
export function getLlmUsageSummary(): LlmUsageSummary | null {
  const store = usageStore.getStore();
  if (!store) return null;
  return summarizeUsageCalls(store.calls);
}

/** Pure aggregation of recorded calls — exported for testing. */
export function summarizeUsageCalls(
  calls: readonly LlmUsageCall[],
): LlmUsageSummary {
  let inputTokens = 0;
  let outputTokens = 0;
  let estimatedCostUsd = 0;
  const models = new Set<string>();
  const unpricedModels = new Set<string>();
  for (const call of calls) {
    inputTokens += call.inputTokens;
    outputTokens += call.outputTokens;
    models.add(call.model);
    if (call.estimatedCostUsd == null) {
      unpricedModels.add(call.model);
    } else {
      estimatedCostUsd += call.estimatedCostUsd;
    }
  }
  return {
    calls: calls.length,
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCostUsd: roundUsd(estimatedCostUsd),
    models: [...models],
    unpricedModels: [...unpricedModels],
  };
}

/**
 * Pure soft-budget check. Returns null when no budget is configured; otherwise
 * reports whether the run's total token usage exceeded it. Exported for testing.
 */
export function evaluateTokenBudget(
  totalTokens: number,
  budget: number | undefined,
): TokenBudgetEvaluation | null {
  if (budget == null) return null;
  const exceeded = totalTokens > budget;
  return {
    budget,
    totalTokens,
    exceeded,
    overBy: exceeded ? totalTokens - budget : 0,
  };
}
