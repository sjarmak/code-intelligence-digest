/**
 * Immutable content-addressed store for sanitized transcripts.
 *
 * The starter persists the sanitized transcript here and passes only the
 * reference (`transcripts/<sha256>.txt`) plus its digest into the Workflow,
 * so raw transcript text never enters Workflow history. Activities call
 * loadSlice to recover exactly one planned chunk's text, re-verifying both
 * the full-transcript digest and the per-chunk hash before any provider
 * call. A hash mismatch is a typed non-retryable error: retrying cannot fix
 * a transcript that no longer matches the identity the render was keyed on.
 *
 * Objects are content-addressed and therefore immutable: the same text
 * always lands at the same key, and an existing object with different bytes
 * at that key is corruption, not a value to overwrite.
 */

import { createHash, randomBytes } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { PlannedChunk } from "./types";

/** Default root of the local application object store (matches LocalStorageAdapter). */
export const DEFAULT_OBJECT_STORE_DIR = path.join(process.cwd(), ".data", "audio");

const TRANSCRIPT_REF_PATTERN = /^transcripts\/([0-9a-f]{64})\.txt$/;

/** Object key for a sanitized transcript with the given sha256 hex digest. */
export function transcriptRefFor(transcriptSha256: string): string {
  if (!/^[0-9a-f]{64}$/.test(transcriptSha256)) {
    throw new Error(
      `transcriptRefFor: expected bare lowercase 64-char sha256 hex, got "${transcriptSha256}"`
    );
  }
  return `transcripts/${transcriptSha256}.txt`;
}

/**
 * The stored transcript's bytes do not hash to the digest the render
 * identity was computed from. Non-retryable: the Workflow must fail before
 * any provider call is made (spec fault matrix, "Non-retryable input error").
 */
export class TranscriptHashMismatchError extends Error {
  readonly nonRetryable = true as const;

  constructor(
    readonly transcriptRef: string,
    readonly expectedSha256: string,
    readonly actualSha256: string
  ) {
    super(
      `transcript at ${transcriptRef} hashes to ${actualSha256}, expected ${expectedSha256}`
    );
    this.name = "TranscriptHashMismatchError";
  }
}

/**
 * The planned chunk's byte range does not reproduce the chunk text the plan
 * hashed. Non-retryable: the plan and the transcript disagree, so rendering
 * this chunk would produce audio for text the identity never covered.
 */
export class ChunkSliceMismatchError extends Error {
  readonly nonRetryable = true as const;

  constructor(readonly transcriptRef: string, readonly chunkIndex: number, detail: string) {
    super(`chunk ${chunkIndex} of ${transcriptRef}: ${detail}`);
    this.name = "ChunkSliceMismatchError";
  }
}

/** No object exists at the transcript reference (transcript-reference loss). */
export class TranscriptNotFoundError extends Error {
  constructor(readonly transcriptRef: string) {
    super(`no transcript object at ${transcriptRef}`);
    this.name = "TranscriptNotFoundError";
  }
}

export interface StoredTranscript {
  /** Object key: transcripts/<sha256>.txt */
  transcriptRef: string;
  /** sha256 hex of the transcript's UTF-8 bytes. */
  transcriptSha256: string;
  byteCount: number;
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

export class TranscriptStore {
  constructor(private readonly baseDir: string = DEFAULT_OBJECT_STORE_DIR) {}

