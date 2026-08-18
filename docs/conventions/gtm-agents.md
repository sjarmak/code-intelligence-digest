# GTM agent workflows

Failure modes covered: agents misused as chatbots; manual prod runs that should go through cron / Reports; trace shape changes silently breaking `/reports`; missing web-search context where it would help grounding.

GTM agents are **scheduled workflows**, not chat. Each agent has jobs that run daily or weekly and produce reports + content ideas stored in the DB.

## Configuration

| File | Purpose |
| --- | --- |
| `src/config/agent-jobs.ts` | `AGENTS`, `AGENT_JOBS` (scope, schedule, optional `webSearchQueries`, `buildPrompt`) |
| `src/lib/agents/run-job.ts` | `runAgentJob(agentId, jobId)` — loads items, optional web-search, builds context, calls LLM, saves to `agent_runs` |
| `scripts/cron-agent-jobs.ts` | Cron entrypoint; daily jobs every run, weekly jobs on Mondays |

## Models and web search

- All agent jobs use the same **quality model** as newsletter and podcast (default `claude-sonnet-4-6` when `ANTHROPIC_API_KEY` is set; see `llm-config.md` if it exists).
- When `PARALLEL_API_KEY` is configured AND a job defines `webSearchQueries`, `run-job` runs a web-search step and appends results to context for verification + grounding before the LLM call.

## Cron

```bash
npm run cron:agents
# or: npx tsx scripts/cron-agent-jobs.ts
```

Schedule once per day in Render cron (e.g. `0 8 * * *` for 8:00 UTC).

## Manual run

- **Reports page** (`/reports`, signed-in): pick a job (or "Run all daily jobs"), click Run. Calls `POST /api/reports/run`. Works in production.
- **Dev only**: `POST /api/admin/run-agent-job` with `{"agentId": "...", "jobId": "..."}`. **Disabled in production**.

## Outputs

- `GET /api/reports` — list runs
- `GET /api/reports/[id]` — fetch one run
- UI: `/reports` (list) and `/reports/[id]` (view)
- Email: `/agents` page, signed-in users can send current / selected reports to their registered email. Requires `RESEND_API_KEY`; optional `FROM_EMAIL` (defaults to `onboarding@resend.dev` for testing — use a verified domain in prod).

## Curator retrieval trace (shared shape)

Source of truth: `src/lib/retrieval/curator-trace.ts`.

- `CURATOR_TRACE_SCHEMA_VERSION` — bump when changing trace shapes
- `GoalConfigSnapshot` — categories, caps, weights captured at run time
- `AgentRankingTrace` — top-N docs with `baseScore` / `goalScore` / `agentScore`
- Helpers: `retrievalTraceToSteps`, `rankingTraceToSteps` — ordered human-readable steps

`retrieveForAgent` (`agentRetrieval.ts`) attaches `schemaVersion`, `configSnapshot`, and `merge.caps` / `merge.countsMerged` (per-source docs that entered the dedupe map). `rankForAgent` accepts optional `{ rankingTrace, rankingSampleSize }` to capture a ranking sample for any goal.

## Content ideas pipeline trace

`generateContentIdeas({ pipelineTrace: true })` builds `ContentIdeasPipelineTrace`:

- Dual retrieval traces
- `ranking`
- Candidate gates
- `refinement_stages` (pool → gates → raw ideas → final)
- `interpretable_steps`

Persisted in `output_metadata.structuredPayload` for scheduled / UI runs (default on; `CONTENT_IDEAS_PIPELINE_TRACE=0` disables). UI: `/reports/[id]` shows schema version, refinement chips, ranking table, and ordered steps. API: `GET /api/agents/content-ideas?trace=1`.

## Extending other agents (market brief, competitor flows, etc.)

1. Pass `trace` into `retrieveForAgent`.
2. Pass `rankingTrace` into `rankForAgent`.
3. Persist a goal-specific wrapper (like `ContentIdeasPipelineTrace`) in `saveAgentRun` metadata.
4. **Bump `CURATOR_TRACE_SCHEMA_VERSION`** when changing trace shapes.

## Adding a new agent or job

Extend `AGENT_JOBS` in `src/config/agent-jobs.ts` with:

- `scope` (categories, `competitorsOnly`, etc.)
- Optional `webSearchQueries`
- `buildPrompt`

Add the agent to `AGENTS` if new.
