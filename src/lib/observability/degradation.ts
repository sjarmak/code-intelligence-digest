/**
 * Ambient, per-run degradation accounting (bd-sgo).
 *
 * The pipeline degrades silently in several places — Anthropic→OpenAI
 * completion fallback, hash-based pseudo-embeddings when no OpenAI key is set,
 * empty web context when no search provider is configured, and neutral (5,5)
 * LLM scores on a batch-size mismatch or scoring failure. Each point already
 * warns, but a warn line is not queryable after the fact. Mirroring the LLM
 * usage accounting (usage-accounting.ts), every degradation is recorded into
 * an AsyncLocalStorage context that a run establishes once via
 * withDegradationTracking(); the agent job runner attaches the summary to
 * agent_runs metadata and the scoring pipeline returns it in its output, so
 * degraded runs are queryable, not just logged. Outside such a context
 * recording is a no-op, so ad-hoc callers are unaffected and concurrent runs
 * stay isolated from each other.
 */

import { AsyncLocalStorage } from "node:async_hooks";

export type DegradationKind =
  | "completion_fallback"
  | "pseudo_embedding"
  | "web_search_missing"
  | "neutral_score";

export interface DegradationSummary {
  /** True when any degradation was recorded during the run. */
  degraded: boolean;
  /** Sum of all recorded degradation counts across every kind. */
  total: number;
  /** Anthropic→OpenAI completion fallbacks (a Claude model served by OpenAI). */
  completionFallback: number;
  /** Items stored with hash-based pseudo-embeddings (no semantic meaning). */
  pseudoEmbedding: number;
  /** Web searches that ran with no provider configured (empty context). */
  webSearchMissing: number;
  /** Items assigned neutral (5,5) LLM scores due to a scoring degradation. */
  neutralScore: number;
}

interface DegradationEvent {
  kind: DegradationKind;
  count: number;
}

interface DegradationAccumulator {
  events: DegradationEvent[];
}

const degradationStore = new AsyncLocalStorage<DegradationAccumulator>();

/**
 * Run `fn` inside a fresh degradation-tracking context. Degradations recorded
 * directly or transitively during `fn` are readable via getDegradationSummary().
 */
export function withDegradationTracking<T>(fn: () => Promise<T>): Promise<T> {
  return degradationStore.run({ events: [] }, fn);
}

/**
 * Record `count` occurrences of a degradation into the active context. No-op
 * when called outside withDegradationTracking(). A non-positive count is
 * ignored so callers can pass a computed total (e.g. expected − actual) freely.
 */
export function recordDegradation(kind: DegradationKind, count = 1): void {
  if (count <= 0) return;
  const store = degradationStore.getStore();
  if (!store) return;
  store.events.push({ kind, count });
}

/** Summary of the active context, or null when no context is established. */
export function getDegradationSummary(): DegradationSummary | null {
  const store = degradationStore.getStore();
  if (!store) return null;
  return summarizeDegradation(store.events);
}

/** Assemble a summary from per-kind counts, deriving total + degraded. */
function buildSummary(
  completionFallback: number,
  pseudoEmbedding: number,
  webSearchMissing: number,
  neutralScore: number,
): DegradationSummary {
  const total =
    completionFallback + pseudoEmbedding + webSearchMissing + neutralScore;
  return {
    degraded: total > 0,
    total,
    completionFallback,
    pseudoEmbedding,
    webSearchMissing,
    neutralScore,
  };
}

/** Pure aggregation of recorded degradation events — exported for testing. */
export function summarizeDegradation(
  events: readonly DegradationEvent[],
): DegradationSummary {
  let completionFallback = 0;
  let pseudoEmbedding = 0;
  let webSearchMissing = 0;
  let neutralScore = 0;
  for (const { kind, count } of events) {
    switch (kind) {
      case "completion_fallback":
        completionFallback += count;
        break;
      case "pseudo_embedding":
        pseudoEmbedding += count;
        break;
      case "web_search_missing":
        webSearchMissing += count;
        break;
      case "neutral_score":
        neutralScore += count;
        break;
    }
  }
  return buildSummary(
    completionFallback,
    pseudoEmbedding,
    webSearchMissing,
    neutralScore,
  );
}

/**
 * Combine several degradation summaries into one. The daily sync scores items
 * in many separate computeAndSaveScoresForItems calls, each running in its own
 * tracking context (so one shared context cannot capture them all); this rolls
 * their returned summaries up for a single sync-level surface. Pure; exported
 * for testing.
 */
export function mergeDegradationSummaries(
  summaries: readonly DegradationSummary[],
): DegradationSummary {
  let completionFallback = 0;
  let pseudoEmbedding = 0;
  let webSearchMissing = 0;
  let neutralScore = 0;
  for (const s of summaries) {
    completionFallback += s.completionFallback;
    pseudoEmbedding += s.pseudoEmbedding;
    webSearchMissing += s.webSearchMissing;
    neutralScore += s.neutralScore;
  }
  return buildSummary(
    completionFallback,
    pseudoEmbedding,
    webSearchMissing,
    neutralScore,
  );
}
