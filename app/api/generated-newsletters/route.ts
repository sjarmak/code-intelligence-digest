/**
 * GET /api/generated-newsletters
 * List current user's saved newsletters (for "my past newsletters")
 */

import { NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import { listGeneratedNewsletters } from "@/src/lib/db/generated-newsletters";
import { initializeDatabase } from "@/src/lib/db/index";

export const dynamic = "force-dynamic";

export async function GET(): Promise<NextResponse> {
  try {
    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;

    const limit = 50;
    const items = await listGeneratedNewsletters(userId, limit);

    return NextResponse.json({
      newsletters: items.map((n) => ({
        id: n.id,
        title: n.title,
        createdAt: n.createdAt,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
