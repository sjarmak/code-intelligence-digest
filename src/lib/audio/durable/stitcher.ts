/**
 * Format-aware stitcher ("stitcher-v1") for the durable render path.
 *
 * Streams ordered chunk objects from the object store through ffmpeg's
 * concat demuxer to produce one valid final container at the deterministic
 * finalKey, then validates the result with ffprobe (readable container,
 * expected codec, duration ~= sum of chunk durations, full decode). It
 * never uses Buffer.concat: WAV files each carry their own RIFF header
 * (naive concatenation truncates duration to the first chunk), and MP3
 * files carry ID3/Xing metadata that corrupts a byte-glued stream.
 *
 * Idempotency: if a valid final object already exists at finalKey (a retry
 * after worker loss post-put), it is validated and reused; one final object
 * per renderKey.
 *
 * All IO stays on the Activity side; only StitchResult metadata may cross
 * into Workflow history (see CONTRACTS.md).
 */

import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioFormat } from "../types";
import { ChunkMetadata, StitchResult } from "./types";
import { finalKeyFor, zeroPad } from "./keys";
import { logger } from "../../logger";

/** Pins the assembly commands and encoding settings below. Changing either is a new version. */
export const STITCHER_VERSION = "stitcher-v1";

const FFMPEG_BIN = "/usr/bin/ffmpeg";
const FFPROBE_BIN = "/usr/bin/ffprobe";
const SUBPROCESS_MAX_BUFFER = 64 * 1024 * 1024;
const STDERR_MESSAGE_LIMIT = 2000;

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class StitcherError extends Error {}

/** The input contract was violated (wrong version, empty or non-contiguous chunk list). */
export class StitchInputError extends StitcherError {}

/** A referenced chunk object does not exist in the object store. */
export class ChunkObjectMissingError extends StitcherError {
  constructor(public readonly objectKey: string) {
    super(`chunk object missing from store: ${objectKey}`);
  }
}

/** Stored chunk bytes do not match the checksum recorded by renderChunk. */
export class ChunkChecksumMismatchError extends StitcherError {
  constructor(
    public readonly objectKey: string,
    public readonly expectedSha256: string,
    public readonly actualSha256: string
  ) {
    super(
      `chunk object ${objectKey} checksum mismatch: expected ${expectedSha256}, got ${actualSha256}`
    );
  }
}

/** An ffmpeg/ffprobe subprocess failed; carries full stderr for diagnosis. */
export class StitchProcessError extends StitcherError {
  constructor(
    public readonly tool: string,
    public readonly args: string[],
    public readonly exitCode: number | null,
    public readonly stderr: string
  ) {
    super(
      `${tool} exited with code ${exitCode}: ${stderr.slice(0, STDERR_MESSAGE_LIMIT)}`
    );
  }
}

/** The produced (or reused) artifact failed container/codec/duration/decode validation. */
export class StitchValidationError extends StitcherError {}

// ---------------------------------------------------------------------------
// Object store boundary
// ---------------------------------------------------------------------------

/**
 * The slice of the object store the stitcher needs. LocalStorageAdapter
 * (src/lib/storage/local.ts) satisfies this structurally.
 */
export interface StitchObjectStore {
  getObject(key: string): Promise<Buffer>;
  putObject(
    key: string,
    bytes: Buffer,
    contentType?: string
  ): Promise<{ url: string; bytes: number }>;
  exists(key: string): Promise<boolean>;
}

// ---------------------------------------------------------------------------
// Duration tolerance
// ---------------------------------------------------------------------------

/**
 * Default |final - sum(chunks)| tolerance in milliseconds.
 *
 * WAV is sample-exact through the concat demuxer, so 50ms is generous.
 * MP3 quantizes each file to whole MPEG frames (up to 72ms at 16kHz) and
 * LAME adds encoder delay/padding per encode, so the allowance scales with
 * chunk count. This is mechanical arithmetic over codec framing, not a
 * quality judgment.
 */
export function durationToleranceMs(format: AudioFormat, chunkCount: number): number {
  if (format === "wav") {
    return 50;
  }
  return 100 + 80 * chunkCount;
}

// ---------------------------------------------------------------------------
// Subprocess helpers
// ---------------------------------------------------------------------------

interface ToolResult {
  ok: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
}

/**
 * Run ffmpeg/ffprobe. Non-zero exit is returned to the caller (who decides
 * whether it is a process failure or a validation failure); only a spawn
 * failure (missing binary, EPERM) throws.
 */
function runTool(tool: string, args: string[]): Promise<ToolResult> {
  return new Promise((resolve, reject) => {
    execFile(
      tool,
      args,
      { maxBuffer: SUBPROCESS_MAX_BUFFER },
      (error, stdout, stderr) => {
        if (error && (error as NodeJS.ErrnoException).code === "ENOENT") {
          reject(new StitchProcessError(tool, args, null, `binary not found: ${tool}`));
          return;
        }
        if (error && typeof error.code !== "number" && error.code !== undefined) {
          // Spawn-level failure other than a plain non-zero exit.
          reject(new StitchProcessError(tool, args, null, String(error.message)));
          return;
        }
        const exitCode = error ? (typeof error.code === "number" ? error.code : null) : 0;
        resolve({ ok: !error, exitCode, stdout, stderr });
      }
    );
  });
}

