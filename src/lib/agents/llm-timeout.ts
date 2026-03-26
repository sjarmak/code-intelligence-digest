const DEFAULT_AGENT_LLM_TIMEOUT_MS = 300000;

export class AgentLlmTimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(taskName: string, timeoutMs: number) {
    super(`${taskName} timed out after ${timeoutMs}ms`);
    this.name = "AgentLlmTimeoutError";
    this.timeoutMs = timeoutMs;
  }
}

export function getAgentLlmTimeoutMs(defaultMs = DEFAULT_AGENT_LLM_TIMEOUT_MS): number {
  const raw = Number(process.env.AGENT_LLM_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : defaultMs;
}

export async function withAgentLlmTimeout<T>(
  taskName: string,
  promise: Promise<T>,
  timeoutMs = getAgentLlmTimeoutMs(),
): Promise<T> {
  let timeoutHandle: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutHandle = setTimeout(() => reject(new AgentLlmTimeoutError(taskName, timeoutMs)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

export function isAgentLlmTimeoutError(error: unknown): error is AgentLlmTimeoutError {
  return error instanceof AgentLlmTimeoutError;
}
