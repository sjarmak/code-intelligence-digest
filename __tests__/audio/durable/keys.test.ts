/**
 * Tests for durable render identity: canonical JSON, renderKey, key formats.
 */

import { describe, it, expect } from "vitest";
import {
  canonicalJson,
  computeRenderKey,
  workflowIdFor,
  chunkKeyFor,
  finalKeyFor,
  zeroPad,
} from "../../../src/lib/audio/durable/keys";
import { RenderKeyInput } from "../../../src/lib/audio/durable/types";

const GOLDEN_INPUT: RenderKeyInput = {
  sanitizedTranscriptSha256:
    "9d1a2b3c4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8",
  provider: "demo",
  providerModel: "deterministic-v1",
  voice: "single-default",
  format: "wav",
  chunkerVersion: "chunker-v1",
  stitcherVersion: "stitcher-v1",
  renderPolicyVersion: "render-policy-v1",
};

// Precomputed sha256 of canonicalJson(GOLDEN_INPUT). If this assertion ever
// fails, the identity algorithm changed and every stored renderKey, chunk
// object, and workflowId is orphaned — that is a breaking migration, not a
// test to update casually.
const GOLDEN_RENDER_KEY =
  "0a591a85913c48557f5873010825325a900f0574f07d6ddaa4246070d6d16990";

describe("canonicalJson", () => {
  it("sorts object keys", () => {
    expect(canonicalJson({ b: 1, a: 2 })).toBe('{"a":2,"b":1}');
  });

  it("is stable across property insertion order", () => {
    const first = canonicalJson({ voice: "alloy", provider: "demo", format: "wav" });
    const second = canonicalJson({ format: "wav", provider: "demo", voice: "alloy" });
    expect(first).toBe(second);
  });

  it("sorts keys recursively and preserves array order", () => {
    const out = canonicalJson({ z: [{ b: 2, a: 1 }, 3], a: null });
    expect(out).toBe('{"a":null,"z":[{"a":1,"b":2},3]}');
  });

  it("throws on an undefined top-level property value", () => {
    expect(() => canonicalJson({ provider: "demo", voice: undefined })).toThrow(
      /undefined value at \$\.voice/
    );
  });

  it("throws on a nested undefined value", () => {
    expect(() => canonicalJson({ config: { format: undefined } })).toThrow(
      /undefined value at \$\.config\.format/
    );
  });

  it("throws on undefined array elements", () => {
    expect(() => canonicalJson({ chunks: [1, undefined] })).toThrow(
      /undefined value at \$\.chunks\[1\]/
    );
  });

  it("throws on non-finite numbers", () => {
    expect(() => canonicalJson({ n: NaN })).toThrow(/non-finite number at \$\.n/);
    expect(() => canonicalJson({ n: Infinity })).toThrow(/non-finite number/);
  });

  it("throws on non-plain objects that JSON.stringify would mangle", () => {
    expect(() => canonicalJson({ at: new Date(0) })).toThrow(/non-plain object at \$\.at/);
  });
});

describe("computeRenderKey", () => {
  it("matches the golden value for the fixture identity", () => {
    expect(computeRenderKey(GOLDEN_INPUT)).toBe(GOLDEN_RENDER_KEY);
  });

  it("is insensitive to field order", () => {
    const reordered = {
      format: GOLDEN_INPUT.format,
      voice: GOLDEN_INPUT.voice,
      provider: GOLDEN_INPUT.provider,
      renderPolicyVersion: GOLDEN_INPUT.renderPolicyVersion,
      providerModel: GOLDEN_INPUT.providerModel,
      stitcherVersion: GOLDEN_INPUT.stitcherVersion,
      sanitizedTranscriptSha256: GOLDEN_INPUT.sanitizedTranscriptSha256,
      chunkerVersion: GOLDEN_INPUT.chunkerVersion,
    } satisfies RenderKeyInput;
    expect(computeRenderKey(reordered)).toBe(GOLDEN_RENDER_KEY);
  });

  it("changes when any versioned input changes", () => {
    const rechunked = computeRenderKey({ ...GOLDEN_INPUT, chunkerVersion: "chunker-v2" });
    const revoiced = computeRenderKey({ ...GOLDEN_INPUT, voice: "onyx" });
    expect(rechunked).not.toBe(GOLDEN_RENDER_KEY);
    expect(revoiced).not.toBe(GOLDEN_RENDER_KEY);
    expect(rechunked).not.toBe(revoiced);
  });

  it("produces bare lowercase 64-char hex", () => {
    expect(computeRenderKey(GOLDEN_INPUT)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("key formats", () => {
  it("workflowIdFor uses the podcast-render/ prefix", () => {
    expect(workflowIdFor(GOLDEN_RENDER_KEY)).toBe(`podcast-render/${GOLDEN_RENDER_KEY}`);
  });

  it("chunkKeyFor zero-pads the 0-based index to 3 digits", () => {
    expect(chunkKeyFor(GOLDEN_RENDER_KEY, 6, "wav")).toBe(
      `podcast-renders/${GOLDEN_RENDER_KEY}/chunks/006.wav`
    );
    expect(chunkKeyFor(GOLDEN_RENDER_KEY, 0, "mp3")).toBe(
      `podcast-renders/${GOLDEN_RENDER_KEY}/chunks/000.mp3`
    );
  });

  it("finalKeyFor is format-suffixed under the render namespace", () => {
    expect(finalKeyFor(GOLDEN_RENDER_KEY, "wav")).toBe(
      `podcast-renders/${GOLDEN_RENDER_KEY}/final.wav`
    );
  });

  it("zeroPad pads to 3 digits and rejects invalid indexes", () => {
    expect(zeroPad(0)).toBe("000");
    expect(zeroPad(7)).toBe("007");
    expect(zeroPad(42)).toBe("042");
    expect(zeroPad(999)).toBe("999");
    expect(() => zeroPad(-1)).toThrow(/non-negative integer/);
    expect(() => zeroPad(2.5)).toThrow(/non-negative integer/);
    expect(() => zeroPad(1000)).toThrow(/exceeds 3-digit key space/);
  });
});
