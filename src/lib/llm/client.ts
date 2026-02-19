/**
 * Central LLM client factory for OpenAI-compatible APIs.
 * Used by all pipeline and API code; supports BYOK and optional base URL (e.g. Ollama, LiteLLM).
 */

import OpenAI from "openai";

export interface LLMClientOptions {
  /** API key (BYOK or server env). */
  apiKey?: string;
  /** Base URL for OpenAI-compatible endpoints (e.g. Ollama, LiteLLM). */
  baseURL?: string;
}

/** Request-level BYOK/config from JSON body. */
export interface LLMConfigFromRequest {
  openaiApiKey?: string;
  openaiBaseUrl?: string;
}

/** Session user for Sourcegraph.com exception (verified email only). */
export interface SessionUserForLLM {
  email?: string | null;
  emailVerified?: boolean | null;
}

/**
 * Resolves LLM options in priority order:
 * (1) request body keys, (2) user-stored keys (future), (3) verified @sourcegraph.com -> server key, (4) server env.
 */
export function resolveLLMOptions(
  fromRequest?: LLMConfigFromRequest | null,
  _userStored?: LLMClientOptions | null,
  sessionUser?: SessionUserForLLM | null
): LLMClientOptions {
  if (fromRequest?.openaiApiKey?.trim()) {
    return {
      apiKey: fromRequest.openaiApiKey.trim(),
      baseURL: fromRequest.openaiBaseUrl?.trim() || undefined,
    };
  }
  if (_userStored?.apiKey?.trim()) {
    return {
      apiKey: _userStored.apiKey.trim(),
      baseURL: _userStored.baseURL?.trim() || undefined,
    };
  }
  const email = sessionUser?.email?.trim().toLowerCase();
  const verified = sessionUser?.emailVerified === true;
  if (verified && email?.endsWith("@sourcegraph.com")) {
    const serverKey = process.env.OPENAI_API_KEY;
    if (serverKey?.trim()) {
      return {
        apiKey: serverKey.trim(),
        baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
      };
    }
  }
  return {
    apiKey: process.env.OPENAI_API_KEY?.trim() || undefined,
    baseURL: process.env.OPENAI_BASE_URL?.trim() || undefined,
  };
}

/**
 * Returns an OpenAI-compatible client configured with the given options or server env.
 * - apiKey: options.apiKey ?? process.env.OPENAI_API_KEY
 * - baseURL: options.baseURL ?? process.env.OPENAI_BASE_URL (if set)
 */
export function getOpenAICompatibleClient(
  options?: LLMClientOptions
): OpenAI | null {
  const apiKey = options?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey || apiKey.trim() === "") {
    return null;
  }
  const baseURL = options?.baseURL ?? process.env.OPENAI_BASE_URL;
  const config: { apiKey: string; baseURL?: string } = { apiKey };
  if (baseURL && baseURL.trim() !== "") {
    config.baseURL = baseURL.trim();
  }
  return new OpenAI(config);
}
