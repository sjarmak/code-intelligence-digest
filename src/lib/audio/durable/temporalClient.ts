/**
 * Temporal client wiring for the durable render path.
 *
 * Starter-side only: this module pulls in @temporalio/client (grpc), so it
 * must never be imported from workflow.ts. The API routes and any CLI
 * starter share one lazily connected client; a failed connection is not
 * cached, so a later request retries instead of pinning the failure.
 */

import { Client, Connection, isGrpcServiceError } from "@temporalio/client";

/**
 * Pins timeout/retry semantics that can affect the accepted artifact; part
 * of the renderKey identity tuple. Changing the worker's retry policy or
 * Activity timeouts in a byte-affecting way requires bumping this version.
 */
export const RENDER_POLICY_VERSION = "render-policy-v1";

/** Workflow type name; workflow.ts must export a function with this name. */
export const RENDER_PODCAST_WORKFLOW_TYPE = "renderPodcast";

export const DEFAULT_TEMPORAL_ADDRESS = "localhost:7233";
export const DEFAULT_RENDER_TASK_QUEUE = "podcast-render";

export function temporalAddress(): string {
  return process.env.TEMPORAL_ADDRESS || DEFAULT_TEMPORAL_ADDRESS;
}

export function temporalNamespace(): string {
  return process.env.TEMPORAL_NAMESPACE || "default";
}

/** Task queue shared by the starter (this module) and worker bootstrap. */
export function renderTaskQueue(): string {
  return process.env.TEMPORAL_TASK_QUEUE || DEFAULT_RENDER_TASK_QUEUE;
}

let clientPromise: Promise<Client> | null = null;

/**
 * Lazily connected singleton Client. Connection errors propagate to the
 * caller (the API maps them to 503) and clear the cached promise so the
 * next call reconnects.
 */
export async function getTemporalClient(): Promise<Client> {
  if (clientPromise === null) {
    const attempt = connectClient();
    clientPromise = attempt;
    try {
      return await attempt;
    } catch (error) {
      if (clientPromise === attempt) {
        clientPromise = null;
      }
      throw error;
    }
  }
  return clientPromise;
}

async function connectClient(): Promise<Client> {
  const connection = await Connection.connect({
    address: temporalAddress(),
    connectTimeout: "5s",
  });
  return new Client({ connection, namespace: temporalNamespace() });
}

// @grpc/grpc-js status codes; imported values, not guesses.
const GRPC_DEADLINE_EXCEEDED = 4;
const GRPC_UNAVAILABLE = 14;

/**
 * True when the error (or a cause in its chain) means the Temporal service
 * could not be reached: gRPC UNAVAILABLE / DEADLINE_EXCEEDED, or the SDK's
 * connect-timeout failure. The API maps these to 503 without claiming the
 * render was accepted; anything else is a real error and stays a 500.
 */
export function isTemporalUnavailableError(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 8 && current !== undefined && current !== null; depth++) {
    if (
      isGrpcServiceError(current) &&
      (current.code === GRPC_UNAVAILABLE || current.code === GRPC_DEADLINE_EXCEEDED)
    ) {
      return true;
    }
    if (current instanceof Error && /failed to connect before the deadline/i.test(current.message)) {
      return true;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
