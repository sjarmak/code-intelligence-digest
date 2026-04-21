#!/bin/bash
#
# Bootstrap the local market-intel mirror from zero.
#
# What it does (in order):
#   1. Verifies prereqs (Docker, pg_dump v18, env vars, LOCAL host guard)
#   2. Wipes + recreates the docker volume  (skipped with --keep-data)
#   3. Starts the pg18+pgvector container
#   4. Waits for the server to accept connections
#   5. Applies production schema to local   (via pg_dump --schema-only)
#   6. Runs the initial mirror sync         (skipped with --schema-only)
#   7. Reports final row counts + watermark state
#
# Usage:
#   bash scripts/mirror-bootstrap.sh              # full bootstrap
#   bash scripts/mirror-bootstrap.sh --force      # skip volume-wipe prompt
#   bash scripts/mirror-bootstrap.sh --keep-data  # preserve volume, refresh schema only
#   bash scripts/mirror-bootstrap.sh --schema-only  # apply prod schema, skip data sync
#   bash scripts/mirror-bootstrap.sh --help
#
# Env (loaded from .env.local via the mirror script itself):
#   PRODUCTION_DATABASE_URL  - prod Postgres connection string
#   LOCAL_DATABASE_URL       - local Postgres; must resolve to localhost/127.0.0.1

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO_ROOT"

# ---- arg parsing --------------------------------------------------------

FORCE=0
KEEP_DATA=0
SCHEMA_ONLY=0

for arg in "$@"; do
  case "$arg" in
    --force)        FORCE=1 ;;
    --keep-data)    KEEP_DATA=1 ;;
    --schema-only)  SCHEMA_ONLY=1 ;;
    --help|-h)
      sed -n '2,25p' "$0"
      exit 0
      ;;
    *)
      echo "Unknown arg: $arg" >&2
      echo "Run with --help for usage." >&2
      exit 2
      ;;
  esac
done

# ---- styling ------------------------------------------------------------

if [ -t 1 ]; then
  BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; YELLOW=$'\033[33m'; RED=$'\033[31m'; RESET=$'\033[0m'
else
  BOLD=''; DIM=''; GREEN=''; YELLOW=''; RED=''; RESET=''
fi

step() { echo; echo "${BOLD}==>${RESET} $*"; }
info() { echo "    $*"; }
warn() { echo "${YELLOW}!!${RESET}  $*" >&2; }
die()  { echo "${RED}✗${RESET}  $*" >&2; exit 1; }
ok()   { echo "${GREEN}✓${RESET}  $*"; }

# ---- prereqs ------------------------------------------------------------

step "Checking prerequisites"

command -v docker >/dev/null 2>&1 || die "docker not found"
docker info >/dev/null 2>&1 || die "docker daemon is not running"
ok "Docker available"

PG_DUMP=""
for candidate in \
  "/opt/homebrew/opt/postgresql@18/bin/pg_dump" \
  "/usr/local/opt/postgresql@18/bin/pg_dump" \
  "$(command -v pg_dump 2>/dev/null || true)"; do
  if [ -x "$candidate" ]; then
    if "$candidate" --version 2>/dev/null | grep -q " 18\."; then
      PG_DUMP="$candidate"
      break
    fi
  fi
done
[ -n "$PG_DUMP" ] || die "pg_dump v18 not found. Install via: brew install postgresql@18"
PSQL="$(dirname "$PG_DUMP")/psql"
[ -x "$PSQL" ] || die "psql not found next to $PG_DUMP"
ok "pg_dump v18 at $PG_DUMP"

# The mirror script handles its own dotenv loading + URL validation.
# We call node once just to probe connection string shapes (avoids reading
# .env.local directly from bash).
URLS="$(npx tsx -e "
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local', quiet: true });
const prod = process.env.PRODUCTION_DATABASE_URL;
const local = process.env.LOCAL_DATABASE_URL;
if (!prod) { console.error('PRODUCTION_DATABASE_URL not set'); process.exit(1); }
if (!local) { console.error('LOCAL_DATABASE_URL not set'); process.exit(1); }
const l = new URL(local);
const isLocal = l.hostname === 'localhost' || l.hostname === '127.0.0.1' || l.hostname.endsWith('.local');
if (!isLocal) { console.error('LOCAL_DATABASE_URL host is not local: ' + l.hostname); process.exit(1); }
if (prod === local) { console.error('PRODUCTION_DATABASE_URL and LOCAL_DATABASE_URL are identical'); process.exit(1); }
process.stdout.write(prod + '\n' + local);
" 2>&1)"
if [ $? -ne 0 ]; then
  die "Env check failed: $URLS"
fi
PROD_URL="$(echo "$URLS" | head -n1)"
LOCAL_URL="$(echo "$URLS" | tail -n1)"
ok "Env vars present, LOCAL_DATABASE_URL host is local-only"

