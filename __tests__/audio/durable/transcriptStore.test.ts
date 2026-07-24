/**
 * Tests for the immutable content-addressed transcript store: put/loadSlice
 * round trips, multibyte byte-offset slicing, and the typed non-retryable
 * mismatch errors that keep a bad transcript from reaching a provider.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  ChunkSliceMismatchError,
  TranscriptHashMismatchError,
  TranscriptNotFoundError,
  TranscriptStore,
  transcriptRefFor,
} from "../../../src/lib/audio/durable/transcriptStore";
import { PlannedChunk } from "../../../src/lib/audio/durable/types";

const sha256 = (input: Buffer | string): string =>
  createHash("sha256").update(input).digest("hex");

/** Build a PlannedChunk for a char range of `text`, offsets and hash included. */
function chunkFor(text: string, charStart: number, charEnd: number, index = 0): PlannedChunk {
  const sliceText = text.slice(charStart, charEnd);
  const byteStart = Buffer.byteLength(text.slice(0, charStart), "utf8");
  return {
    index,
    charStart,
    charEnd,
    byteStart,
    byteEnd: byteStart + Buffer.byteLength(sliceText, "utf8"),
    chunkTextHash: sha256(Buffer.from(sliceText, "utf8")),
  };
}

describe("TranscriptStore", () => {
  let dir: string;
  let store: TranscriptStore;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "transcript-store-"));
    store = new TranscriptStore(dir);
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  describe("put", () => {
    it("stores the transcript under transcripts/<sha256>.txt", async () => {
      const text = "A podcast render that survives its worker.";
      const stored = await store.put(text);

      expect(stored.transcriptSha256).toBe(sha256(Buffer.from(text, "utf8")));
      expect(stored.transcriptRef).toBe(`transcripts/${stored.transcriptSha256}.txt`);
      expect(stored.byteCount).toBe(Buffer.byteLength(text, "utf8"));

      const onDisk = await fs.readFile(
        path.join(dir, "transcripts", `${stored.transcriptSha256}.txt`),
        "utf8"
      );
      expect(onDisk).toBe(text);
    });

    it("is idempotent for identical content", async () => {
      const text = "Same content, same key, no rewrite.";
      const first = await store.put(text);
      const second = await store.put(text);
      expect(second).toEqual(first);
    });

    it("content-addresses: different text gets a different reference", async () => {
      const a = await store.put("transcript one");
      const b = await store.put("transcript two");
      expect(a.transcriptRef).not.toBe(b.transcriptRef);
    });

    it("rejects an empty transcript", async () => {
      await expect(store.put("")).rejects.toThrow(/empty transcript/);
    });

    it("throws if the object at the content-addressed key is corrupt", async () => {
      const text = "The original transcript body.";
      const ref = transcriptRefFor(sha256(Buffer.from(text, "utf8")));
      const filePath = path.join(dir, ...ref.split("/"));
      await fs.mkdir(path.dirname(filePath), { recursive: true });
      await fs.writeFile(filePath, "tampered bytes at the immutable key");

      await expect(store.put(text)).rejects.toThrow(/corrupt/);
    });
  });

  describe("loadSlice", () => {
    it("returns exactly the planned chunk text", async () => {
      const text = "Chunk zero ends here. Chunk one carries the rest of the transcript.";
      const stored = await store.put(text);
      const chunk = chunkFor(text, 22, text.length, 1);

      const slice = await store.loadSlice(stored.transcriptRef, chunk, stored.transcriptSha256);
      expect(slice).toBe("Chunk one carries the rest of the transcript.");
    });

    it("slices correctly across multibyte characters using byte offsets", async () => {
      const text = "héllo wörld éé — ünïcode text with accents étendus";
      const stored = await store.put(text);
      const chunk = chunkFor(text, 6, 20, 0);

      const slice = await store.loadSlice(stored.transcriptRef, chunk, stored.transcriptSha256);
      expect(slice).toBe(text.slice(6, 20));
      expect(chunk.byteStart).not.toBe(chunk.charStart); // multibyte prefix shifted bytes
    });

    it("throws a non-retryable TranscriptHashMismatchError on digest mismatch", async () => {
      const text = "The transcript the identity was computed from.";
      const stored = await store.put(text);
      const chunk = chunkFor(text, 0, 10);
      const wrongHash = sha256("some other transcript");

      const err = await store
        .loadSlice(stored.transcriptRef, chunk, wrongHash)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TranscriptHashMismatchError);
      expect((err as TranscriptHashMismatchError).nonRetryable).toBe(true);
      expect((err as TranscriptHashMismatchError).expectedSha256).toBe(wrongHash);
    });

    it("throws a non-retryable ChunkSliceMismatchError when the plan hash disagrees", async () => {
      const text = "Planned against one transcript, sliced from another.";
      const stored = await store.put(text);
      const chunk = { ...chunkFor(text, 0, 20, 3), chunkTextHash: sha256("not this slice") };

      const err = await store
        .loadSlice(stored.transcriptRef, chunk, stored.transcriptSha256)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(ChunkSliceMismatchError);
      expect((err as ChunkSliceMismatchError).nonRetryable).toBe(true);
      expect((err as ChunkSliceMismatchError).chunkIndex).toBe(3);
    });

    it("throws TranscriptNotFoundError for a missing reference", async () => {
      const ref = transcriptRefFor(sha256("never stored"));
      const chunk = chunkFor("never stored", 0, 5);
      await expect(store.loadSlice(ref, chunk, sha256("never stored"))).rejects.toBeInstanceOf(
        TranscriptNotFoundError
      );
    });

    it("rejects malformed or path-traversing references", async () => {
      const chunk = chunkFor("x", 0, 1);
      const hash = sha256("x");
      await expect(store.loadSlice("../../etc/passwd", chunk, hash)).rejects.toThrow(
        /invalid transcript reference/
      );
      await expect(store.loadSlice("transcripts/nothex.txt", chunk, hash)).rejects.toThrow(
        /invalid transcript reference/
      );
    });

    it("rejects out-of-bounds byte ranges", async () => {
      const text = "short transcript";
      const stored = await store.put(text);
      const chunk = { ...chunkFor(text, 0, 5), byteEnd: 10_000 };

      await expect(
        store.loadSlice(stored.transcriptRef, chunk, stored.transcriptSha256)
      ).rejects.toThrow(/byte range .* is invalid/);
    });
  });

  describe("load", () => {
    it("returns the full transcript when the digest matches", async () => {
      const text = "The full transcript the plan Activity will re-chunk.";
      const stored = await store.put(text);

      await expect(store.load(stored.transcriptRef, stored.transcriptSha256)).resolves.toBe(
        text
      );
    });

    it("throws a non-retryable TranscriptHashMismatchError on digest mismatch", async () => {
      const stored = await store.put("stored bytes");
      const wrongHash = sha256("different bytes");

      const err = await store
        .load(stored.transcriptRef, wrongHash)
        .then(() => null)
        .catch((e: unknown) => e);
      expect(err).toBeInstanceOf(TranscriptHashMismatchError);
      expect((err as TranscriptHashMismatchError).nonRetryable).toBe(true);
    });

    it("throws TranscriptNotFoundError for a missing reference", async () => {
      const missingHash = sha256("never stored");
      await expect(
        store.load(transcriptRefFor(missingHash), missingHash)
      ).rejects.toBeInstanceOf(TranscriptNotFoundError);
    });
  });
});

describe("transcriptRefFor", () => {
  it("rejects anything that is not bare lowercase sha256 hex", () => {
    expect(() => transcriptRefFor("ABC")).toThrow(/64-char sha256 hex/);
    expect(() => transcriptRefFor("g".repeat(64))).toThrow(/64-char sha256 hex/);
  });
});
