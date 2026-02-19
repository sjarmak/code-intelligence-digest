/**
 * GET /api/user-podcast-audio
 * List current user's saved podcast audio (for "my past podcasts")
 */

import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import { listUserPodcastAudio } from "@/src/lib/db/user-podcast-audio";
import { initializeDatabase } from "@/src/lib/db/index";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;

    const limit = 50;
    const items = await listUserPodcastAudio(userId, limit);

    return NextResponse.json({
      podcasts: items.map((p) => ({
        id: p.id,
        podcastId: p.podcastId,
        provider: p.provider,
        format: p.format,
        duration: p.duration,
        durationSeconds: p.durationSeconds,
        audioUrl: p.audioUrl,
        bytes: p.bytes,
        createdAt: p.createdAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
