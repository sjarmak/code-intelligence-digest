# Durable render contracts

Module map for `src/lib/audio/durable/`. Spec of record:
`temporal_devrel/presentation/code-intelligence-digest-audio/README.md`.
Global invariant: no raw transcript text or audio bytes cross into Workflow
history — Activities exchange references, hashes, and compact metadata only.

## Modules and responsibilities

| Module | Responsibility |
| --- | --- |
| `types.ts` (identity/contracts) | Every cross-boundary shape: RenderConfig, RenderKeyInput, ChunkPlan, ChunkMetadata, StitchResult, PublishResult, RenderInput, API request/response, LedgerEvent, FaultGateSpec. No logic. |
| `keys.ts` (identity) | Pure functions: canonicalJson, computeRenderKey, workflowIdFor, chunkKeyFor, finalKeyFor, zeroPad. No IO, no env. |
| `chunker.ts` | Deterministic plan (`chunker-v1`): sanitized transcript -> PlannedChunk[] with char/byte offsets and per-chunk text hashes. Pure given the transcript text. |
| `providers/deterministicTts.ts` (`deterministic-v1`) | TTS adapter for the durable path. The deterministic rehearsal adapter emits byte-stable WAV from `sha256(renderKey + chunkIndex + chunkTextHash)`; real providers are routed through the legacy `getProvider` with a locally derived idempotency handle. Emits provider_attempt/provider_commit ledger events; honors fault gates at provider boundaries. |
| `ledger.ts` | Append-only JSONL writer for LedgerEvent with fsync per line. Read side for the harness/invariant checker. |
| `faultGates.ts` | Fault-gate protocol (below): match armed gates, emit gate_reached, hold or inject. |
| `stitcher.ts` | Format-aware assembly (`stitcher-v1`, ffmpeg-class tool). Streams chunk objects to `finalKey`, validates container + checksum. Never `Buffer.concat`. |
| `renderStore.ts` (the db-manifest role) | Additive Postgres records: render row keyed by renderKey (with individual identity fields), chunk manifest, publish upsert. Audit/cleanup surface, not an execution checkpoint store. Tables: `audio_renders`, `audio_render_chunks`; `generated_podcast_audio` untouched. |
| `activities.ts` | Temporal Activities: loadAndPlan, renderChunk, stitchChunks, publishRender, built by the `createActivities(deps)` factory (tests inject temp-dir stores and a stubbed DB boundary). All IO lives here; each returns metadata only, each external write is idempotent (deterministic keys, checksum validation before reuse). |
| `workflows.ts` | Sequential `renderPodcast` Workflow per spec pseudocode, plus the `progress` query (registered under `PROGRESS_QUERY_NAME`, returning the progress.ts shape extended with `phaseName`) and `RENDER_POLICY_VERSION` (pins Activity timeout/retry semantics; kept equal to temporalClient.ts's starter-side copy by a drift-guard test). Coordinates Activities from immutable metadata; no crypto, no IO, no imports of adapter/ledger/db modules. |
| `worker.ts` (+ `scripts/durable-worker.ts`) | Temporal worker bootstrap on task queue `podcast-render`: registers workflow bundle + activities, env-driven address/namespace, graceful SIGTERM/SIGINT drain in the entrypoint (demo kills still use SIGKILL). Run with `npm run durable:worker`. |
| `progress.ts` | Leaf (zero imports, Workflow-sandbox-safe): `PROGRESS_QUERY_NAME` ("progress") + `RenderProgress {completedChunks, totalChunks, attempt}`. `workflow.ts` registers the query under this name; totalChunks === 0 projects as "queued". |
| `temporalClient.ts` | Starter-side Temporal wiring (never imported by workflow.ts): lazy singleton `getTemporalClient()` (env `TEMPORAL_ADDRESS` default localhost:7233, `TEMPORAL_NAMESPACE` default "default"), `renderTaskQueue()` (env `TEMPORAL_TASK_QUEUE` default "podcast-render"), `RENDER_PODCAST_WORKFLOW_TYPE` = "renderPodcast" (workflow.ts must export a function of this name), `RENDER_POLICY_VERSION` = "render-policy-v1", `isTemporalUnavailableError` (503 classification). |
| `statusProjection.ts` | `projectRenderStatus(client, renderKey)`: describe + progress query + result -> `AudioRenderStatusResponse`; null = no execution (routes map to 404). Shared by POST duplicate-start and GET. |
| `api` (`app/api/podcast/audio-renders/`) | POST: sanitize, hash, persist transcript ref, computeRenderKey, start Workflow with `WorkflowIdReusePolicy.REJECT_DUPLICATE`, 202/200. GET: project Temporal status into AudioRenderStatusResponse. Synchronous `render-audio` route untouched. |

## Dependency direction (imports point down only)

```
api        worker
 |          |  \
 |     workflow  activities
 |        |     /  |   \    \
 |        |    chunker adapter stitcher db-manifest
 |        |        \    |    /       |
 |        |         gates, ledger    |
  \       |            |            /
   +------+--------- types.ts, keys.ts (leaf: no internal deps)
```

- `types.ts` and `keys.ts` import nothing from this package (only `../types`).
- `ledger.ts` imports types only; `faultGates.ts` imports ledger + types.
- `workflows.ts` imports types only, type-only (Workflow sandbox: no node:crypto, no fs).
- Nothing imports `api`, `worker`, or `workflow` except the worker/route entrypoints.
- DB safety: `db-manifest` and all demo/test tooling default to
  `USE_LOCAL_DB=true` + `LOCAL_DATABASE_URL`; production DSNs are never a
  default on the durable path.

## Fault-gate file protocol

Faults are a contract armed by identity (renderKey, phase, chunkIndex,
attempt, named boundary), never a timing trick.

- **Control file** — JSON at `DEMO_FAULT_CONTROL` (default
  `.demo/fault-control.json` in the worktree), shape `FaultControlFile`:
  `{ "gates": [ArmedGate...] }`. An `ArmedGate` is a `FaultGateSpec` plus an
  `action`: `{ "kind": "hold" }` or
  `{ "kind": "inject_retryable_error", "message": "..." }`. Omitted
  `chunkIndex`/`attempt` match any value; `attempt` is Temporal's 1-based number.
- **Ledger** — components append `LedgerEvent` lines as JSONL to
  `DEMO_LEDGER_PATH` (default `.demo/ledger.jsonl`), one event per line,
  fsync after each append, so an event survives a `kill -9` issued the
  moment it is observable.
- **At each named boundary** the component reads the control file (missing
  file = nothing armed). On a match:
  - `hold`: append `gate_reached`, then poll the control file and hold
    execution while the matching gate remains with action `hold`. The gate
    releases when the entry is removed (or the file deleted).
  - `inject_retryable_error`: append `injected_failure`, remove the consumed
    gate entry from the control file (one-shot, so the retry passes), then
    throw a retryable error.
- **Harness** — arms gates by writing the control file, tails the ledger and
  waits for the matching durable `gate_reached` record before acting
  (`kill -9`, restart, release). No step sleeps for an estimated duration.
