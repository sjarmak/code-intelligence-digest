#!/bin/bash
#
# Remove all launchd schedules installed by install-mirror-schedule.sh.
# Logs under ~/.code-intel-digest-logs/ are preserved; delete manually if wanted.

set -euo pipefail

LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"

PLISTS=(
  "com.codeintel.mirror.plist"
  "com.codeintel.mirror.reconcile.plist"
  "com.codeintel.mirror.schema-drift.plist"
)

any_found=0
for plist in "${PLISTS[@]}"; do
  dest="$LAUNCH_AGENTS_DIR/$plist"
  if [ -f "$dest" ]; then
    launchctl unload "$dest" 2>/dev/null || true
    rm -f "$dest"
    echo "✓ Uninstalled $plist"
    any_found=1
  fi
done

if [ "$any_found" -eq 0 ]; then
  echo "ℹ  No mirror launchd jobs were installed."
fi

echo "ℹ  Logs preserved at ~/.code-intel-digest-logs/ (delete manually if unneeded)"
