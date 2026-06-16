/**
 * Tests for LLM pricing / cost estimation (bd-zso).
 *
 * Provider responses report a versioned model id (e.g. "claude-sonnet-4-6",
 * "gpt-4o-mini-2024-07-18"), so getModelPrice must resolve by the LONGEST
 * matching family prefix — "gpt-4o-mini-…" must not collapse to the more
 * expensive "gpt-4o" table entry. Unknown models return null so callers can
 * report them as unpriced rather than assume zero spend.
 */
import { describe, it, expect } from 'vitest';
import { getModelPrice, estimateCostUsd, roundUsd } from '@/src/lib/llm/pricing';

describe('getModelPrice', () => {
  it('matches a versioned claude id to its family', () => {
    expect(getModelPrice('claude-sonnet-4-6')).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
    expect(getModelPrice('claude-opus-4-8')).toEqual({ inputPerMTok: 15, outputPerMTok: 75 });
    expect(getModelPrice('claude-haiku-4-5-20251001')).toEqual({ inputPerMTok: 1, outputPerMTok: 5 });
  });

  it('prefers the longest matching prefix so gpt-4o-mini is not priced as gpt-4o', () => {
    expect(getModelPrice('gpt-4o-mini-2024-07-18')).toEqual({ inputPerMTok: 0.15, outputPerMTok: 0.6 });
    expect(getModelPrice('gpt-4o-2024-08-06')).toEqual({ inputPerMTok: 2.5, outputPerMTok: 10 });
  });

  it('returns null for a model family not in the table', () => {
    expect(getModelPrice('gemini-2.0-flash')).toBeNull();
    expect(getModelPrice('')).toBeNull();
  });
});

describe('estimateCostUsd', () => {
  it('computes cost from input and output rates', () => {
    // sonnet: 3 USD/MTok input, 15 USD/MTok output.
    expect(estimateCostUsd('claude-sonnet-4-6', 1_000_000, 1_000_000)).toBe(18);
    // gpt-4o-mini: 0.15 + 0.6.
    expect(estimateCostUsd('gpt-4o-mini', 1_000_000, 1_000_000)).toBe(0.75);
  });

  it('scales linearly for partial-million token counts', () => {
    // 1000 input + 2000 output on sonnet -> 0.003 + 0.03.
    expect(estimateCostUsd('claude-sonnet-4-6', 1000, 2000)).toBe(0.033);
  });

  it('returns 0 for a priced model with no tokens', () => {
    expect(estimateCostUsd('claude-sonnet-4-6', 0, 0)).toBe(0);
  });

  it('returns null (not zero) for an unpriced model so spend is not silently dropped', () => {
    expect(estimateCostUsd('gemini-2.0-flash', 1_000_000, 1_000_000)).toBeNull();
  });
});

describe('roundUsd', () => {
  it('rounds to micro-dollar (6 decimal) precision', () => {
    expect(roundUsd(1.23456789)).toBe(1.234568);
    expect(roundUsd(0.00000051)).toBe(0.000001);
    expect(roundUsd(0.0000004)).toBe(0);
  });

  it('leaves already-short values unchanged', () => {
    expect(roundUsd(0.75)).toBe(0.75);
    expect(roundUsd(18)).toBe(18);
  });
});
