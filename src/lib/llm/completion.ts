/**
 * Provider-agnostic chat completion. Uses Claude (Anthropic) when model is claude-* and
 * ANTHROPIC_API_KEY is set; otherwise OpenAI. Callers pass OpenAI-format messages.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import type { Message } from "@anthropic-ai/sdk/resources/messages/messages";
import { getOpenAICompatibleClient } from "./client";
import { getQualityModel, isClaudeModel, getAnthropicApiKey } from "./config";
import { logger } from "../logger";
import { isLangSmithLlmTracingEnabled, withLangSmithTraceable } from "../langsmith";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface CreateChatCompletionOptions {
  messages: ChatMessage[];
  model?: string;
  max_tokens?: number;
  /** OpenAI-only: response_format e.g. { type: "json_object" }. Ignored for Claude. */
  response_format?: { type: "text" | "json_object" };
  /** Optional OpenAI client options (BYOK). For Claude, ANTHROPIC_API_KEY is always from env. */
  openaiOptions?: { apiKey?: string; baseURL?: string };
}

export interface CreateChatCompletionResult {
  content: string;
  model: string;
  provider: "anthropic" | "openai";
  finish_reason?: string;
  /** True when a claude-* model was requested but OpenAI served the request. */
  fallback?: boolean;
}

const DEFAULT_ANTHROPIC_PROVIDER_TIMEOUT_MS = 300000;
const DEFAULT_OPENAI_PROVIDER_TIMEOUT_MS = 15000;

class LlmProviderTimeoutError extends Error {
  readonly provider: "anthropic" | "openai";
  readonly timeoutMs: number;

  constructor(provider: "anthropic" | "openai", timeoutMs: number) {
    super(`${provider} completion timed out after ${timeoutMs}ms`);
    this.name = "LlmProviderTimeoutError";
    this.provider = provider;
    this.timeoutMs = timeoutMs;
  }
}

