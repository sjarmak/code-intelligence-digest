#!/bin/bash
#
# Remove the launchd hourly mirror schedule.
# Logs under ~/.code-intel-digest-logs/ are preserved; delete manually if wanted.

set -euo pipefail

DEST="$HOME/Library/LaunchAgents/com.codeintel.mirror.plist"

if [ ! -f "$DEST" ]; then
  echo "ℹ  Not installed: $DEST"
  exit 0
fi

launchctl unload "$DEST" 2>/dev/null || true
rm -f "$DEST"

echo "✓ Uninstalled $DEST"
echo "ℹ  Logs preserved at ~/.code-intel-digest-logs/ (delete manually if unneeded)"
