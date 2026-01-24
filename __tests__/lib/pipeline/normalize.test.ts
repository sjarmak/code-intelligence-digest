import { describe, it, expect } from "vitest";
import {
  extractInoreaderCategoryLabel,
  normalizeInoreaderLabelName,
} from "../../../src/lib/pipeline/normalize";

describe("Inoreader label normalization", () => {
  it("decodes URL-encoded label names", () => {
    expect(normalizeInoreaderLabelName("Newsletter%20Misc")).toBe(
      "Newsletter Misc"
    );
  });

  it("treats '+' as space in label names", () => {
    expect(normalizeInoreaderLabelName("Newsletter+Misc")).toBe(
      "Newsletter Misc"
    );
  });

  it("applies legacy alias for renamed label", () => {
    expect(normalizeInoreaderLabelName("Elevate")).toBe("Newsletter Misc");
    expect(normalizeInoreaderLabelName("eLeVaTe")).toBe("Newsletter Misc");
  });

  it("extracts label segment from category IDs", () => {
    expect(
      extractInoreaderCategoryLabel("user/1234/label/Newsletter%20Misc")
    ).toBe("Newsletter Misc");
  });
});