// ---------------------------------------------------------------------------
// ffprobe validation
// ---------------------------------------------------------------------------

interface ProbeInfo {
  formatName: string;
  codecName: string;
  audioStreamCount: number;
  totalStreamCount: number;
  durationMs: number;
}

async function probeFile(filePath: string): Promise<ProbeInfo> {
  const result = await runTool(FFPROBE_BIN, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    filePath,
  ]);
  if (!result.ok) {
    throw new StitchValidationError(
      `ffprobe cannot read artifact (exit ${result.exitCode}): ${result.stderr.slice(0, STDERR_MESSAGE_LIMIT)}`
    );
  }

  let parsed: {
    format?: { format_name?: string; duration?: string };
    streams?: Array<{ codec_type?: string; codec_name?: string }>;
  };
  try {
    parsed = JSON.parse(result.stdout);
  } catch {
    throw new StitchValidationError(`ffprobe produced unparseable output for ${filePath}`);
  }

  const streams = parsed.streams ?? [];
  const audioStreams = streams.filter((s) => s.codec_type === "audio");
  const durationSeconds = Number(parsed.format?.duration);
  if (!Number.isFinite(durationSeconds)) {
    throw new StitchValidationError(
      `ffprobe reported no finite duration for ${filePath} (got ${parsed.format?.duration})`
    );
  }

  return {
    formatName: parsed.format?.format_name ?? "",
    codecName: audioStreams[0]?.codec_name ?? "",
    audioStreamCount: audioStreams.length,
    totalStreamCount: streams.length,
    durationMs: Math.round(durationSeconds * 1000),
  };
}

/**
 * Validate a stitched artifact on disk: correct container and codec for the
 * format, exactly one audio stream, duration within tolerance of the
 * expected sum, and a clean full decode (ffmpeg -f null with no errors).
 * Returns the probed duration. Throws StitchValidationError otherwise.
 *
 * This is the Stage-0 format gate: it rejects naive Buffer.concat output.
 * A byte-glued WAV keeps only the first chunk's RIFF data length, so its
 * probed duration is the first chunk's; a byte-glued MP3 fails the decode
 * pass on mid-stream ID3/Xing garbage ("Header missing").
 */
export async function validateStitchedFile(
  filePath: string,
  format: AudioFormat,
  expectedDurationMs: number,
  toleranceMs: number
): Promise<{ durationMs: number }> {
  const probe = await probeFile(filePath);

  const expectedContainer = format === "wav" ? "wav" : "mp3";
  if (probe.formatName !== expectedContainer) {
    throw new StitchValidationError(
      `container mismatch: expected ${expectedContainer}, ffprobe reports "${probe.formatName}"`
    );
  }
  const codecOk =
    format === "wav" ? probe.codecName.startsWith("pcm_") : probe.codecName === "mp3";
  if (!codecOk) {
    throw new StitchValidationError(
      `codec mismatch for ${format}: ffprobe reports "${probe.codecName}"`
    );
  }
  if (probe.audioStreamCount !== 1 || probe.totalStreamCount !== 1) {
    throw new StitchValidationError(
      `expected exactly one audio stream, found ${probe.audioStreamCount} audio / ${probe.totalStreamCount} total`
    );
  }

  const deltaMs = Math.abs(probe.durationMs - expectedDurationMs);
  if (deltaMs > toleranceMs) {
    throw new StitchValidationError(
      `duration mismatch: artifact is ${probe.durationMs}ms, expected ${expectedDurationMs}ms ` +
        `(sum of chunk durations), delta ${deltaMs}ms exceeds tolerance ${toleranceMs}ms`
    );
  }

  const decode = await runTool(FFMPEG_BIN, [
    "-v",
    "error",
    "-nostdin",
    "-i",
    filePath,
    "-f",
    "null",
    "-",
  ]);
  if (!decode.ok || decode.stderr.trim().length > 0) {
    throw new StitchValidationError(
      `artifact does not decode cleanly (exit ${decode.exitCode}): ${decode.stderr.slice(0, STDERR_MESSAGE_LIMIT)}`
    );
  }

  return { durationMs: probe.durationMs };
}

// ---------------------------------------------------------------------------
// Stitch
// ---------------------------------------------------------------------------

export interface StitchChunksInput {
  renderKey: string;
  format: AudioFormat;
  /** Must equal STITCHER_VERSION; a different version is a different render identity. */
  stitcherVersion: string;
  /** Ordered, contiguous from chunkIndex 0. */
  chunks: ChunkMetadata[];
  /** Override the per-format default duration tolerance (ms). */
  toleranceMs?: number;
}

function concatListLine(filePath: string): string {
  // concat-demuxer quoting: wrap in single quotes, escape embedded quotes.
  return `file '${filePath.replace(/'/g, "'\\''")}'`;
}

