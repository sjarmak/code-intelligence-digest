/**
 * GET /api/admin/playbook-state
 * PUT /api/admin/playbook-state
 *
 * Local/dev control-plane endpoint for GTM updater agent.
 * No auth by design; blocked in production.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getPlaybookStatePath,
  loadPlaybookState,
  PlaybookStateSchema,
  savePlaybookState,
} from "@/src/lib/agents/playbook-state";
import { logger } from "@/src/lib/logger";
import { blockInProduction } from "@/src/lib/auth/guards";
import { z } from "zod";

const UpsertBodySchema = z.object({
  state: PlaybookStateSchema.optional(),
}).passthrough();

export async function GET(): Promise<NextResponse> {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    const state = loadPlaybookState();
    return NextResponse.json({
      success: true,
      state,
      path: getPlaybookStatePath(),
    });
  } catch (error) {
    logger.error("[PLAYBOOK-STATE] Failed to read state", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to read playbook state" },
      { status: 500 },
    );
  }
}

export async function PUT(request: NextRequest): Promise<NextResponse> {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    const bodyRaw = (await request.json()) as unknown;
    const parsedBody = UpsertBodySchema.parse(bodyRaw);

    const stateInput = parsedBody.state ?? bodyRaw;
    const validated = PlaybookStateSchema.parse(stateInput);
    const updatedBy = request.headers.get("x-updater-agent") || "local-agent";
    const saved = savePlaybookState(validated, { updatedBy });

    logger.info("[PLAYBOOK-STATE] Updated playbook state", {
      updatedBy,
      playbookVersion: saved.playbook_version,
      primaryBeachhead: saved.primary_beachhead,
    });

    return NextResponse.json({
      success: true,
      state: saved,
      path: getPlaybookStatePath(),
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { success: false, error: "Invalid playbook state", details: error.issues },
        { status: 400 },
      );
    }

    logger.error("[PLAYBOOK-STATE] Failed to update state", error);
    return NextResponse.json(
      { success: false, error: error instanceof Error ? error.message : "Failed to update playbook state" },
      { status: 500 },
    );
  }
}
