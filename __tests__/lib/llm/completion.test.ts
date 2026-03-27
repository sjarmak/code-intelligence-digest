import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { anthropicCreateMock, openaiCreateMock } = vi.hoisted(() => ({
  anthropicCreateMock: vi.fn(),
  openaiCreateMock: vi.fn(),
}));

vi.mock("@anthropic-ai/sdk", () => ({
  default: function AnthropicMock(this: { messages: { create: typeof anthropicCreateMock } }) {
    this.messages = {
      create: anthropicCreateMock,
    };
  },
}));

vi.mock("openai", () => ({
  default: function OpenAIMock(
    this: { chat: { completions: { create: typeof openaiCreateMock } } },
  ) {
    this.chat = {
      completions: {
        create: openaiCreateMock,
      },
    };
  },
}));

describe("llm completion", () => {
  const originalEnv = {
    ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
    DIGEST_QUALITY_MODEL: process.env.DIGEST_QUALITY_MODEL,
    LLM_PROVIDER_TIMEOUT_MS: process.env.LLM_PROVIDER_TIMEOUT_MS,
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    process.env.ANTHROPIC_API_KEY = "anthropic-test-key";
    process.env.OPENAI_API_KEY = "openai-test-key";
    delete process.env.OPENAI_BASE_URL;
    delete process.env.DIGEST_QUALITY_MODEL;
    delete process.env.LLM_PROVIDER_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.ANTHROPIC_API_KEY = originalEnv.ANTHROPIC_API_KEY;
    process.env.OPENAI_API_KEY = originalEnv.OPENAI_API_KEY;
    process.env.OPENAI_BASE_URL = originalEnv.OPENAI_BASE_URL;
    process.env.DIGEST_QUALITY_MODEL = originalEnv.DIGEST_QUALITY_MODEL;
    process.env.LLM_PROVIDER_TIMEOUT_MS = originalEnv.LLM_PROVIDER_TIMEOUT_MS;
  });

  it("falls back to OpenAI when Anthropic times out", async () => {
    vi.useFakeTimers();
    process.env.LLM_PROVIDER_TIMEOUT_MS = "5";
    anthropicCreateMock.mockImplementationOnce(() => new Promise(() => {}));
    openaiCreateMock.mockResolvedValueOnce({
      model: "gpt-4o-mini",
      choices: [
        {
          finish_reason: "stop",
          message: { content: "fallback response" },
        },
      ],
    });

    const { createChatCompletion } = await import("../../../src/lib/llm/completion");
    const resultPromise = createChatCompletion({
      messages: [{ role: "user", content: "hello" }],
    });

    await vi.advanceTimersByTimeAsync(10);
    const result = await resultPromise;

    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).toHaveBeenCalledTimes(1);
    expect(result.content).toBe("fallback response");
    expect(result.model).toBe("gpt-4o-mini");
    expect(result.provider).toBe("openai");
  });

  it("throws when Anthropic times out and OpenAI is unavailable", async () => {
    vi.useFakeTimers();
    process.env.LLM_PROVIDER_TIMEOUT_MS = "5";
    process.env.OPENAI_API_KEY = "";
    anthropicCreateMock.mockImplementationOnce(() => new Promise(() => {}));

    const { createChatCompletion } = await import("../../../src/lib/llm/completion");
    const resultPromise = createChatCompletion({
      messages: [{ role: "user", content: "hello" }],
    }).catch((error) => error);

    await vi.advanceTimersByTimeAsync(10);

    const error = await resultPromise;
    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("No LLM client available");
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    expect(openaiCreateMock).not.toHaveBeenCalled();
  });
});