# ---- volume wipe --------------------------------------------------------

VOLUME="code-intel-digest_postgres_data"

if [ "$KEEP_DATA" -eq 0 ]; then
  step "Wiping local postgres volume"

  if docker volume inspect "$VOLUME" >/dev/null 2>&1; then
    if [ "$FORCE" -ne 1 ]; then
      warn "About to delete volume '$VOLUME' — all local Postgres data will be lost."
      warn "User-written tables (starred_items, saved_items, etc.) in local only will be destroyed."
      printf "    Continue? [y/N] "
      read -r reply
      case "$reply" in
        y|Y|yes|YES) ;;
        *) die "Aborted by user" ;;
      esac
    fi
    docker compose down >/dev/null 2>&1 || true
    docker volume rm "$VOLUME" >/dev/null
    ok "Removed volume $VOLUME"
  else
    info "Volume $VOLUME not found (already clean)"
  fi
else
  info "--keep-data set: skipping volume wipe"
fi

# ---- start container ----------------------------------------------------

step "Starting pg18+pgvector container"
docker compose up -d postgres >/dev/null
ok "Container started"

info "Waiting for Postgres to accept connections..."
for _ in $(seq 1 60); do
  if PGCONNECT_TIMEOUT=2 "$PSQL" "$LOCAL_URL" -c "SELECT 1" >/dev/null 2>&1; then
    ok "Postgres accepting connections"
    break
  fi
  sleep 1
done
PGCONNECT_TIMEOUT=2 "$PSQL" "$LOCAL_URL" -c "SELECT 1" >/dev/null 2>&1 \
  || die "Postgres did not come up within 60s"

# ---- schema sync --------------------------------------------------------

step "Cloning production schema to local"

SCHEMA_LOG="$(mktemp -t mirror-bootstrap-schema.XXXXXX.log)"
set +e
"$PG_DUMP" --schema-only --no-owner --no-privileges --no-comments "$PROD_URL" \
  | "$PSQL" "$LOCAL_URL" -v ON_ERROR_STOP=0 >"$SCHEMA_LOG" 2>&1
SCHEMA_EXIT=$?
set -e

# The restore sees duplicate-DDL errors when rerunning on top of a DB
# that was already initialised by schema-postgres.ts. We strip the benign
# patterns (all safely ignored) and flag anything that's left.
BENIGN_RE='(already exists|multiple primary keys for table|column .* of relation .* already exists)'

set +e
TOTAL=$(grep -c '^ERROR:' "$SCHEMA_LOG")
[ -z "$TOTAL" ] && TOTAL=0
BENIGN=$(grep -cE "^ERROR:.*${BENIGN_RE}" "$SCHEMA_LOG")
[ -z "$BENIGN" ] && BENIGN=0
UNEXPECTED=$(( TOTAL - BENIGN ))
set -e

if [ "$UNEXPECTED" -gt 0 ]; then
  warn "Schema restore produced ${UNEXPECTED} unexpected error(s). See $SCHEMA_LOG"
  grep '^ERROR:' "$SCHEMA_LOG" | grep -Ev "$BENIGN_RE" | head -5 >&2
else
  ok "Schema in sync (${BENIGN} benign duplicate-DDL notices in $SCHEMA_LOG)"
fi

TABLE_COUNT="$("$PSQL" "$LOCAL_URL" -tAc "SELECT COUNT(*) FROM pg_tables WHERE schemaname='public'" 2>/dev/null || echo 0)"
EXT_COUNT="$("$PSQL" "$LOCAL_URL" -tAc "SELECT COUNT(*) FROM pg_extension" 2>/dev/null || echo 0)"
info "Local has $TABLE_COUNT public tables, $EXT_COUNT extensions"

# ---- data sync ----------------------------------------------------------

if [ "$SCHEMA_ONLY" -eq 1 ]; then
  step "Skipping data sync (--schema-only)"
else
  step "Running initial mirror sync (this can take 10–15 min for first run)"
  info "Tail /tmp/mirror-bootstrap.log for progress"
  if npx tsx scripts/mirror-from-production.ts 2>&1 | tee /tmp/mirror-bootstrap.log; then
    ok "Initial mirror sync complete"
  else
    die "Mirror sync failed; see /tmp/mirror-bootstrap.log"
  fi
fi

# ---- summary ------------------------------------------------------------

step "Summary"

"$PSQL" "$LOCAL_URL" -c "
SELECT table_name, last_watermark, last_synced_at, rows_synced
FROM mirror_watermarks
ORDER BY table_name;
" 2>/dev/null || warn "mirror_watermarks not present (expected if --schema-only)"

echo
ok "Bootstrap complete. Hourly sync will be wired up in Phase 4 (scripts/mirror-hourly.sh + launchd)."
