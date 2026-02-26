/**
 * Quality model configuration for digest pipelines (agents, newsletter, podcast, ask, etc.).
 * Default: Claude Sonnet 4.6 when ANTHROPIC_API_KEY is set; otherwise gpt-4o-mini for backward compatibility.
 */

const CLAUDE_MODEL_PREFIX = "claude-";

export function getQualityModel(): string {
  const envModel = process.env.DIGEST_QUALITY_MODEL?.trim();
  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  const openaiKey = process.env.OPENAI_API_KEY?.trim();

  if (envModel) {
    return envModel;
  }
  if (anthropicKey) {
    return "claude-sonnet-4-6";
  }
  if (openaiKey) {
    return "gpt-4o-mini";
  }
  return "gpt-4o-mini";
}

export function isClaudeModel(model: string): boolean {
  return model.toLowerCase().startsWith(CLAUDE_MODEL_PREFIX);
}

export function getAnthropicApiKey(): string | null {
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  return key && key.length > 0 ? key : null;
}

export function hasLLMConfigured(): boolean {
  return !!(getAnthropicApiKey() || process.env.OPENAI_API_KEY?.trim());
}
