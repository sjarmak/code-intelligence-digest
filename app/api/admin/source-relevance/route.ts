/**
 * GET /api/admin/source-relevance - Get all sources with relevance ratings
 * POST /api/admin/source-relevance - Update relevance for a source
 * 
 * Used by UI to display and edit source relevance scores
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getAllSourcesWithRelevance,
  setSourceRelevance,
  SourceRelevance,
} from "../../../../src/lib/db/sourceRelevance";
import { logger } from "../../../../src/lib/logger";
import { initializeDatabase } from "../../../../src/lib/db/index";
import { z } from "zod";
import { blockInProduction } from "../../../../src/lib/auth/guards";

const SetRelevanceSchema = z.object({
  streamId: z.string(),
  relevance: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
});

export async function GET(request: NextRequest) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    await initializeDatabase();

    const sources = await getAllSourcesWithRelevance();

    return NextResponse.json(
      {
        success: true,
        count: sources.length,
        sources,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Failed to get source relevance", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const blocked = blockInProduction();
  if (blocked) return blocked;

  try {
    await initializeDatabase();

    const body = await request.json();
    const { streamId, relevance } = SetRelevanceSchema.parse(body);

    await setSourceRelevance(streamId, relevance as SourceRelevance);

    return NextResponse.json(
      {
        success: true,
        message: `Set relevance for ${streamId}`,
        streamId,
        relevance,
      },
      { status: 200 }
    );
  } catch (error) {
    logger.error("Failed to set source relevance", error);

    if (error instanceof z.ZodError) {
      return NextResponse.json(
        {
          success: false,
          error: "Invalid request",
          details: error.issues,
        },
        { status: 400 }
      );
    }

    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
