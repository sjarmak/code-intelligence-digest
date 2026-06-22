/**
 * Behavioral regression guard (i4t.2): initializeDatabase() must EAGERLY create
 * the annotation tables (paper_annotations / paper_tags / paper_tag_links) by
 * invoking initializeAnnotationTables() — and after initializeADSTables(), since
 * those tables FK to ads_papers. Without this, a fresh local-primary DB lacks
 * the tables and mirror-from-production errors ("no columns in common") on every
 * run until the annotation feature happens to run first.
 *
 * All heavy deps are mocked, so this asserts the wiring, not real DDL.
 */
import { describe, it, expect, vi } from "vitest";

const { mockClient } = vi.hoisted(() => ({
  mockClient: {
    driver: "postgres",
    exec: vi.fn(async () => {}),
    run: vi.fn(async () => {}),
    // One row satisfies both the pgvector gate (extversion) and the
    // items.search_vector generated-column check (attgenerated === "s").
    query: vi.fn(async () => ({ rows: [{ extversion: "0.7.0", attgenerated: "s" }] })),
  },
}));

const { initializeADSTables } = vi.hoisted(() => ({
  initializeADSTables: vi.fn(async () => {}),
}));
const { initializeAnnotationTables } = vi.hoisted(() => ({
  initializeAnnotationTables: vi.fn(async () => {}),
}));

vi.mock("@/src/lib/logger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("@/src/lib/db/driver", () => ({
  getDbClient: vi.fn(async () => mockClient),
  resetDbClient: vi.fn(),
  detectDriver: vi.fn(),
  getFreshPostgresConnection: vi.fn(),
}));
vi.mock("@/src/lib/db/schema-postgres", () => ({
  getPostgresSchema: vi.fn(() => ""),
  ITEMS_SEARCH_TRIGGER_FUNCTION_SQL: "",
  ITEMS_SEARCH_TRIGGER_DROP_SQL: "",
  ITEMS_SEARCH_TRIGGER_CREATE_SQL: "",
}));
vi.mock("@/src/lib/db/ensure-user-id", () => ({
  ensurePostgresUserIdColumns: vi.fn(async () => {}),
}));
vi.mock("@/src/lib/db/api-budget", () => ({
  getApiBudget: vi.fn(),
  hasBudgetFor: vi.fn(),
  incrementApiCalls: vi.fn(),
  incrementGlobalApiCalls: vi.fn(),
  getGlobalApiBudget: vi.fn(),
}));
vi.mock("@/src/lib/db/ads-papers", () => ({ initializeADSTables }));
vi.mock("@/src/lib/db/paper-annotations", () => ({ initializeAnnotationTables }));

import { initializeDatabase } from "@/src/lib/db/index";

describe("initializeDatabase eager-inits annotation tables (i4t.2)", () => {
  it("invokes initializeAnnotationTables after initializeADSTables", async () => {
    await initializeDatabase();

    expect(initializeADSTables).toHaveBeenCalledTimes(1);
    expect(initializeAnnotationTables).toHaveBeenCalledTimes(1);
    // Ordering matters: annotation tables FK ads_papers, so ADS must run first.
    expect(initializeADSTables.mock.invocationCallOrder[0]).toBeLessThan(
      initializeAnnotationTables.mock.invocationCallOrder[0],
    );
  });
});