  /**
   * Persist a sanitized transcript under its content-addressed key.
   * Idempotent: re-putting identical text is a no-op returning the same
   * reference. An existing object with different bytes at the key throws,
   * because content-addressed objects are immutable by construction.
   */
  async put(sanitizedTranscript: string): Promise<StoredTranscript> {
    if (sanitizedTranscript.length === 0) {
      throw new Error("TranscriptStore.put: refusing to store an empty transcript");
    }
    const bytes = Buffer.from(sanitizedTranscript, "utf8");
    const transcriptSha256 = sha256Hex(bytes);
    const transcriptRef = transcriptRefFor(transcriptSha256);
    const filePath = this.filePathFor(transcriptRef);

    const existing = await readFileIfExists(filePath);
    if (existing !== null) {
      const existingSha = sha256Hex(existing);
      if (existingSha !== transcriptSha256) {
        throw new Error(
          `TranscriptStore.put: object at ${transcriptRef} is corrupt ` +
            `(hashes to ${existingSha}, key says ${transcriptSha256})`
        );
      }
      return { transcriptRef, transcriptSha256, byteCount: bytes.length };
    }

    await fs.mkdir(path.dirname(filePath), { recursive: true });
    // Atomic write: fsync a temp file, then rename onto the immutable key so
    // a kill mid-write can never leave a partial object at the reference.
    const tmpPath = `${filePath}.tmp-${process.pid}-${randomBytes(4).toString("hex")}`;
    try {
      const handle = await fs.open(tmpPath, "wx");
      try {
        await handle.writeFile(bytes);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await fs.rename(tmpPath, filePath);
    } catch (error) {
      await fs.rm(tmpPath, { force: true });
      throw error;
    }

    return { transcriptRef, transcriptSha256, byteCount: bytes.length };
  }

  /**
   * Load the full sanitized transcript, verifying existence and digest.
   * The loadAndPlan Activity uses this to re-plan chunks from the exact
   * bytes the render identity was computed from. A digest mismatch is the
   * spec's non-retryable input error.
   */
  async load(transcriptRef: string, expectedTranscriptHash: string): Promise<string> {
    const filePath = this.filePathFor(transcriptRef);

    const bytes = await readFileIfExists(filePath);
    if (bytes === null) {
      throw new TranscriptNotFoundError(transcriptRef);
    }

    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== expectedTranscriptHash) {
      throw new TranscriptHashMismatchError(transcriptRef, expectedTranscriptHash, actualSha256);
    }
    return bytes.toString("utf8");
  }

  /**
   * Load exactly one planned chunk's text. Verifies, in order:
   * 1. the object exists (TranscriptNotFoundError),
   * 2. the full transcript hashes to expectedTranscriptHash
   *    (TranscriptHashMismatchError, non-retryable),
   * 3. the chunk's byte range is in bounds and its bytes hash to
   *    chunk.chunkTextHash and decode as valid UTF-8
   *    (ChunkSliceMismatchError, non-retryable).
   */
  async loadSlice(
    transcriptRef: string,
    chunk: PlannedChunk,
    expectedTranscriptHash: string
  ): Promise<string> {
    const filePath = this.filePathFor(transcriptRef);

    const bytes = await readFileIfExists(filePath);
    if (bytes === null) {
      throw new TranscriptNotFoundError(transcriptRef);
    }

    const actualSha256 = sha256Hex(bytes);
    if (actualSha256 !== expectedTranscriptHash) {
      throw new TranscriptHashMismatchError(transcriptRef, expectedTranscriptHash, actualSha256);
    }

    const { byteStart, byteEnd } = chunk;
    if (
      !Number.isInteger(byteStart) ||
      !Number.isInteger(byteEnd) ||
      byteStart < 0 ||
      byteEnd <= byteStart ||
      byteEnd > bytes.length
    ) {
      throw new ChunkSliceMismatchError(
        transcriptRef,
        chunk.index,
        `byte range [${byteStart}, ${byteEnd}) is invalid for a ${bytes.length}-byte transcript`
      );
    }

    const slice = bytes.subarray(byteStart, byteEnd);
    const sliceSha256 = sha256Hex(Buffer.from(slice));
    if (sliceSha256 !== chunk.chunkTextHash) {
      throw new ChunkSliceMismatchError(
        transcriptRef,
        chunk.index,
        `slice hashes to ${sliceSha256}, plan says ${chunk.chunkTextHash}`
      );
    }

    const text = slice.toString("utf8");
    if (!Buffer.from(text, "utf8").equals(slice)) {
      throw new ChunkSliceMismatchError(
        transcriptRef,
        chunk.index,
        "byte range does not fall on UTF-8 character boundaries"
      );
    }
    return text;
  }

  /** Resolve a transcript reference to a path, rejecting anything that is not a well-formed ref. */
  private filePathFor(transcriptRef: string): string {
    if (!TRANSCRIPT_REF_PATTERN.test(transcriptRef)) {
      throw new Error(
        `invalid transcript reference "${transcriptRef}": expected transcripts/<sha256>.txt`
      );
    }
    return path.join(this.baseDir, ...transcriptRef.split("/"));
  }
}

async function readFileIfExists(filePath: string): Promise<Buffer | null> {
  try {
    return await fs.readFile(filePath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}
