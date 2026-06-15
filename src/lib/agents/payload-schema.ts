/**
 * Versioned schema tag for persisted GTM agent output payloads
 * (`CompetitorIntelOutput`, `MarketBriefOutput`, `ContentIdeasOutput`).
 *
 * These payloads are stored in `agent_runs.output_metadata.structuredPayload`
 * and read back later by `/reports/[id]`. Without a version tag, a non-backward-
 * compatible shape change silently mis-renders older rows. Stamping a version
 * lets readers detect and migrate rows written under an older shape.
 *
 * Mirrors `CURATOR_TRACE_SCHEMA_VERSION` (trace shapes) in `curator-trace.ts`.
 * Bump when changing any persisted output payload shape in a way that older
 * readers cannot interpret.
 */
export const AGENT_PAYLOAD_SCHEMA_VERSION = 1 as const;

/**
 * Schema version of a persisted agent payload read back from the database.
 *
 * Rows written before payload versioning was introduced (bd-225) have no
 * `schemaVersion` key; those — and any malformed value — are reported as
 * version `0` so callers can branch on `< AGENT_PAYLOAD_SCHEMA_VERSION` to
 * detect legacy shapes.
 */
export function readAgentPayloadSchemaVersion(payload: unknown): number {
  if (!payload || typeof payload !== "object") return 0;
  const version = (payload as { schemaVersion?: unknown }).schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) {
    return 0;
  }
  return version;
}
