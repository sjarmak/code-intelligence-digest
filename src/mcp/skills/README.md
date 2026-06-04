# Copilot MCP skills

Claude Code skills that drive the `code-intel-copilot` MCP server (`src/mcp/server.ts`).
They are kept in the repo so they travel with the code and can be installed on any
machine. Each subfolder is one skill:

| Skill | Output | Use when |
|---|---|---|
| `digest-insights` | inline answer | General Q&A over the mirror ("what's trending in dev tools") |
| `orient-digest` | inline text | Stephanie's terse personal ~7-day catch-up (not for sharing) |
| `distill-digest` | `out/distill-*.md` | Share-ready weekly digest for Slack/email or GTM |
| `podcast-digest` | `out/podcast-*.md` + `.mp3` | Weekly podcast script + rendered audio |

All four read through the same five MCP tools: `search_items`,
`semantic_search_items`, `get_item`, `aggregate_items`, `mirror_status`.

## Install on a machine

1. **Register the MCP server** from the repo root:

   ```bash
   claude mcp add code-intel-copilot -- npx tsx /absolute/path/to/code-intel-digest/src/mcp/server.ts
   ```

2. **Make the skills discoverable** by Claude Code — symlink (so they stay in sync
   with the repo) or copy them into the project's `.claude/skills/`:

   ```bash
   # from the repo root, symlink each skill:
   for s in digest-insights distill-digest orient-digest podcast-digest; do
     ln -sfn "$PWD/src/mcp/skills/$s" ".claude/skills/$s"
   done
   ```

   (Copy instead of symlink if you prefer them frozen: `cp -R src/mcp/skills/<name> .claude/skills/`.)

## Database mode

The server resolves its backing store from the environment (see
`src/lib/copilot/mirror-context.ts` → `resolveCopilotDbContext`):

- **`COPILOT_DB_MODE=direct`** (or simply setting `COPILOT_REMOTE_DATABASE_URL`):
  connects **directly to the live production database**. Point it at a **read-only
  Postgres role** (`GRANT SELECT` only) — write-safety is not enforced by a hostname
  guard in this mode, so the read-only role is what keeps the copilot from touching
  production. SSL is on (required by Render). In this mode `mirror_status` reports
  `dbMode: direct` and data is real-time; the mirror freshness fields are N/A.

- **`COPILOT_DB_MODE=mirror`** (or unset with no remote URL): reads the hourly local
  mirror at `LOCAL_DATABASE_URL`. `mirror_status` reports `staleMinutes`.

The skills are mode-aware: their "Always do first" step branches on `dbMode`, so the
same skill works whether you're on the mirror machine or reading live prod.

### Env for direct prod mode

```bash
# .env.local on the prod-reading machine
COPILOT_DB_MODE=direct
COPILOT_REMOTE_DATABASE_URL=postgres://<readonly_user>:<pw>@<host>/<db>?sslmode=require
```
