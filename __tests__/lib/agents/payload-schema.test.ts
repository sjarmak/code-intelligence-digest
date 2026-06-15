import { describe, expect, it } from "vitest";

import {
  AGENT_PAYLOAD_SCHEMA_VERSION,
  readAgentPayloadSchemaVersion,
} from "../../../src/lib/agents/payload-schema";

describe("agent payload schema version", () => {
  it("exposes a positive integer current version", () => {
    expect(Number.isInteger(AGENT_PAYLOAD_SCHEMA_VERSION)).toBe(true);
    expect(AGENT_PAYLOAD_SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
  });

  it("reads the current version from a freshly produced payload", () => {
    const payload = { schemaVersion: AGENT_PAYLOAD_SCHEMA_VERSION, items: [] };
    expect(readAgentPayloadSchemaVersion(payload)).toBe(AGENT_PAYLOAD_SCHEMA_VERSION);
  });

  it("treats legacy rows with no schemaVersion as version 0", () => {
    // Rows persisted before bd-225 (no `schemaVersion` key).
    const legacy = { generatedAt: "2026-02-01", items: [] };
    expect(readAgentPayloadSchemaVersion(legacy)).toBe(0);
  });

  it("reads an explicit older integer version unchanged", () => {
    expect(readAgentPayloadSchemaVersion({ schemaVersion: 2 })).toBe(2);
    expect(readAgentPayloadSchemaVersion({ schemaVersion: 0 })).toBe(0);
  });

  it("falls back to 0 for null, undefined, and non-object payloads", () => {
    expect(readAgentPayloadSchemaVersion(null)).toBe(0);
    expect(readAgentPayloadSchemaVersion(undefined)).toBe(0);
    expect(readAgentPayloadSchemaVersion("1")).toBe(0);
    expect(readAgentPayloadSchemaVersion(42)).toBe(0);
  });

  it("falls back to 0 for malformed schemaVersion values", () => {
    expect(readAgentPayloadSchemaVersion({ schemaVersion: "1" })).toBe(0);
    expect(readAgentPayloadSchemaVersion({ schemaVersion: 1.5 })).toBe(0);
    expect(readAgentPayloadSchemaVersion({ schemaVersion: -1 })).toBe(0);
    expect(readAgentPayloadSchemaVersion({ schemaVersion: Number.NaN })).toBe(0);
    expect(readAgentPayloadSchemaVersion({ schemaVersion: null })).toBe(0);
  });
});
