/**
 * Estimated LLM pricing for token/cost accounting (bd-zso).
 *
 * Prices are USD per 1,000,000 tokens, taken from each provider's public
 * pricing as of 2026-06. They are ESTIMATES used to attribute approximate spend
 * to agent runs, not billing-grade figures. Provider responses report a
 * versioned model id (e.g. "claude-sonnet-4-6", "gpt-4o-mini-2024-07-18"), so
 * lookup matches on the longest known family prefix.
 */

export interface ModelPrice {
  /** USD per 1M input tokens. */
  inputPerMTok: number;
  /** USD per 1M output tokens. */
  outputPerMTok: number;
}

const MODEL_PRICING: Record<string, ModelPrice> = {
  "claude-opus-4": { inputPerMTok: 15, outputPerMTok: 75 },
  "claude-sonnet-4": { inputPerMTok: 3, outputPerMTok: 15 },
  "claude-haiku-4": { inputPerMTok: 1, outputPerMTok: 5 },
  "gpt-4o-mini": { inputPerMTok: 0.15, outputPerMTok: 0.6 },
  "gpt-4o": { inputPerMTok: 2.5, outputPerMTok: 10 },
};

const USD_ROUNDING_DECIMALS = 6;

/** Round a USD amount to micro-dollar precision to avoid float noise. */
export function roundUsd(value: number): number {
  const factor = 10 ** USD_ROUNDING_DECIMALS;
  return Math.round(value * factor) / factor;
}

/**
 * Look up the price for a model id by longest matching family prefix. Returns
 * null when no family matches (caller surfaces it as unpriced).
 */
export function getModelPrice(model: string): ModelPrice | null {
  let best: { key: string; price: ModelPrice } | null = null;
  for (const [key, price] of Object.entries(MODEL_PRICING)) {
    if (model.startsWith(key) && (!best || key.length > best.key.length)) {
      best = { key, price };
    }
  }
  return best?.price ?? null;
}

/**
 * Estimated USD cost for a single call. Returns null when the model is not in
 * the pricing table, so the caller can report it as unpriced rather than
 * silently assume zero spend.
 */
export function estimateCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
): number | null {
  const price = getModelPrice(model);
  if (!price) return null;
  const cost =
    (inputTokens / 1_000_000) * price.inputPerMTok +
    (outputTokens / 1_000_000) * price.outputPerMTok;
  return roundUsd(cost);
}
