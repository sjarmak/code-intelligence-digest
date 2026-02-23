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
  finish_reason?: string;
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
    finish_reason: choice?.finish_reason ?? undefined,
  };
}

/**
 * Create a chat completion using the quality model (or the given model).
 * Uses Anthropic for claude-* models when ANTHROPIC_API_KEY is set; otherwise OpenAI.
 */
export async function createChatCompletion(
  options: CreateChatCompletionOptions
): Promise<CreateChatCompletionResult> {
  const model = options.model ?? getQualityModel();
  const maxTokens = options.max_tokens ?? 2000;

  if (isClaudeModel(model)) {
    const key = getAnthropicApiKey();
    if (key) {
      try {
        return await completeWithAnthropic(
          model,
          options.messages,
          maxTokens
        );
      } catch (error) {
        logger.warn("Anthropic completion failed, falling back to OpenAI if available", {
          error: error instanceof Error ? error.message : String(error),
          model,
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
  return completeWithOpenAI(
    openaiClient,
    effectiveModel,
    options.messages,
    maxTokens,
    options.response_format
  );
}
