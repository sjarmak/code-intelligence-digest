/**
 * GET /api/generated-newsletters/[id] - get one newsletter
 * DELETE /api/generated-newsletters/[id] - delete from user's list
 */

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/src/auth";
import { LEGACY_USER_ID } from "@/src/lib/db/constants";
import {
  getGeneratedNewsletter,
  deleteGeneratedNewsletter,
} from "@/src/lib/db/generated-newsletters";
import { initializeDatabase } from "@/src/lib/db/index";

export const dynamic = "force-dynamic";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  try {
    await initializeDatabase();
    const session = await auth();
    const userId = session?.user?.id ?? LEGACY_USER_ID;
    const { id } = await params;
    const decodedId = decodeURIComponent(id);

    const newsletter = await getGeneratedNewsletter(decodedId, userId);
    if (!newsletter) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({
      id: newsletter.id,
      title: newsletter.title,
      markdown: newsletter.markdown,
      html: newsletter.html,
      createdAt: newsletter.createdAt,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

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

    const deleted = await deleteGeneratedNewsletter(decodedId, userId);
    if (!deleted) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
