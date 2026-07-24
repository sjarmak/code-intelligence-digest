/**
 * Kokoro-82M local TTS adapter ("kokoro" provider, model "kokoro-82m").
 *
 * This is the real-provider path of the durable render: the same engine the
 * digest product uses in production (hexgrad/Kokoro-82M via the
 * ~/.venvs/kokoro-tts virtualenv), run locally at $0 per render. One
 * subprocess per chunk: the adapter writes the chunk text to a temp file,
 * invokes scripts/kokoro-chunk-render.py inside the Kokoro venv, and reads
 * back the 24 kHz mono WAV. WAV is the only output format — it is the
 * stitcher's sample-exact validated path (stitcher.ts).
 *
 * The subprocess call is async (never spawnSync) so the renderChunk
 * Activity's heartbeat interval keeps firing during multi-minute CPU
 * synthesis; worker loss is still detected via the 15s heartbeatTimeout.
 *
 * Ledger accounting (provider_attempt / provider_commit) and the
 * deterministic providerRequestId stay in activities.ts, shared with every
 * real provider; this module only turns text into bytes.
 *
 * KOKORO_SPEED is pinned here, not configurable: speed changes rendered
 * bytes but is not part of RenderConfig, so a different speed must ship as
 * a new providerModel name (a new render identity), never as a flag.
 */

import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { AudioFormat } from "../../types";

export const KOKORO_MODEL = "kokoro-82m";
export const KOKORO_DEFAULT_VOICE = "am_onyx";
/** Production digest default; pinned by KOKORO_MODEL (see module doc). */
export const KOKORO_SPEED = 0.85;

const SUBPROCESS_MAX_BUFFER = 16 * 1024 * 1024;
const STDERR_MESSAGE_LIMIT = 2000;

/** One chunk's render input. `text` is plain spoken prose, never markdown. */
export interface KokoroChunkRequest {
  text: string;
  voice: string;
  format: AudioFormat;
}

/** WAV bytes; duration is probed by the caller (activities.probeDurationMs). */
export interface KokoroChunkResult {
  bytes: Buffer;
}

/** The subprocess boundary; tests inject a fake, production runs execFile. */
export type KokoroRunner = (python: string, args: string[]) => Promise<void>;

/** Environment slice the adapter reads (a plain record so tests can inject one). */
export type KokoroEnv = Record<string, string | undefined>;

export interface KokoroDeps {
  runRenderer?: KokoroRunner;
  /** Environment to resolve $KOKORO_VENV from (tests inject a fake venv). */
  env?: KokoroEnv;
}

/** Venv python path: $KOKORO_VENV (default ~/.venvs/kokoro-tts) + bin/python. Pure. */
export function kokoroPythonPath(env: KokoroEnv): string {
  const venv = env.KOKORO_VENV ?? path.join(os.homedir(), ".venvs", "kokoro-tts");
  return path.join(venv, "bin", "python");
}

/**
 * Per-chunk renderer script, resolved from the repo root (both the durable
 * worker and the test runner start with cwd = repo root); $KOKORO_RENDER_SCRIPT
 * overrides for non-root callers.
 */
export function kokoroRenderScriptPath(env: KokoroEnv): string {
  return (
    env.KOKORO_RENDER_SCRIPT ?? path.resolve(process.cwd(), "scripts", "kokoro-chunk-render.py")
  );
}

const defaultRunner: KokoroRunner = (python, args) =>
  new Promise((resolve, reject) => {
    execFile(python, args, { maxBuffer: SUBPROCESS_MAX_BUFFER }, (error, _stdout, stderr) => {
      if (error) {
        reject(
          new Error(
            `kokoro-chunk-render.py failed (${error.message.split("\n")[0]}): ` +
              stderr.slice(-STDERR_MESSAGE_LIMIT)
          )
        );
        return;
      }
      resolve();
    });
  });

export class KokoroTtsProvider {
  private readonly runRenderer: KokoroRunner;
  private readonly env: KokoroEnv;

  constructor(deps: KokoroDeps = {}) {
    this.runRenderer = deps.runRenderer ?? defaultRunner;
    this.env = deps.env ?? process.env;
  }

  getName(): string {
    return KOKORO_MODEL;
  }

  async render(req: KokoroChunkRequest): Promise<KokoroChunkResult> {
    if (req.format !== "wav") {
      throw new Error(`kokoro adapter renders wav only, got format "${req.format}"`);
    }
    if (req.text.trim().length === 0) {
      throw new Error("kokoro adapter received empty chunk text");
    }
    const python = kokoroPythonPath(this.env);
    if (!existsSync(python)) {
      throw new Error(
        `Kokoro venv python not found at ${python} — create the venv or set $KOKORO_VENV`
      );
    }
    const script = kokoroRenderScriptPath(this.env);
    if (!existsSync(script)) {
      throw new Error(
        `kokoro renderer script not found at ${script} — set $KOKORO_RENDER_SCRIPT`
      );
    }

    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "kokoro-chunk-"));
    try {
      const inPath = path.join(tmpDir, "chunk.txt");
      const outPath = path.join(tmpDir, "chunk.wav");
      await fs.writeFile(inPath, req.text, "utf8");

      await this.runRenderer(python, [
        script,
        "--in",
        inPath,
        "--out",
        outPath,
        "--voice",
        req.voice,
        "--speed",
        String(KOKORO_SPEED),
      ]);

      let bytes: Buffer;
      try {
        bytes = await fs.readFile(outPath);
      } catch {
        throw new Error(
          `kokoro renderer exited 0 but wrote no output at ${outPath} (voice ${req.voice})`
        );
      }
      if (bytes.length === 0) {
        throw new Error(`kokoro renderer wrote an empty file at ${outPath}`);
      }
      return { bytes };
    } finally {
      await fs.rm(tmpDir, { recursive: true, force: true });
    }
  }
}