function encodeArgs(format: AudioFormat, listPath: string, outPath: string): string[] {
  const codecArgs =
    format === "wav"
      ? ["-c:a", "pcm_s16le"]
      : // Re-encode (not raw frame re-mux) so timestamps, Xing header, and
        // duration metadata are rebuilt for the joined stream.
        ["-c:a", "libmp3lame", "-q:a", "2"];
  return [
    "-hide_banner",
    "-nostdin",
    "-y",
    "-f",
    "concat",
    "-safe",
    "0",
    "-i",
    listPath,
    "-map",
    "0:a",
    ...codecArgs,
    outPath,
  ];
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

async function tryReuseExistingFinal(
  store: StitchObjectStore,
  finalKey: string,
  format: AudioFormat,
  expectedDurationMs: number,
  toleranceMs: number,
  tmpDir: string
): Promise<StitchResult | null> {
  if (!(await store.exists(finalKey))) {
    return null;
  }
  const bytes = await store.getObject(finalKey);
  const existingPath = path.join(tmpDir, `existing-final.${format}`);
  fs.writeFileSync(existingPath, bytes);
  try {
    const { durationMs } = await validateStitchedFile(
      existingPath,
      format,
      expectedDurationMs,
      toleranceMs
    );
    logger.info("Reusing validated final object", { finalKey, durationMs });
    return {
      objectKey: finalKey,
      checksumSha256: sha256Hex(bytes),
      byteCount: bytes.length,
      durationMs,
    };
  } catch (error) {
    if (error instanceof StitchValidationError) {
      logger.warn("Existing final object failed validation; re-stitching", {
        finalKey,
        error: error.message,
      });
      return null;
    }
    throw error;
  }
}

/**
 * Assemble ordered chunk objects into one validated final container at
 * finalKeyFor(renderKey, format) and return its metadata. Idempotent: a
 * valid existing final object is reused, an invalid one is replaced.
 */
export async function stitchChunks(
  input: StitchChunksInput,
  store: StitchObjectStore
): Promise<StitchResult> {
  if (input.stitcherVersion !== STITCHER_VERSION) {
    throw new StitchInputError(
      `stitcherVersion mismatch: this stitcher is ${STITCHER_VERSION}, input pinned ${input.stitcherVersion}`
    );
  }
  if (input.chunks.length === 0) {
    throw new StitchInputError("cannot stitch an empty chunk list");
  }
  input.chunks.forEach((chunk, i) => {
    if (chunk.chunkIndex !== i) {
      throw new StitchInputError(
        `chunk list must be contiguous and ordered from 0: position ${i} has chunkIndex ${chunk.chunkIndex}`
      );
    }
  });

  const expectedDurationMs = input.chunks.reduce((sum, c) => sum + c.durationMs, 0);
  const toleranceMs =
    input.toleranceMs ?? durationToleranceMs(input.format, input.chunks.length);
  const finalKey = finalKeyFor(input.renderKey, input.format);
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "stitcher-v1-"));

  try {
    const reused = await tryReuseExistingFinal(
      store,
      finalKey,
      input.format,
      expectedDurationMs,
      toleranceMs,
      tmpDir
    );
    if (reused !== null) {
      return reused;
    }

    const chunkPaths: string[] = [];
    for (const chunk of input.chunks) {
      if (!(await store.exists(chunk.objectKey))) {
        throw new ChunkObjectMissingError(chunk.objectKey);
      }
      const bytes = await store.getObject(chunk.objectKey);
      const actualSha256 = sha256Hex(bytes);
      if (actualSha256 !== chunk.checksumSha256) {
        throw new ChunkChecksumMismatchError(
          chunk.objectKey,
          chunk.checksumSha256,
          actualSha256
        );
      }
      const chunkPath = path.join(
        tmpDir,
        `chunk-${zeroPad(chunk.chunkIndex)}.${input.format}`
      );
      fs.writeFileSync(chunkPath, bytes);
      chunkPaths.push(chunkPath);
    }

    const listPath = path.join(tmpDir, "concat-list.txt");
    fs.writeFileSync(listPath, chunkPaths.map(concatListLine).join("\n") + "\n");
    const outPath = path.join(tmpDir, `final.${input.format}`);

    const args = encodeArgs(input.format, listPath, outPath);
    const result = await runTool(FFMPEG_BIN, args);
    if (!result.ok) {
      throw new StitchProcessError(FFMPEG_BIN, args, result.exitCode, result.stderr);
    }

    const { durationMs } = await validateStitchedFile(
      outPath,
      input.format,
      expectedDurationMs,
      toleranceMs
    );

    const finalBytes = fs.readFileSync(outPath);
    const contentType = input.format === "wav" ? "audio/wav" : "audio/mpeg";
    await store.putObject(finalKey, finalBytes, contentType);

    logger.info("Stitched final object", {
      finalKey,
      chunks: input.chunks.length,
      byteCount: finalBytes.length,
      durationMs,
    });

    return {
      objectKey: finalKey,
      checksumSha256: sha256Hex(finalBytes),
      byteCount: finalBytes.length,
      durationMs,
    };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
