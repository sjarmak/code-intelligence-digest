/**
 * POST /api/publish-digest
 *
 * Publish a generated newsletter or podcast into the personal website's digest
 * library (the /digest section of sjarmak.ai). Assembles the shared publish spec
 * and invokes the website repo's scripts/digest/publish-digest.mjs, so manually
 * curated issues land in the same library as the cron-generated ones.
 *
 * This is the data plane handing off to the website's presentation plane — no
 * digest-app content logic leaks into the website, and vice versa.
 *
 * Local-only: the website repo lives on the dev machine, so this route is
 * blocked in production — a web route that spawns subprocesses and runs git
 * must never be reachable on the Render deploy.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { writeFile, mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "@/src/lib/logger";
import { blockInProduction } from "@/src/lib/auth/guards";
import {
  parsePublishBody,
  buildPublishSpec,
  resolveAudioFile,
  type PublishSpec,
} from "@/src/lib/publish/publish-spec";
import {
  LOCK_TIMEOUT_EXIT,
  attachEnv,
  attachOutcome,
  lockTimeoutMessage,
  lockedCommand,
  parsePublishOutput,
  shouldAttach,
  websiteMediaSetup,
  type AudioReport,
  type PublishOutput,
  type WebsiteMediaSetup,
} from "@/src/lib/publish/website-media";

export const dynamic = "force-dynamic";

const WEBSITE_REPO = process.env.WEBSITE_REPO_PATH ?? "/home/ds/projects/website";
const AUDIO_DIR = path.join(process.cwd(), ".data", "audio");

interface PublishResult {
  success: boolean;
  slug?: string;
  path?: string;
  pushed?: boolean;
  audio?: AudioReport;
  error?: string;
}

type RunResult = { code: number; stdout: string; stderr: string };

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv): Promise<RunResult> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", (err) => resolve({ code: -1, stdout, stderr: stderr + err.message }));
    proc.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
  });
}

async function websiteRepoAvailable(): Promise<boolean> {
  try {
    const s = await stat(path.join(WEBSITE_REPO, "scripts", "digest", "publish-digest.mjs"));
    return s.isFile();
  } catch {
    return false;
  }
}

async function publish(setup: WebsiteMediaSetup, spec: PublishSpec): Promise<PublishOutput> {
  const dir = await mkdtemp(path.join(tmpdir(), "digest-publish-"));
  try {
    const specPath = path.join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify(spec), "utf8");
    await mkdir(path.dirname(setup.lockFile), { recursive: true });
    const command = ["node", "scripts/digest/publish-digest.mjs", "--spec", specPath, "--commit"];
    const result = await run("flock", lockedCommand(setup, command), WEBSITE_REPO, setup.env);
    if (result.code === LOCK_TIMEOUT_EXIT) {
      throw new Error(`${lockTimeoutMessage(setup)}; nothing was published`);
    }
    if (result.code !== 0) {
      logger.error("publish-digest script failed", { stderr: result.stderr, code: result.code });
      throw new Error(`publish-digest failed: ${result.stderr.trim() || result.stdout.trim()}`);
    }
    return parsePublishOutput(result.stdout);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function pushMain(setup: WebsiteMediaSetup): Promise<boolean> {
  const command = ["sh", "-c", "git pull --rebase --autostash && git push"];
  const result = await run("flock", lockedCommand(setup, command), WEBSITE_REPO, setup.env);
  if (result.code !== 0) logger.error("publish-digest: git push failed", { stderr: result.stderr, code: result.code });
  return result.code === 0;
}

async function attachPending(
  setup: WebsiteMediaSetup,
  slug: string,
  pending: AudioReport,
  pushed: boolean,
): Promise<AudioReport> {
  const script = path.join(WEBSITE_REPO, "scripts", "digest", "run.sh");
  const result = await run(script, ["attach-pending"], WEBSITE_REPO, attachEnv(setup, pushed));
  const output = `${result.stdout}\n${result.stderr}`;
  if (result.code !== 0) logger.warn("publish-digest: audio not attached yet", { code: result.code, output: output.slice(-4000) });
  return attachOutcome(result.code, output, slug, pending, setup);
}

async function audioFileFor(audioUrl: string | null | undefined): Promise<{ file?: string; dropped?: AudioReport }> {
  if (!audioUrl) return {};
  const file = await resolveAudioFile(audioUrl, AUDIO_DIR);
  if (file) return { file };
  logger.warn("publish-digest: audio URL is not a rendered file, publishing without audio", { url: audioUrl });
  return { dropped: { status: "none", reason: `${audioUrl} is not a rendered file under ${AUDIO_DIR}` } };
}

export async function POST(request: NextRequest): Promise<NextResponse<PublishResult>> {
  const blocked = blockInProduction();
  if (blocked) return blocked as NextResponse<PublishResult>;

  const validation = parsePublishBody(await request.json().catch(() => null));
  if (!validation.ok) {
    return NextResponse.json({ success: false, error: validation.error }, { status: 400 });
  }
  const body = validation.value;

  if (!(await websiteRepoAvailable())) {
    return NextResponse.json(
      { success: false, error: `website repo not found at ${WEBSITE_REPO} (set WEBSITE_REPO_PATH)` },
      { status: 503 },
    );
  }

  try {
    const setup = websiteMediaSetup(WEBSITE_REPO);
    const { slug, spec } = buildPublishSpec(body, new Date().toISOString().slice(0, 10));
    const audioInput = await audioFileFor(body.audioUrl);
    if (audioInput.file) spec.audioFile = audioInput.file;

    const out = await publish(setup, spec);
    const publishedSlug = out.slug ?? slug;
    const pushed = body.push ? await pushMain(setup) : false;
    const audio = shouldAttach(setup, pushed, out.audio)
      ? await attachPending(setup, publishedSlug, out.audio, pushed)
      : (audioInput.dropped ?? out.audio);

    return NextResponse.json({ success: true, slug: publishedSlug, path: out.path, pushed, audio });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("publish-digest endpoint error", { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
