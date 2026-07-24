/**
 * Canonical render identity and deterministic object keys.
 *
 * Pure functions only — no IO, no environment reads. Both the Workflow
 * and Activities may import this module (it is safe inside the Workflow
 * sandbox except computeRenderKey, which uses node:crypto and belongs on
 * the starter/Activity side; the Workflow receives renderKey as input).
 *
 * Key formats (spec of record):
 *   workflowId = "podcast-render/" + renderKey
 *   chunkKey   = "podcast-renders/" + renderKey + "/chunks/" + zeroPad(index) + "." + format
 *   finalKey   = "podcast-renders/" + renderKey + "/final." + format
 */

import { createHash } from "node:crypto";
import { AudioFormat } from "../types";
import { RenderKeyInput } from "./types";

/**
 * Serialize a value to canonical JSON: object keys sorted, no whitespace,
 * stable across property insertion order. Throws on undefined values
 * anywhere in the tree, so an omitted field can never silently acquire a
 * new default and change an identity hash. Also rejects non-finite
 * numbers and non-plain objects (Date, Map, class instances), which
 * JSON.stringify would silently mangle.
 */
export function canonicalJson(value: unknown): string {
  return serialize(value, "$");
}

function serialize(value: unknown, path: string): string {
  if (value === undefined) {
    throw new Error(`canonicalJson: undefined value at ${path}`);
  }
  if (value === null) {
    return "null";
  }
  const t = typeof value;
  if (t === "boolean" || t === "string") {
    return JSON.stringify(value);
  }
  if (t === "number") {
    if (!Number.isFinite(value as number)) {
      throw new Error(`canonicalJson: non-finite number at ${path}`);
    }
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    const items = value.map((v, i) => serialize(v, `${path}[${i}]`));
    return `[${items.join(",")}]`;
  }
  if (t === "object") {
    const proto = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) {
      throw new Error(`canonicalJson: non-plain object at ${path}`);
    }
    const record = value as Record<string, unknown>;
    const entries = Object.keys(record)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${serialize(record[k], `${path}.${k}`)}`);
    return `{${entries.join(",")}}`;
  }
  throw new Error(`canonicalJson: unsupported ${t} at ${path}`);
}

/**
 * renderKey = sha256(canonicalJson(input)), lowercase hex, no prefix.
 * The bare hex embeds directly into workflowIds and object keys.
 */
export function computeRenderKey(input: RenderKeyInput): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
}

export function workflowIdFor(renderKey: string): string {
  return `podcast-render/${renderKey}`;
}

/** Pad a 0-based chunk index to 3 digits ("000" ... "999"). */
export function zeroPad(index: number): string {
  if (!Number.isInteger(index) || index < 0) {
    throw new Error(`zeroPad: chunk index must be a non-negative integer, got ${index}`);
  }
  if (index > 999) {
    throw new Error(`zeroPad: chunk index ${index} exceeds 3-digit key space`);
  }
  return String(index).padStart(3, "0");
}

export function chunkKeyFor(renderKey: string, index: number, format: AudioFormat): string {
  return `podcast-renders/${renderKey}/chunks/${zeroPad(index)}.${format}`;
}

export function finalKeyFor(renderKey: string, format: AudioFormat): string {
  return `podcast-renders/${renderKey}/final.${format}`;
}
