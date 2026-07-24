/**
 * GET /api/podcast/audio-renders/{renderId}
 *
 * Status resource for one durable render. renderId === renderKey. Projects
 * the Workflow execution into the discriminated status contract:
 * queued | running (completedChunks/totalChunks/attempt via the progress
 * query) | completed (PublishResult metadata) | failed | cancelled.
 * Unknown renderKey -> 404; Temporal unreachable -> 503.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getTemporalClient,
  isTemporalUnavailableError,
} from "@/src/lib/audio/durable/temporalClient";
import { projectRenderStatus } from "@/src/lib/audio/durable/statusProjection";
import {
  AudioRenderErrorResponse,
  AudioRenderStatusResponse,
} from "@/src/lib/audio/durable/types";
import { logger } from "@/src/lib/logger";

const RENDER_KEY_PATTERN = /^[0-9a-f]{64}$/;

export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ renderId: string }> }
): Promise<NextResponse<AudioRenderStatusResponse | AudioRenderErrorResponse>> {
  try {
    const { renderId } = await context.params;
    if (!RENDER_KEY_PATTERN.test(renderId)) {
      return NextResponse.json(
        { error: "renderId must be a 64-character lowercase hex renderKey" },
        { status: 400 }
      );
    }

    let status: AudioRenderStatusResponse | null;
    try {
      const client = await getTemporalClient();
      status = await projectRenderStatus(client, renderId);
    } catch (error) {
      if (isTemporalUnavailableError(error)) {
        logger.warn("Temporal unreachable while projecting render status", {
          renderId,
        });
        return NextResponse.json(
          { error: "Temporal is unavailable; render status cannot be read" },
          { status: 503 }
        );
      }
      throw error;
    }

    if (status === null) {
      return NextResponse.json(
        { error: `no audio render found for renderId ${renderId}` },
        { status: 404 }
      );
    }
    return NextResponse.json(status);
  } catch (error) {
    logger.error("audio-renders status endpoint failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
