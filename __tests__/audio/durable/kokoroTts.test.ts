/**
 * Kokoro-82M adapter tests.
 *
 * Unit: the text-to-invocation mapping with the subprocess boundary mocked
 * (venv python resolution, script path, --voice/--speed args, chunk text
 * written to --in, bytes read from --out) plus the loud failure paths.
 *
 * Activity level: provider selection in activities.ts rejects a wrong
 * providerModel or a non-wav format as non-retryable BEFORE any ledger
 * provider_attempt is emitted.
 *
 * Integration (skipped when the Kokoro venv is absent): renders a
 * one-sentence chunk through the real venv + scripts/kokoro-chunk-render.py
 * and validates the WAV with ffprobe.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { existsSync, promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { MockActivityEnvironment } from "@temporalio/testing";
import { ApplicationFailure } from "@temporalio/common";
import {
  KOKORO_DEFAULT_VOICE,
  KOKORO_MODEL,
  KOKORO_SPEED,
  KokoroRunner,
  KokoroTtsProvider,
  kokoroPythonPath,
} from "../../../src/lib/audio/durable/providers/kokoroTts";
import { createActivities } from "../../../src/lib/audio/durable/activities";
import { readLedger } from "../../../src/lib/audio/durable/ledger";
import { ChunkPlan, RenderConfig } from "../../../src/lib/audio/durable/types";
import {
  RenderFixture,
  buildTwoChunkTranscript,
  setupRenderFixture,
} from "./durableTestUtils";

const FFPROBE_BIN = "/usr/bin/ffprobe";
const realPython = kokoroPythonPath(process.env);
const venvAvailable = existsSync(realPython);

function argValue(args: string[], flag: string): string {
  const i = args.indexOf(flag);
  if (i === -1 || i === args.length - 1) {
    throw new Error(`flag ${flag} missing from args: ${args.join(" ")}`);
  }
  return args[i + 1];
}

describe("KokoroTtsProvider invocation mapping (subprocess mocked)", () => {
  let dir: string;
  let fakeVenv: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "kokoro-unit-"));
    fakeVenv = path.join(dir, "venv");
    await fs.mkdir(path.join(fakeVenv, "bin"), { recursive: true });
    await fs.writeFile(path.join(fakeVenv, "bin", "python"), "#!/bin/sh\n");
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("maps chunk text to one venv-python invocation and returns the output bytes", async () => {
    const seen: { python: string; args: string[]; inputText: string }[] = [];
    const wavBytes = Buffer.from("RIFFfake-wav-bytes-for-mapping-test");
    const runner: KokoroRunner = async (python, args) => {
      seen.push({
        python,
        args,
        inputText: await fs.readFile(argValue(args, "--in"), "utf8"),
      });
      await fs.writeFile(argValue(args, "--out"), wavBytes);
    };
    const provider = new KokoroTtsProvider({
      runRenderer: runner,
      env: { KOKORO_VENV: fakeVenv },
    });

    const text = "Durable execution keeps audio renders honest.";
    const result = await provider.render({ text, voice: KOKORO_DEFAULT_VOICE, format: "wav" });

    expect(seen).toHaveLength(1);
    expect(seen[0].python).toBe(path.join(fakeVenv, "bin", "python"));
    expect(seen[0].args[0].endsWith(path.join("scripts", "kokoro-chunk-render.py"))).toBe(true);
    expect(seen[0].inputText).toBe(text);
    expect(argValue(seen[0].args, "--voice")).toBe("am_onyx");
    expect(argValue(seen[0].args, "--speed")).toBe(String(KOKORO_SPEED));
    expect(result.bytes.equals(wavBytes)).toBe(true);
  });

  it("fails loudly when the venv python is missing", async () => {
    const provider = new KokoroTtsProvider({
      runRenderer: async () => {},
      env: { KOKORO_VENV: path.join(dir, "no-such-venv") },
    });
    await expect(
      provider.render({ text: "hi there.", voice: "am_onyx", format: "wav" })
    ).rejects.toThrow(/Kokoro venv python not found .*KOKORO_VENV/);
  });

  it("rejects non-wav formats", async () => {
    const provider = new KokoroTtsProvider({
      runRenderer: async () => {},
      env: { KOKORO_VENV: fakeVenv },
    });
    await expect(
      provider.render({ text: "hi there.", voice: "am_onyx", format: "mp3" })
    ).rejects.toThrow(/renders wav only/);
  });

  it("rejects empty chunk text without spawning", async () => {
    let spawned = 0;
    const provider = new KokoroTtsProvider({
      runRenderer: async () => {
        spawned += 1;
      },
      env: { KOKORO_VENV: fakeVenv },
    });
    await expect(
      provider.render({ text: "   ", voice: "am_onyx", format: "wav" })
    ).rejects.toThrow(/empty chunk text/);
    expect(spawned).toBe(0);
  });

  it("fails loudly when the renderer exits 0 but writes no output", async () => {
    const provider = new KokoroTtsProvider({
      runRenderer: async () => {},
      env: { KOKORO_VENV: fakeVenv },
    });
    await expect(
      provider.render({ text: "hi there.", voice: "am_onyx", format: "wav" })
    ).rejects.toThrow(/wrote no output/);
  });
});

describe("activities provider selection for kokoro", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "kokoro-acts-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  function kokoroConfig(overrides: Partial<RenderConfig> = {}): RenderConfig {
    return {
      provider: "kokoro",
      providerModel: KOKORO_MODEL,
      voice: KOKORO_DEFAULT_VOICE,
      format: "wav",
      chunkerVersion: "chunker-v1",
      stitcherVersion: "stitcher-v1",
      renderPolicyVersion: "render-policy-v1",
      ...overrides,
    };
  }

  async function renderFirstChunk(fixture: RenderFixture): Promise<unknown> {
    const activities = createActivities({
      objectStore: fixture.store,
      transcriptStore: fixture.transcripts,
      gates: {
        controlPath: fixture.controlPath,
        ledgerPath: fixture.ledgerPath,
        pollIntervalMs: 5,
      },
    });
    const env = new MockActivityEnvironment({ attempt: 1 });
    const plan = (await env.run(activities.loadAndPlan, {
      renderKey: fixture.renderKey,
      transcriptRef: fixture.transcriptRef,
      expectedTranscriptHash: fixture.transcriptSha256,
      config: fixture.config,
    })) as ChunkPlan;
    return new MockActivityEnvironment({ attempt: 1 }).run(activities.renderChunk, {
      renderKey: fixture.renderKey,
      transcriptRef: fixture.transcriptRef,
      transcriptSha256: fixture.transcriptSha256,
      chunk: plan.chunks[0],
      config: fixture.config,
    });
  }

  it("rejects a wrong providerModel as non-retryable, before any provider_attempt", async () => {
    const fixture = await setupRenderFixture(
      dir,
      buildTwoChunkTranscript("kokoro-model"),
      kokoroConfig({ providerModel: "kokoro-latest" })
    );
    const error = await renderFirstChunk(fixture).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).type).toBe("UnsupportedProviderModel");
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
    const attempts = readLedger(fixture.ledgerPath).filter((e) => e.type === "provider_attempt");
    expect(attempts).toHaveLength(0);
  });

  it("rejects a non-wav format as non-retryable, before any provider_attempt", async () => {
    const fixture = await setupRenderFixture(
      dir,
      buildTwoChunkTranscript("kokoro-format"),
      kokoroConfig({ format: "mp3" })
    );
    const error = await renderFirstChunk(fixture).then(
      () => null,
      (e: unknown) => e
    );
    expect(error).toBeInstanceOf(ApplicationFailure);
    expect((error as ApplicationFailure).type).toBe("UnsupportedProviderFormat");
    expect((error as ApplicationFailure).nonRetryable).toBe(true);
    const attempts = readLedger(fixture.ledgerPath).filter((e) => e.type === "provider_attempt");
    expect(attempts).toHaveLength(0);
  });
});

describe.skipIf(!venvAvailable)("Kokoro integration (real venv)", () => {
  it(
    "renders a one-sentence chunk to a valid 24 kHz mono WAV",
    { timeout: 600_000 },
    async () => {
      const provider = new KokoroTtsProvider();
      const started = Date.now();
      const result = await provider.render({
        text: "Durable execution keeps audio renders honest.",
        voice: KOKORO_DEFAULT_VOICE,
        format: "wav",
      });
      const elapsedSec = (Date.now() - started) / 1000;
      // eslint-disable-next-line no-console
      console.log(`[kokoro-integration] rendered in ${elapsedSec.toFixed(1)}s`);

      expect(result.bytes.subarray(0, 4).toString("ascii")).toBe("RIFF");
      expect(result.bytes.subarray(8, 12).toString("ascii")).toBe("WAVE");

      const dir = await fs.mkdtemp(path.join(os.tmpdir(), "kokoro-int-"));
      try {
        const wavPath = path.join(dir, "probe.wav");
        await fs.writeFile(wavPath, result.bytes);
        const probe = await new Promise<string>((resolve, reject) => {
          execFile(
            FFPROBE_BIN,
            ["-v", "error", "-print_format", "json", "-show_format", "-show_streams", wavPath],
            (error, stdout, stderr) => (error ? reject(new Error(stderr)) : resolve(stdout))
          );
        });
        const parsed = JSON.parse(probe) as {
          format: { format_name: string; duration: string };
          streams: Array<{ codec_name: string; sample_rate: string; channels: number }>;
        };
        expect(parsed.format.format_name).toBe("wav");
        expect(parsed.streams).toHaveLength(1);
        expect(parsed.streams[0].codec_name).toBe("pcm_s16le");
        expect(parsed.streams[0].sample_rate).toBe("24000");
        expect(parsed.streams[0].channels).toBe(1);
        const durationSec = Number(parsed.format.duration);
        expect(durationSec).toBeGreaterThan(1);
        expect(durationSec).toBeLessThan(15);
      } finally {
        await fs.rm(dir, { recursive: true, force: true });
      }
    }
  );
});
