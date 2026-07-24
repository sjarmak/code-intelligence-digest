/**
 * Deterministic chunk planner ("chunker-v1") for the durable render path.
 *
 * Reproduces the boundary behavior of the legacy chunker in
 * src/lib/audio/render.ts byte-for-byte — same 3,800-character ceiling,
 * same break-point preference order (segment marker, paragraph, sentence),
 * same trim semantics — but returns offsets and hashes instead of text.
 * The raw transcript never appears in the plan; a PlannedChunk addresses
 * the sanitized transcript by [start, end) char and UTF-8 byte ranges and
 * pins the exact slice with a sha256.
 *
 * Pure given the sanitized transcript: no IO, no env, no clock. Any change
 * to boundary selection is a new chunkerVersion, which is a new renderKey.
 */

import { createHash } from "node:crypto";
import { ChunkPlan, PlannedChunk } from "./types";
import { canonicalJson } from "./keys";

export const CHUNKER_VERSION = "chunker-v1";

/** Same ceiling as the legacy chunker (OpenAI TTS 4096 limit minus buffer). */
export const MAX_CHUNK_CHARS = 3800;

function sha256Hex(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Half-open [charStart, charEnd) ranges into the sanitized transcript,
 * mirroring the legacy chunkText algorithm exactly: while more than
 * maxSize remains, prefer breaking after a "---" segment marker, then a
 * paragraph break, then a sentence end — each only when it lands past the
 * midpoint — otherwise cut hard at maxSize. Pushed chunks are trimmed;
 * the remainder is trimmed before the next iteration.
 */
function chunkRanges(text: string, maxSize: number): Array<[number, number]> {
  if (text.length <= maxSize) {
    return [[0, text.length]];
  }

  const ranges: Array<[number, number]> = [];
  let start = 0;
  let remaining = text;

  while (remaining.length > 0) {
    if (remaining.length <= maxSize) {
      ranges.push([start, start + remaining.length]);
      break;
    }

    let breakPoint = maxSize;

    const segmentBreak = remaining.lastIndexOf("---", maxSize);
    if (segmentBreak > maxSize * 0.5) {
      breakPoint = segmentBreak + 3;
    } else {
      const paragraphBreak = remaining.lastIndexOf("\n\n", maxSize);
      if (paragraphBreak > maxSize * 0.5) {
        breakPoint = paragraphBreak + 2;
      } else {
        const sentenceBreak = remaining.lastIndexOf(". ", maxSize);
        if (sentenceBreak > maxSize * 0.5) {
          breakPoint = sentenceBreak + 2;
        }
      }
    }

    const rawChunk = remaining.substring(0, breakPoint);
    const chunk = rawChunk.trim();
    const chunkLead = rawChunk.length - rawChunk.trimStart().length;
    ranges.push([start + chunkLead, start + chunkLead + chunk.length]);

    const rawRest = remaining.substring(breakPoint);
    const restLead = rawRest.length - rawRest.trimStart().length;
    start = start + breakPoint + restLead;
    remaining = rawRest.trim();
  }

  return ranges;
}

/**
 * Plan the render of a sanitized transcript under chunker-v1.
 *
 * The input must already be sanitized (sanitizeTranscriptForTts output);
 * planning raw markup would produce boundaries the render Activities
 * never see. planHash pins the full chunk list across Workflow replays.
 */
export function planChunks(renderKey: string, sanitizedTranscript: string): ChunkPlan {
  if (sanitizedTranscript.trim().length === 0) {
    throw new Error("planChunks: sanitized transcript is empty");
  }

  const chunks: PlannedChunk[] = chunkRanges(sanitizedTranscript, MAX_CHUNK_CHARS).map(
    ([charStart, charEnd], index) => ({
      index,
      charStart,
      charEnd,
      byteStart: Buffer.byteLength(sanitizedTranscript.slice(0, charStart), "utf8"),
      byteEnd: Buffer.byteLength(sanitizedTranscript.slice(0, charEnd), "utf8"),
      chunkTextHash: sha256Hex(sanitizedTranscript.slice(charStart, charEnd)),
    })
  );

  return {
    renderKey,
    chunkerVersion: CHUNKER_VERSION,
    planHash: sha256Hex(canonicalJson(chunks)),
    totalChunks: chunks.length,
    chunks,
  };
}
