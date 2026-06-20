/**
 * Guards the production → local mirror manifest. Regression for the
 * local-primary migration (bead uyn / P1.2): the mirror originally omitted
 * `item_model_embeddings` — the 139K nomic 768d vectors that are the whole
 * point of the migration — so a "full pull" silently left them behind.
 */
import { describe, it, expect } from "vitest";
import { MIRROR_TABLES, PROTECTED_TABLES } from "@/scripts/mirror-tables";

const byName = new Map(MIRROR_TABLES.map((t) => [t.name, t]));

describe("mirror table manifest", () => {
  it("mirrors the load-bearing corpus + embedding tables", () => {
    for (const name of [
      "items",
      "item_embeddings",
      "item_model_embeddings",
      "paper_sections",
      "ads_papers",
      "item_scores",
    ]) {
      expect(byName.has(name)).toBe(true);
    }
  });

  it("mirrors item_model_embeddings on its composite PK + generated_at watermark", () => {
    const t = byName.get("item_model_embeddings");
    expect(t?.strategy).toBe("incremental");
    expect(t?.pk).toEqual(["item_id", "model_name"]);
    expect(t?.watermarkCol).toBe("generated_at");
  });

  it("never mirrors a protected (user-owned) table", () => {
    const overlap = MIRROR_TABLES.filter((t) => PROTECTED_TABLES.has(t.name));
    expect(overlap.map((t) => t.name)).toEqual([]);
  });

  it("gives every incremental table a watermark column", () => {
    const bad = MIRROR_TABLES.filter(
      (t) => t.strategy === "incremental" && !t.watermarkCol,
    );
    expect(bad.map((t) => t.name)).toEqual([]);
  });
});
