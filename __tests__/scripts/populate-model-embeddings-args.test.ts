/**
 * Unit tests for the populate-model-embeddings.ts CLI arg parser, focused on the
 * --missing mode added for the scheduled "keep current" job (i4t.3). The module
 * guards its main() behind an import.meta entry check, so importing it here does
 * NOT run the encoder.
 */
import { describe, it, expect, vi } from "vitest";

vi.mock("@/src/lib/logger", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import { parseArgs } from "@/scripts/populate-model-embeddings";

describe("parseArgs", () => {
  it("defaults missing to false", () => {
    expect(parseArgs([]).missing).toBe(false);
  });

  it("sets missing when --missing is passed", () => {
    const opts = parseArgs(["--missing"]);
    expect(opts.missing).toBe(true);
    expect(opts.sinceDays).toBeNull();
  });

  it("rejects --missing combined with --since-days (mutually exclusive)", () => {
    expect(() => parseArgs(["--missing", "--since-days", "30"])).toThrow(/since-days/);
    expect(() => parseArgs(["--since-days", "30", "--missing"])).toThrow(/since-days/);
  });

  it("still parses page-size and batch-size in --missing mode", () => {
    const opts = parseArgs(["--missing", "--page-size", "128", "--batch-size", "8"]);
    expect(opts).toMatchObject({ missing: true, pageSize: 128, batchSize: 8 });
  });

  it("allows --missing combined with --limit (only --since-days is excluded)", () => {
    const opts = parseArgs(["--missing", "--limit", "100"]);
    expect(opts).toMatchObject({ missing: true, limit: 100 });
  });
});
