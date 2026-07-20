#!/usr/bin/env bash
#
# Local-primary daily ingestion wrapper (bead code-intel-digest-06d / P2.1).
#
# Runs the daily sync (Inoreader → normalize → categorize → score → embed)
# against the LOCAL primary Postgres, replacing the old Render cron. Invoked by
# the systemd user timer (deploy/systemd/code-intel-daily.timer).
#
# USE_LOCAL_DB=true forces the driver onto LOCAL_DATABASE_URL; the preflight
# guard refuses to run unless that URL is a local postgres host, so a missing or
# misconfigured .env.local can NEVER let the scheduled job write the (being
# decommissioned) Render production database.
#
set -euo pipefail

REPO="$(cd "$(dirname "$0")/.." && pwd)"
cd "$REPO"

bash scripts/lib/assert-local-db.sh run-local-cron

export USE_LOCAL_DB=true
exec npm run cron:daily
