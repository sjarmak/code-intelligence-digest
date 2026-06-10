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
import { writeFile, mkdtemp, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { logger } from "@/src/lib/logger";
import { blockInProduction } from "@/src/lib/auth/guards";
import {
  parsePublishBody,
  buildPublishSpec,
  resolveAudioFile,
} from "@/src/lib/publish/publish-spec";

export const dynamic = "force-dynamic";

const WEBSITE_REPO = process.env.WEBSITE_REPO_PATH ?? "/home/ds/projects/website";
const AUDIO_DIR = path.join(process.cwd(), ".data", "audio");

interface PublishResult {
  success: boolean;
  slug?: string;
  path?: string;
  pushed?: boolean;
  error?: string;
}

function run(cmd: string, args: string[], cwd: string): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const proc = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
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
    const { slug, spec } = buildPublishSpec(body, new Date().toISOString().slice(0, 10));

    // Resolve audio to a local file so the static website self-hosts it (durable).
    if (body.audioUrl) {
      const resolved = await resolveAudioFile(body.audioUrl, AUDIO_DIR);
      if (resolved) {
        spec.audioFile = resolved;
      } else if (/^https?:\/\//.test(body.audioUrl)) {
        spec.audioUrl = body.audioUrl;
        logger.warn("publish-digest: using remote audio URL (may not be durable)", { url: body.audioUrl });
      } else {
        logger.warn("publish-digest: audio URL did not resolve to a file, publishing without audio", {
          url: body.audioUrl,
        });
      }
    }

    const dir = await mkdtemp(path.join(tmpdir(), "digest-publish-"));
    const specPath = path.join(dir, "spec.json");
    await writeFile(specPath, JSON.stringify(spec), "utf8");

    const publish = await run("node", ["scripts/digest/publish-digest.mjs", "--spec", specPath, "--commit"], WEBSITE_REPO);
    if (publish.code !== 0) {
      logger.error("publish-digest script failed", { stderr: publish.stderr, code: publish.code });
      return NextResponse.json(
        { success: false, error: `publish-digest failed: ${publish.stderr.trim() || publish.stdout.trim()}` },
        { status: 500 },
      );
    }

    // Push only on explicit request opt-in (UI checkbox, default off).
    let pushed = false;
    if (body.push) {
      const pull = await run("git", ["pull", "--rebase", "--autostash"], WEBSITE_REPO);
      const push = pull.code === 0 ? await run("git", ["push"], WEBSITE_REPO) : pull;
      pushed = push.code === 0;
      if (!pushed) logger.error("publish-digest: git push failed", { stderr: push.stderr });
    }

    const out = (() => {
      try {
        return JSON.parse(publish.stdout.trim().split("\n").pop() ?? "{}");
      } catch {
        return {};
      }
    })();

    return NextResponse.json({ success: true, slug: out.slug ?? slug, path: out.path, pushed });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("publish-digest endpoint error", { error: message });
    return NextResponse.json({ success: false, error: message }, { status: 500 });
  }
}
