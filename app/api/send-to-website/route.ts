/**
 * POST /api/send-to-website
 *
 * Local-only. Gathers the user's currently-tagged digest items, writes them to a
 * handoff JSON, and triggers the website repo's curated digest pipeline
 * (`scripts/digest/run.sh curated <handoff>`), which generates a newsletter + ~30-min
 * podcast from exactly those items, renders the audio, and commits (without pushing —
 * the user reviews, then pushes).
 *
 * The site-side podcast/publish path is unreliable, so generation happens in the
 * website repo's proven pipeline. This route only bridges tagged items → that pipeline,
 * and is disabled outside local development.
 */

import { NextRequest, NextResponse } from "next/server";
import { spawn } from "node:child_process";
import { mkdir, writeFile, open } from "node:fs/promises";
import path from "node:path";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import { getDigestItems } from "@/src/lib/db/digestItems";
import { initializeDatabase } from "@/src/lib/db/index";
import { logger } from "@/src/lib/logger";

const WEBSITE_DIR = process.env.WEBSITE_DIR ?? "/home/ds/projects/website";

/** This is a local dev convenience that shells out to a sibling repo. Never expose it. */
function isLocalOnly(): boolean {
  return process.env.NODE_ENV !== "production" && process.env.VERCEL !== "1";
}

export async function POST(request: NextRequest) {
  if (!isLocalOnly()) {
    return NextResponse.json(
      { error: "send-to-website is available only on the local build" },
      { status: 403 },
    );
  }

  try {
    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;

    const feedItems = await getDigestItems(undefined, undefined, userId);
    if (feedItems.length === 0) {
      return NextResponse.json(
        { error: "No tagged items. Add items to the digest first." },
        { status: 400 },
      );
    }

    // Shape the handoff exactly as scripts/digest/generate-curated.md expects.
    const items = feedItems.map((it) => ({
      title: it.title,
      url: it.url,
      source: it.sourceTitle,
      category: it.category,
      summary: it.summary ?? it.contentSnippet ?? "",
      fullText: it.fullText ?? "",
    }));

    const runsDir = path.join(WEBSITE_DIR, ".digest-runs");
    await mkdir(runsDir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const handoffPath = path.join(runsDir, `curated-handoff-${stamp}.json`);
    await writeFile(handoffPath, JSON.stringify({ items }, null, 2), "utf8");

    // Generation takes minutes (claude -p + TTS), so run detached and return now.
    const logPath = path.join(runsDir, `curated-${stamp}.log`);
    const logFd = await open(logPath, "a");
    const child = spawn("bash", ["scripts/digest/run.sh", "curated", handoffPath], {
      cwd: WEBSITE_DIR,
      detached: true,
      stdio: ["ignore", logFd.fd, logFd.fd],
      env: process.env,
    });
    child.unref();
    await logFd.close();

    logger.info(`send-to-website: launched curated run for ${items.length} items → ${logPath}`);
    return NextResponse.json({
      started: true,
      itemCount: items.length,
      logPath,
      message:
        `Generating a newsletter + ~30-min podcast from ${items.length} tagged items in the ` +
        `website repo. It commits (no push) when done — review, then push. Tail ${logPath} for progress.`,
    });
  } catch (error) {
    logger.error("send-to-website failed", error);
    return NextResponse.json({ error: "Failed to trigger website generation" }, { status: 500 });
  }
}
