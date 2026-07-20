#!/usr/bin/env bash
#
# Shared local-DB preflight (bead code-intel-digest-676).
#
# Asserts LOCAL_DATABASE_URL points at a local postgres host, and exits non-zero
# if it does not. Both scheduled wrappers pair a local store with an env-chosen
# DB, so neither may run against the (being decommissioned) Render production
# database: for run-local-cron.sh that would be a misdirected write, and for
# reconcile-audio-daily.sh a DB it cannot see rows in makes the entire audio
# store look unreferenced and therefore deletable.
#
# Uses dotenv so .env.local is parsed exactly as the app parses it. dotenv does
# not override an already-set key, so an injected LOCAL_DATABASE_URL wins — which
# is what lets the tests drive this against a URL table.
#
# Usage: bash scripts/lib/assert-local-db.sh <caller-name>
#
set -euo pipefail

CALLER="${1:?assert-local-db.sh: caller name required}"

npx tsx -e "
require('dotenv').config({ path: '.env.local', quiet: true });
const u = process.env.LOCAL_DATABASE_URL || '';
if (!/^postgres(ql)?:\/\/.*@(localhost|127\.0\.0\.1):/.test(u)) {
  console.error('${CALLER}: LOCAL_DATABASE_URL is not a local postgres URL; refusing to run.');
  process.exit(1);
}
"
