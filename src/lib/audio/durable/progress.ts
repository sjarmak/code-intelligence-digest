/**
 * Progress-query contract between the render Workflow and the status API.
 *
 * This module is a leaf with zero imports so `workflow.ts` can safely use it
 * inside the Workflow sandbox (no node builtins, no @temporalio/client). The
 * Workflow registers a query handler under PROGRESS_QUERY_NAME; the API's
 * status projection calls it while the execution is running.
 */

/** Query name the Workflow registers via defineQuery(). */
export const PROGRESS_QUERY_NAME = "progress";

/**
 * Result of the progress query.
 *
 * totalChunks === 0 means loadAndPlan has not completed yet; the API
 * projects that state as "queued". Once the plan exists, totalChunks is
 * fixed for the life of the execution and completedChunks counts finished
 * renderChunk Activities (0-based chunk indexes, so completedChunks === 6
 * means indexes 0..5 are done). attempt is the Temporal attempt number
 * (1-based) of the Activity currently in flight, or 1 while idle between
 * Activities.
 */
export interface RenderProgress {
  completedChunks: number;
  totalChunks: number;
  attempt: number;
}
