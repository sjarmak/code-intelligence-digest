/**
 * Static self-consistency checks on the canonical Postgres schema string
 * (getPostgresSchema). Regression guard for the fresh-database bug where the
 * base schema indexed `paper_sections` / `ads_papers` (lines that only worked
 * because production already had those tables) but never CREATEd them — so a
 * brand-new local-primary DB failed at `CREATE INDEX ... ON paper_sections`.
 *
 * Rule: every table referenced by a CREATE INDEX in the schema MUST also be
 * CREATEd in the same schema. ADS-family tables (ads_papers, ads_library_papers,
 * ads_libraries) are intentionally owned by initializeADSTables() instead, so
 * the schema must not reference them at all.
 */
import { describe, it, expect } from "vitest";
import { getPostgresSchema } from "@/src/lib/db/schema-postgres";

const CREATE_TABLE_RE = /CREATE TABLE(?:\s+IF NOT EXISTS)?\s+"?([a-z_][a-z0-9_]*)"?/gi;
const CREATE_INDEX_RE = /CREATE(?:\s+UNIQUE)?\s+INDEX(?:\s+IF NOT EXISTS)?\s+\S+\s+ON\s+"?([a-z_][a-z0-9_]*)"?/gi;

function matchAll(re: RegExp, s: string): string[] {
  return [...s.matchAll(re)].map((m) => m[1]);
}

describe("postgres schema self-consistency", () => {
  const schema = getPostgresSchema();
  const created = new Set(matchAll(CREATE_TABLE_RE, schema));
  const indexed = matchAll(CREATE_INDEX_RE, schema);

  it("creates every table it indexes (no orphaned-index tables)", () => {
    const orphans = [...new Set(indexed)].filter((t) => !created.has(t));
    expect(orphans).toEqual([]);
  });

  it("defines paper_sections (its documented owner is the schema)", () => {
    expect(created.has("paper_sections")).toBe(true);
  });

  it("does not reference ADS-family tables (owned by initializeADSTables)", () => {
    expect(created.has("ads_papers")).toBe(false);
    expect(indexed).not.toContain("ads_papers");
  });
});
