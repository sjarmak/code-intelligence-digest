/**
 * Projection of one render's state into the async API's status contract.
 *
 * Shared by POST (duplicate-start 200 body) and GET (status resource).
 * Reads Temporal only: the Workflow's describe() status plus the progress
 * query while running, and the Workflow result (PublishResult metadata,
 * never bytes) once completed. Returns null when Temporal has no execution
 * for the renderKey, which the routes map to 404.
 */

import {
  Client,
  QueryNotRegisteredError,
  WorkflowHandle,
  WorkflowNotFoundError,
  isGrpcDeadlineError,
  isGrpcServiceError,
} from "@temporalio/client";
import { workflowIdFor } from "./keys";
import { PROGRESS_QUERY_NAME, RenderProgress } from "./progress";
import { AudioRenderStatusResponse, PublishResult } from "./types";

export async function projectRenderStatus(
  client: Client,
  renderKey: string
): Promise<AudioRenderStatusResponse | null> {
  const handle = client.workflow.getHandle(workflowIdFor(renderKey));

  let statusName: string;
  try {
    const description = await handle.describe();
    statusName = description.status.name;
  } catch (error) {
    if (error instanceof WorkflowNotFoundError) {
      return null;
    }
    throw error;
  }

  switch (statusName) {
    case "RUNNING":
    case "CONTINUED_AS_NEW":
      return projectRunning(handle, renderKey);
    case "COMPLETED": {
      const result = (await handle.result()) as PublishResult;
      return { renderId: renderKey, status: "completed", result };
    }
    case "FAILED":
    case "TERMINATED":
    case "TIMED_OUT":
      return {
        renderId: renderKey,
        status: "failed",
        error: await terminalFailureMessage(handle, statusName),
      };
    case "CANCELLED":
      return { renderId: renderKey, status: "cancelled" };
    default:
      throw new Error(
        `unexpected workflow status "${statusName}" for render ${renderKey}`
      );
  }
}

async function projectRunning(
  handle: WorkflowHandle,
  renderKey: string
): Promise<AudioRenderStatusResponse> {
  let progress: RenderProgress;
  try {
    progress = await handle.query<RenderProgress>(PROGRESS_QUERY_NAME);
  } catch (error) {
    // Three known worker-absent states project as "queued": no worker has
    // processed the execution yet (the query deadlines with no poller), the
    // frontend rejects the query with FAILED_PRECONDITION ("no poller seen
    // for task queue recently" — the demo's kill-to-restart window), or the
    // polling worker predates the progress query. Anything else is a real
    // failure and propagates.
    if (
      error instanceof QueryNotRegisteredError ||
      isGrpcDeadlineError(error) ||
      isWorkerAbsentQueryError(error)
    ) {
      return { renderId: renderKey, status: "queued" };
    }
    throw error;
  }

  validateProgress(progress, renderKey);
  if (progress.totalChunks === 0) {
    return { renderId: renderKey, status: "queued" };
  }
  return {
    renderId: renderKey,
    status: "running",
    completedChunks: progress.completedChunks,
    totalChunks: progress.totalChunks,
    attempt: progress.attempt,
  };
}

// @grpc/grpc-js status code: the frontend rejects a query with
// FAILED_PRECONDITION while no worker is polling the task queue.
const GRPC_FAILED_PRECONDITION = 9;

/**
 * True when the query failed because no worker is available to answer it
 * (gRPC FAILED_PRECONDITION anywhere in the cause chain) — a transient
 * worker-loss window, not an API error.
 */
function isWorkerAbsentQueryError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth++) {
    if (isGrpcServiceError(current) && current.code === GRPC_FAILED_PRECONDITION) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}

function validateProgress(progress: RenderProgress, renderKey: string): void {
  const wellFormed =
    progress !== null &&
    typeof progress === "object" &&
    Number.isInteger(progress.completedChunks) &&
    Number.isInteger(progress.totalChunks) &&
    Number.isInteger(progress.attempt) &&
    progress.completedChunks >= 0 &&
    progress.totalChunks >= 0 &&
    progress.completedChunks <= progress.totalChunks &&
    progress.attempt >= 1;
  if (!wellFormed) {
    throw new Error(
      `malformed progress query result for render ${renderKey}: ${JSON.stringify(progress)}`
    );
  }
}

async function terminalFailureMessage(
  handle: WorkflowHandle,
  statusName: string
): Promise<string> {
  try {
    await handle.result();
  } catch (error) {
    return failureMessageFrom(error);
  }
  // describe() said failed but result() resolved; report the raw status
  // rather than inventing a cause.
  return `workflow ended with status ${statusName}`;
}

function failureMessageFrom(error: unknown): string {
  if (error instanceof Error) {
    const cause = (error as { cause?: unknown }).cause;
    if (cause instanceof Error && cause.message.length > 0) {
      return cause.message;
    }
    return error.message;
  }
  return String(error);
}
