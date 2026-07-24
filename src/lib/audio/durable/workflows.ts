/**
 * The sequential podcast-render Workflow (spec: "The Workflow coordinates
 * metadata, not media").
 *
 * This file runs inside the Temporal Workflow sandbox: it computes no
 * audio, reads no database or object store, performs no IO, and imports
 * nothing but @temporalio/workflow, @temporalio/common, and type-only
 * contracts. Everything it passes to Activities is immutable metadata —
 * references, hashes, offsets — never transcript text or audio bytes.
 *
 * Versioning: "render-policy-v1" pins the timeout and retry semantics
 * below; changing any of them is a new renderPolicyVersion and therefore a
 * new renderKey. If the *command sequence* of this Workflow ever changes
 * (reordering Activities, adding a timer or signal await), gate the change
 * with `workflow.patched("<change-id>")` so histories recorded by the old
 * code replay deterministically on the new worker (SDK version gate,
 * spec Stage 3 / Stage 5).
 *
 * Cancellation: the Workflow holds no external resources of its own, so
 * default cancellation semantics are correct — a cancel request propagates
 * to the in-flight Activity await and the Workflow ends as cancelled;
 * deterministic object keys mean a later restart converges on the same
 * artifacts.
 */

import {
  ApplicationFailure,
  defineQuery,
  proxyActivities,
  setHandler,
  workflowInfo,
} from "@temporalio/workflow";
import type { ChunkMetadata, RenderInput, RenderResult } from "./types";
import type { DurableRenderActivities } from "./activities";
// progress.ts is a zero-import leaf, safe inside the Workflow sandbox.
import { PROGRESS_QUERY_NAME, RenderProgress as BaseRenderProgress } from "./progress";

/**
 * Pins the Activity timeout/retry semantics declared in this file. The
 * starter-side copy lives in temporalClient.ts (which this sandboxed file
 * cannot import); a drift-guard test asserts the two stay equal.
 */
export const RENDER_POLICY_VERSION = "render-policy-v1";

export type RenderPhaseName =
  | "planning"
  | "rendering"
  | "stitching"
  | "publishing"
  | "completed";

/**
 * The API's RenderProgress contract (progress.ts) plus the phase name.
 * `attempt` is the Workflow-side attempt (workflowInfo().attempt, 1-based);
 * per-Activity retry attempts are server-side state the Workflow cannot
 * observe, and the status API reads them from pending-activity info.
 */
export interface RenderProgress extends BaseRenderProgress {
  phaseName: RenderPhaseName;
}

export const progressQuery = defineQuery<RenderProgress>(PROGRESS_QUERY_NAME);

// Retry policies are limited to transient errors: input errors (transcript
// hash mismatch, chunk slice mismatch, version mismatches) arrive as
// non-retryable ApplicationFailures from the Activities and stop the retry
// loop immediately; injected 503s (InjectedRetryableError) and real
// provider/DB outages retry under the bounded policies below.

const { loadAndPlan } = proxyActivities<DurableRenderActivities>({
  startToCloseTimeout: "1 minute",
  retry: { initialInterval: "1 second", backoffCoefficient: 2, maximumAttempts: 3 },
});

const { renderChunk } = proxyActivities<DurableRenderActivities>({
  startToCloseTimeout: "5 minutes",
  // Worker loss is detected via missed heartbeats, not the full
  // startToCloseTimeout: the renderChunk Activity heartbeats every few
  // seconds (see activities.ts), so a SIGKILL'd worker's in-flight chunk is
  // retried seconds after a replacement worker polls — the demo's live kill
  // sequence stays inside its five-minute budget instead of consuming it.
  heartbeatTimeout: "15 seconds",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

const { stitchChunks } = proxyActivities<DurableRenderActivities>({
  startToCloseTimeout: "10 minutes",
  retry: { initialInterval: "1 second", backoffCoefficient: 2, maximumAttempts: 3 },
});

const { publishRender } = proxyActivities<DurableRenderActivities>({
  startToCloseTimeout: "1 minute",
  retry: {
    initialInterval: "1 second",
    backoffCoefficient: 2,
    maximumInterval: "30 seconds",
    maximumAttempts: 5,
  },
});

/**
 * Sequential render per the spec pseudocode: loadAndPlan, then one
 * renderChunk per planned chunk in order, then stitchChunks, then
 * publishRender. Progress is queryable throughout via "progress".
 */
export async function renderPodcast(input: RenderInput): Promise<RenderResult> {
  let phaseName: RenderPhaseName = "planning";
  let completedChunks = 0;
  let totalChunks = 0;
  setHandler(progressQuery, () => ({
    completedChunks,
    totalChunks,
    attempt: workflowInfo().attempt,
    phaseName,
  }));

  if (input.config.renderPolicyVersion !== RENDER_POLICY_VERSION) {
    throw ApplicationFailure.create({
      message: `this workflow implements ${RENDER_POLICY_VERSION}; identity pinned ${input.config.renderPolicyVersion}`,
      type: "RenderPolicyVersionMismatch",
      nonRetryable: true,
    });
  }

  const plan = await loadAndPlan({
    renderKey: input.renderKey,
    transcriptRef: input.transcriptRef,
    expectedTranscriptHash: input.transcriptSha256,
    config: input.config,
  });
  totalChunks = plan.totalChunks;

  phaseName = "rendering";
  const chunks: ChunkMetadata[] = [];
  for (const chunk of plan.chunks) {
    chunks.push(
      await renderChunk({
        renderKey: input.renderKey,
        transcriptRef: input.transcriptRef,
        transcriptSha256: input.transcriptSha256,
        chunk,
        config: input.config,
      })
    );
    completedChunks += 1;
  }

  phaseName = "stitching";
  const assembled = await stitchChunks({
    renderKey: input.renderKey,
    format: input.config.format,
    stitcherVersion: input.config.stitcherVersion,
    chunks,
  });

  phaseName = "publishing";
  const result = await publishRender({
    renderKey: input.renderKey,
    planHash: plan.planHash,
    transcriptSha256: input.transcriptSha256,
    config: input.config,
    chunks,
    assembled,
  });

  phaseName = "completed";
  return result;
}
