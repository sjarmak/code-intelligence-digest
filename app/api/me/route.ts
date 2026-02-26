/**
 * GET /api/me
 * Current session and effective config for multi-account testing.
 * Returns userId, email, LLM config hint, and per-user library counts.
 */

import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import { getDigestItemsCount } from "@/src/lib/db/digestItems";
import { getSavedItemsCount } from "@/src/lib/db/savedItems";
import { initializeDatabase } from "@/src/lib/db/index";

export async function GET() {
  try {
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const email = session?.user?.email ?? null;
    const emailVerified =
      (session?.user as { emailVerified?: boolean } | undefined)?.emailVerified ?? false;

    const isSourcegraphCom =
      !!emailVerified &&
      (email ?? "").trim().toLowerCase().endsWith("@sourcegraph.com");

    await initializeDatabase();
    const [digestCount, savedCount] = await Promise.all([
      getDigestItemsCount(userId),
      getSavedItemsCount(userId),
    ]);

    return NextResponse.json({
      userId,
      email: email ?? undefined,
      isSourcegraphCom,
      llmConfig: isSourcegraphCom
        ? "Sourcegraph.com (server key)"
        : "BYOK or server env",
      digestCount,
      savedCount,
    });
  } catch (error) {
    console.error("Error in /api/me:", error);
    return NextResponse.json(
      { error: "Failed to load session" },
      { status: 500 }
    );
  }
}
