import { describe, expect, it } from "vitest";

import {
  findProductMentions,
  getCompetitorProducts,
  getProductById,
} from "../../src/config/products";

describe("products config", () => {
  it("includes Moderne as a selectable competitor product", () => {
    const moderne = getProductById("moderne");

    expect(moderne).toBeDefined();
    expect(moderne?.name).toBe("Moderne");
    expect(moderne?.category).toBe("code_search");
    expect(moderne?.isCompetitor).toBe(true);

    const competitorIds = getCompetitorProducts().map((product) => product.id);
    expect(competitorIds).toContain("moderne");
  });

  it("detects Moderne and OpenRewrite mentions in product text", () => {
    expect(
      findProductMentions(
        "Moderne shipped new Moderne Platform features for large-scale refactoring.",
      ),
    ).toContain("moderne");

    expect(
      findProductMentions(
        "OpenRewrite recipes now support additional migration workflows.",
      ),
    ).toContain("moderne");
  });
});
