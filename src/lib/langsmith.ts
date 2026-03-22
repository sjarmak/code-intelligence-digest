import { Client } from "langsmith";
import { traceable, type TraceableConfig } from "langsmith/traceable";

let cachedClient: Client | null | undefined;

function envFlag(name: string): boolean | undefined {
  const value = process.env[name]?.trim().toLowerCase();
  if (value == null || value === "") return undefined;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return undefined;
}

export function isLangSmithEnabled(): boolean {
  const tracingFlag = envFlag("LANGSMITH_TRACING");
  if (tracingFlag === false) return false;
  return Boolean(process.env.LANGSMITH_API_KEY?.trim());
}

export function isLangSmithLlmTracingEnabled(): boolean {
  if (!isLangSmithEnabled()) return false;
  return envFlag("LANGSMITH_TRACE_LLM") === true;
}

export function getLangSmithProjectName(defaultName = "code-intel-digest"): string {
  return process.env.LANGSMITH_PROJECT?.trim() || defaultName;
}

export function getLangSmithClient(): Client | null {
  if (!isLangSmithEnabled()) return null;
  if (cachedClient !== undefined) return cachedClient;

  cachedClient = new Client({
    apiKey: process.env.LANGSMITH_API_KEY,
    apiUrl: process.env.LANGSMITH_ENDPOINT?.trim() || process.env.LANGCHAIN_ENDPOINT?.trim(),
    webUrl: process.env.LANGSMITH_WEB_URL?.trim(),
    hideInputs: envFlag("LANGSMITH_HIDE_INPUTS") === true,
    hideOutputs: envFlag("LANGSMITH_HIDE_OUTPUTS") === true,
  });
  return cachedClient;
}

export function withLangSmithTraceable<Func extends (...args: any[]) => any>(
  fn: Func,
  config: TraceableConfig<Func> & { defaultProjectName?: string },
): Func {
  const client = getLangSmithClient();
  if (!client) return fn;

  const { defaultProjectName, ...traceConfig } = config;
  return traceable(fn, {
    client,
    project_name: traceConfig.project_name ?? getLangSmithProjectName(defaultProjectName),
    ...traceConfig,
  }) as unknown as Func;
}
