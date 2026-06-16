/**
 * Tests for per-job LLM token/cost accounting (bd-zso).
 *
 * The completion layer records each call into an AsyncLocalStorage context that
 * the job runner establishes once via withLlmUsageAccounting(). These tests
 * cover both the pure aggregation (summarizeUsageCalls, evaluateTokenBudget,
 * exported for testing) and the ambient context behaviour: recording is a no-op
 * outside a context, unpriced models are excluded from the cost total but
 * surfaced separately, and concurrent contexts stay isolated.
 */
import { describe, it, expect } from 'vitest';
import {
  withLlmUsageAccounting,
  recordLlmUsage,
  getLlmUsageSummary,
  summarizeUsageCalls,
  evaluateTokenBudget,
  type LlmUsageCall,
} from '@/src/lib/llm/usage-accounting';

function call(partial: Partial<LlmUsageCall>): LlmUsageCall {
  return {
    provider: 'anthropic',
    model: 'claude-sonnet-4-6',
    inputTokens: 0,
    outputTokens: 0,
    estimatedCostUsd: 0,
    ...partial,
  };
}

describe('summarizeUsageCalls', () => {
  it('returns zeroed totals for no calls', () => {
    expect(summarizeUsageCalls([])).toEqual({
      calls: 0,
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      estimatedCostUsd: 0,
      models: [],
      unpricedModels: [],
    });
  });

  it('aggregates tokens, cost, and distinct models', () => {
    const summary = summarizeUsageCalls([
      call({ model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.01 }),
      call({ model: 'claude-sonnet-4-6', inputTokens: 2000, outputTokens: 1000, estimatedCostUsd: 0.02 }),
      call({ provider: 'openai', model: 'gpt-4o-mini', inputTokens: 3000, outputTokens: 1500, estimatedCostUsd: 0.005 }),
    ]);

    expect(summary.calls).toBe(3);
    expect(summary.inputTokens).toBe(6000);
    expect(summary.outputTokens).toBe(3000);
    expect(summary.totalTokens).toBe(9000);
    expect(summary.estimatedCostUsd).toBe(0.035);
    expect(summary.models.sort()).toEqual(['claude-sonnet-4-6', 'gpt-4o-mini']);
    expect(summary.unpricedModels).toEqual([]);
  });

  it('excludes unpriced models from the cost total but lists them separately', () => {
    const summary = summarizeUsageCalls([
      call({ model: 'claude-sonnet-4-6', inputTokens: 1000, outputTokens: 500, estimatedCostUsd: 0.01 }),
      call({ model: 'gemini-2.0-flash', inputTokens: 9999, outputTokens: 8888, estimatedCostUsd: null }),
    ]);

    // Tokens still counted even when unpriced...
    expect(summary.totalTokens).toBe(1000 + 500 + 9999 + 8888);
    // ...but the null-cost call does not contribute to spend.
    expect(summary.estimatedCostUsd).toBe(0.01);
    expect(summary.unpricedModels).toEqual(['gemini-2.0-flash']);
  });
});

describe('evaluateTokenBudget', () => {
  it('returns null when no budget is configured', () => {
    expect(evaluateTokenBudget(5000, undefined)).toBeNull();
  });

  it('reports within-budget runs with overBy 0', () => {
    expect(evaluateTokenBudget(800, 1000)).toEqual({
      budget: 1000,
      totalTokens: 800,
      exceeded: false,
      overBy: 0,
    });
  });

  it('reports exceeded runs with the overage', () => {
    expect(evaluateTokenBudget(1500, 1000)).toEqual({
      budget: 1000,
      totalTokens: 1500,
      exceeded: true,
      overBy: 500,
    });
  });

  it('treats exactly-at-budget as not exceeded', () => {
    const result = evaluateTokenBudget(1000, 1000);
    expect(result?.exceeded).toBe(false);
    expect(result?.overBy).toBe(0);
  });
});

describe('ambient usage accounting context', () => {
  it('is a no-op outside a context: summary is null and recording does not throw', () => {
    expect(getLlmUsageSummary()).toBeNull();
    expect(() =>
      recordLlmUsage({ provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { inputTokens: 1, outputTokens: 1 } }),
    ).not.toThrow();
    // Still null — the call above went nowhere.
    expect(getLlmUsageSummary()).toBeNull();
  });

  it('records calls made inside withLlmUsageAccounting', async () => {
    const summary = await withLlmUsageAccounting(async () => {
      recordLlmUsage({ provider: 'anthropic', model: 'claude-sonnet-4-6', usage: { inputTokens: 1000, outputTokens: 500 } });
      recordLlmUsage({ provider: 'openai', model: 'gpt-4o-mini', usage: { inputTokens: 200, outputTokens: 100 } });
      return getLlmUsageSummary();
    });

    expect(summary?.calls).toBe(2);
    expect(summary?.inputTokens).toBe(1200);
    expect(summary?.outputTokens).toBe(600);
    expect(summary?.models.sort()).toEqual(['claude-sonnet-4-6', 'gpt-4o-mini']);
  });

  it('ignores calls with no provider-reported usage', async () => {
    const summary = await withLlmUsageAccounting(async () => {
      recordLlmUsage({ provider: 'anthropic', model: 'claude-sonnet-4-6' });
      return getLlmUsageSummary();
    });
    expect(summary?.calls).toBe(0);
  });

  it('isolates concurrent contexts from each other', async () => {
    const [a, b] = await Promise.all([
      withLlmUsageAccounting(async () => {
        recordLlmUsage({ provider: 'anthropic', model: 'claude-opus-4-8', usage: { inputTokens: 100, outputTokens: 100 } });
        await Promise.resolve();
        return getLlmUsageSummary();
      }),
      withLlmUsageAccounting(async () => {
        recordLlmUsage({ provider: 'openai', model: 'gpt-4o-mini', usage: { inputTokens: 999, outputTokens: 999 } });
        await Promise.resolve();
        return getLlmUsageSummary();
      }),
    ]);

    expect(a?.calls).toBe(1);
    expect(a?.models).toEqual(['claude-opus-4-8']);
    expect(b?.calls).toBe(1);
    expect(b?.models).toEqual(['gpt-4o-mini']);
  });
});
