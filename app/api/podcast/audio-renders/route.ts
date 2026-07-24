/**
 * POST /api/podcast/audio-renders
 *
 * Asynchronous, durable render start (spec: "The API becomes asynchronous
 * without breaking the current endpoint"). Sanitizes the transcript,
 * persists it under a content-addressed reference, derives the versioned
 * renderKey, and starts the renderPodcast Workflow with
 * workflowId = "podcast-render/" + renderKey.
 *
 * Fresh start -> 202 + Location + statusUrl. Duplicate start for the same
 * renderKey -> 200 with the current resource (Temporal rejects the second
 * execution; no new Workflow is created). Invalid input -> 400, multi-voice
 * scope -> 422, Temporal unreachable -> 503 without claiming acceptance.
 *
 * The synchronous POST /api/podcast/render-audio route is untouched.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  WorkflowExecutionAlreadyStartedError,
  WorkflowIdReusePolicy,
} from "@temporalio/client";
import { AudioFormat } from "@/src/lib/audio/types";
import {
  hasMultipleSpeakers,
  sanitizeTranscriptForTts,
} from "@/src/lib/audio/sanitize";
import { CHUNKER_VERSION } from "@/src/lib/audio/durable/chunker";
import { STITCHER_VERSION } from "@/src/lib/audio/durable/stitcher";
import { computeRenderKey, workflowIdFor } from "@/src/lib/audio/durable/keys";
import { TranscriptStore } from "@/src/lib/audio/durable/transcriptStore";
import {
  RENDER_PODCAST_WORKFLOW_TYPE,
  RENDER_POLICY_VERSION,
  getTemporalClient,
  isTemporalUnavailableError,
  renderTaskQueue,
} from "@/src/lib/audio/durable/temporalClient";
import { projectRenderStatus } from "@/src/lib/audio/durable/statusProjection";
import {
  AudioRenderErrorResponse,
  AudioRenderStatusResponse,
  DurableProvider,
  RenderConfig,
  RenderInput,
  RenderKeyInput,
  StartAudioRenderAccepted,
  StartAudioRenderRequest,
} from "@/src/lib/audio/durable/types";
import { logger } from "@/src/lib/logger";

const ALLOWED_PROVIDERS: DurableProvider[] = ["demo", "kokoro", "openai", "elevenlabs", "nemo"];
const ALLOWED_FORMATS: AudioFormat[] = ["mp3", "wav"];

const transcriptStore = new TranscriptStore();

type Validation =
  | { ok: true; data: StartAudioRenderRequest }
  | { ok: false; httpStatus: 400 | 422; error: string };

function validateStartRequest(body: unknown): Validation {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    return { ok: false, httpStatus: 400, error: "Request body must be a JSON object" };
  }
  const req = body as Record<string, unknown>;

  if (typeof req.transcript !== "string" || req.transcript.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "transcript must be a non-empty string" };
  }
  if (!ALLOWED_PROVIDERS.includes(req.provider as DurableProvider)) {
    return {
      ok: false,
      httpStatus: 400,
      error: `provider must be one of: ${ALLOWED_PROVIDERS.join(", ")}`,
    };
  }
  if (typeof req.providerModel !== "string" || req.providerModel.trim().length === 0) {
    return {
      ok: false,
      httpStatus: 400,
      error: "providerModel is required and must name a concrete model (never a moving alias)",
    };
  }
  if (typeof req.voice !== "string" || req.voice.trim().length === 0) {
    return { ok: false, httpStatus: 400, error: "voice must be a non-empty string" };
  }
  if (!ALLOWED_FORMATS.includes(req.format as AudioFormat)) {
    return {
      ok: false,
      httpStatus: 400,
      error: `format must be one of: ${ALLOWED_FORMATS.join(", ")}`,
    };
  }
  if (hasMultipleSpeakers(req.transcript)) {
    return {
      ok: false,
      httpStatus: 422,
      error:
        "multi-voice transcripts are out of scope for the asynchronous render path (v1 is single voice); use POST /api/podcast/render-audio",
    };
  }

  return {
    ok: true,
    data: {
      transcript: req.transcript,
      provider: req.provider as DurableProvider,
      providerModel: req.providerModel.trim(),
      voice: req.voice.trim(),
      format: req.format as AudioFormat,
    },
  };
}

export async function POST(
  request: NextRequest
): Promise<
  NextResponse<StartAudioRenderAccepted | AudioRenderStatusResponse | AudioRenderErrorResponse>
> {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      return NextResponse.json({ error: "Request body must be valid JSON" }, { status: 400 });
    }

    const validation = validateStartRequest(body);
    if (!validation.ok) {
      return NextResponse.json({ error: validation.error }, { status: validation.httpStatus });
    }
    const req = validation.data;

    const sanitized = sanitizeTranscriptForTts(req.transcript);
    if (sanitized.length === 0) {
      return NextResponse.json(
        { error: "Transcript is empty after sanitization (all cues removed?)" },
        { status: 400 }
      );
    }

    // Persist first: the Workflow receives only the reference and digest,
    // never the text, so the transcript must be durable before start.
    const stored = await transcriptStore.put(sanitized);

    const identity: RenderKeyInput = {
      sanitizedTranscriptSha256: stored.transcriptSha256,
      provider: req.provider,
      providerModel: req.providerModel,
      voice: req.voice,
      format: req.format,
      chunkerVersion: CHUNKER_VERSION,
      stitcherVersion: STITCHER_VERSION,
      renderPolicyVersion: RENDER_POLICY_VERSION,
    };
    const renderKey = computeRenderKey(identity);
    const statusUrl = `/api/podcast/audio-renders/${renderKey}`;

    const config: RenderConfig = {
      provider: identity.provider,
      providerModel: identity.providerModel,
      voice: identity.voice,
      format: identity.format,
      chunkerVersion: identity.chunkerVersion,
      stitcherVersion: identity.stitcherVersion,
      renderPolicyVersion: identity.renderPolicyVersion,
    };
    const input: RenderInput = {
      renderKey,
      transcriptRef: stored.transcriptRef,
      transcriptSha256: stored.transcriptSha256,
      config,
    };

    let client;
    try {
      client = await getTemporalClient();
    } catch (error) {
      if (isTemporalUnavailableError(error)) {
        logger.warn("Temporal unreachable; render not accepted", { renderKey });
        return NextResponse.json(
          { error: "Temporal is unavailable; the render was not accepted" },
          { status: 503 }
        );
      }
      throw error;
    }

    try {
      await client.workflow.start(RENDER_PODCAST_WORKFLOW_TYPE, {
        taskQueue: renderTaskQueue(),
        workflowId: workflowIdFor(renderKey),
        // Any prior execution for this identity (running or closed) rejects
        // the duplicate start; the caller gets the existing resource.
        workflowIdReusePolicy: WorkflowIdReusePolicy.REJECT_DUPLICATE,
        args: [input],
      });
    } catch (error) {
      if (error instanceof WorkflowExecutionAlreadyStartedError) {
        const status = await projectRenderStatus(client, renderKey);
        if (status === null) {
          // The server rejected the start because an execution exists, but
          // it can no longer be described (e.g. passed retention between
          // the two calls). Surface the inconsistency instead of guessing.
          logger.error("Duplicate start rejected but execution not describable", { renderKey });
          return NextResponse.json(
            { error: "an execution for this renderKey exists but could not be described; retry" },
            { status: 500 }
          );
        }
        logger.info("Duplicate render start returned existing resource", {
          renderKey,
          status: status.status,
        });
        return NextResponse.json(status, { status: 200 });
      }
      if (isTemporalUnavailableError(error)) {
        logger.warn("Temporal start failed as unavailable; render not accepted", { renderKey });
        return NextResponse.json(
          { error: "Temporal is unavailable; the render was not accepted" },
          { status: 503 }
        );
      }
      throw error;
    }

    logger.info("Durable audio render accepted", {
      renderKey,
      provider: req.provider,
      providerModel: req.providerModel,
      format: req.format,
      transcriptRef: stored.transcriptRef,
      transcriptBytes: stored.byteCount,
    });

    const accepted: StartAudioRenderAccepted = {
      renderId: renderKey,
      status: "queued",
      statusUrl,
    };
    return NextResponse.json(accepted, {
      status: 202,
      headers: { Location: statusUrl },
    });
  } catch (error) {
    logger.error("audio-renders start endpoint failed", error);
    const message = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