function getLlmProviderTimeoutMs(
  provider: "anthropic" | "openai",
  defaultMs = provider === "anthropic" ? DEFAULT_ANTHROPIC_PROVIDER_TIMEOUT_MS : DEFAULT_OPENAI_PROVIDER_TIMEOUT_MS,
): number {
  const providerEnvName =
    provider === "anthropic" ? "ANTHROPIC_LLM_PROVIDER_TIMEOUT_MS" : "OPENAI_LLM_PROVIDER_TIMEOUT_MS";
  const raw =
    Number(process.env[providerEnvName]) || Number(process.env.LLM_PROVIDER_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultMs;
}

function isLlmProviderTimeoutError(error: unknown): error is LlmProviderTimeoutError {
  return error instanceof LlmProviderTimeoutError;
}

async function withProviderTimeout<T>(
  provider: "anthropic" | "openai",
  promise: Promise<T>,
  timeoutMs = getLlmProviderTimeoutMs(provider),
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new LlmProviderTimeoutError(provider, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

async function runProviderCompletion<T>(args: {
  provider: "anthropic" | "openai";
  model: string;
  operation: () => Promise<T>;
}): Promise<T> {
  const startedAt = Date.now();
  try {
    const result = await withProviderTimeout(args.provider, args.operation());
    logger.info("LLM provider completion succeeded", {
      provider: args.provider,
      model: args.model,
      durationMs: Date.now() - startedAt,
    });
    return result;
  } catch (error) {
    logger.warn("LLM provider completion failed", {
      provider: args.provider,
      model: args.model,
      durationMs: Date.now() - startedAt,
      timeout: isLlmProviderTimeoutError(error),
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

function convertToAnthropic(messages: ChatMessage[]): {
  system: string | undefined;
  messages: Array<{ role: "user" | "assistant"; content: string }>;
} {
  const systemParts: string[] = [];
  const chat: Array<{ role: "user" | "assistant"; content: string }> = [];
  for (const m of messages) {
    if (m.role === "system") {
      systemParts.push(m.content);
    } else {
      chat.push({
        role: m.role as "user" | "assistant",
        content: m.content,
      });
    }
  }
  return {
    system:
      systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    messages: chat,
  };
}

async function completeWithAnthropic(
  model: string,
  messages: ChatMessage[],
  maxTokens: number
): Promise<CreateChatCompletionResult> {
  const apiKey = getAnthropicApiKey();
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not set");
  }
  const client = new Anthropic({ apiKey });
  const { system, messages: anthropicMessages } = convertToAnthropic(messages);
  const body: Parameters<typeof client.messages.create>[0] = {
    model: model as Parameters<typeof client.messages.create>[0]["model"],
    max_tokens: maxTokens,
    messages: anthropicMessages,
  };
  if (system) {
    body.system = system;
  }
  const response = (await client.messages.create(body)) as Message;
  let content = "";
  for (const block of response.content) {
    if (block.type === "text" && "text" in block) {
      content = block.text;
      break;
    }
  }
  return {
    content,
    model: response.model,
    provider: "anthropic",
    finish_reason: response.stop_reason ?? undefined,
  };
}

async function completeWithOpenAI(
  client: OpenAI,
  model: string,
  messages: ChatMessage[],
  maxTokens: number,
  responseFormat?: { type: "text" | "json_object" }
): Promise<CreateChatCompletionResult> {
  const body: OpenAI.Chat.ChatCompletionCreateParamsNonStreaming = {
    model,
    max_tokens: maxTokens,
    messages: messages.map((m) => ({
      role: m.role as "system" | "user" | "assistant",
      content: m.content,
    })),
  };
  if (responseFormat) {
    body.response_format = responseFormat;
  }
  const response = await client.chat.completions.create(body);
  const choice = response.choices?.[0];
  const content = choice?.message?.content ?? "";
  return {
    content,
    model: response.model,
    provider: "openai",
    finish_reason: choice?.finish_reason ?? undefined,
  };
}

/**
 * Create a chat completion using the quality model (or the given model).
 * Uses Anthropic for claude-* models when ANTHROPIC_API_KEY is set; otherwise OpenAI.
 */
async function createChatCompletionImpl(
  options: CreateChatCompletionOptions
): Promise<CreateChatCompletionResult> {
  const model = options.model ?? getQualityModel();
  const maxTokens = options.max_tokens ?? 2000;

  if (isClaudeModel(model)) {
    const key = getAnthropicApiKey();
    if (key) {
      try {
        return await runProviderCompletion({
          provider: "anthropic",
          model,
          operation: () =>
            completeWithAnthropic(
              model,
              options.messages,
              maxTokens,
            ),
        });
      } catch (error) {
        logger.warn("Anthropic completion failed, falling back to OpenAI if available", {
          error: error instanceof Error ? error.message : String(error),
          model,
          timeout: isLlmProviderTimeoutError(error),
        });
        // Fall through to OpenAI fallback when possible
      }
    }
  }

  const openaiClient =
    options.openaiOptions &&
    (options.openaiOptions.apiKey ?? process.env.OPENAI_API_KEY)?.trim()
      ? new OpenAI({
          apiKey: options.openaiOptions!.apiKey ?? process.env.OPENAI_API_KEY!,
          baseURL: options.openaiOptions!.baseURL ?? process.env.OPENAI_BASE_URL,
        })
      : getOpenAICompatibleClient(options.openaiOptions);

  if (!openaiClient) {
    throw new Error(
      "No LLM client available. Set OPENAI_API_KEY or ANTHROPIC_API_KEY (and use a claude-* model)."
    );
  }

  const effectiveModel = isClaudeModel(model)
    ? "gpt-4o-mini"
    : model;
  const usedFallback = isClaudeModel(model);
  if (usedFallback) {
    logger.warn("LLM degraded: claude model requested but OpenAI is serving the request", {
      requestedModel: model,
      effectiveModel,
    });
  }
  const result = await runProviderCompletion({
    provider: "openai",
    model: effectiveModel,
    operation: () =>
      completeWithOpenAI(
        openaiClient,
        effectiveModel,
        options.messages,
        maxTokens,
        options.response_format,
      ),
  });
  return usedFallback ? { ...result, fallback: true } : result;
}

export const createChatCompletion = isLangSmithLlmTracingEnabled()
  ? withLangSmithTraceable(createChatCompletionImpl, {
      name: "quality_model_completion",
      run_type: "llm",
      defaultProjectName: "code-intel-digest-llm",
      getInvocationParams: (options) => {
        const model = options.model ?? getQualityModel();
        return {
          ls_provider: isClaudeModel(model) ? "anthropic" : "openai",
          ls_model_name: isClaudeModel(model) && !getAnthropicApiKey() ? "gpt-4o-mini" : model,
          ls_model_type: "chat",
          ls_max_tokens: options.max_tokens ?? 2000,
          ls_invocation_params: {
            response_format: options.response_format?.type,
          },
        };
      },
      processInputs: (inputs) => {
        if (!("messages" in inputs) || !Array.isArray(inputs.messages)) return inputs;
        return {
          ...inputs,
          messages: inputs.messages.map((message) => ({
            role: message.role,
            content: message.content,
          })),
        };
      },
    })
  : createChatCompletionImpl;
