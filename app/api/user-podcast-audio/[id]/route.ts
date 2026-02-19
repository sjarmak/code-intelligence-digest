/**
 * DELETE /api/user-podcast-audio/[id]
 * Remove a podcast from current user's list (does not delete the audio file)
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import { deleteUserPodcastAudio } from "@/src/lib/db/user-podcast-audio";
import { initializeDatabase } from "@/src/lib/db/index";

export const dynamic = "force-dynamic";

export async function DELETE(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const { id } = await params;
    const decodedId = decodeURIComponent(id);

    const deleted = await deleteUserPodcastAudio(userId, decodedId);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
