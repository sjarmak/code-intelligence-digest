#!/bin/bash
#
# Install the launchd hourly mirror schedule.
#
# This substitutes {{REPO_ROOT}} + {{LOG_DIR}} into the plist template,
# writes it to ~/Library/LaunchAgents/, and loads it via launchctl.
#
# Safe to re-run: unloads any existing job before loading the new one.
#
# To remove, run scripts/uninstall-mirror-schedule.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE="$REPO_ROOT/scripts/launchd/com.codeintel.mirror.plist"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
DEST="$LAUNCH_AGENTS_DIR/com.codeintel.mirror.plist"
LOG_DIR="$HOME/.code-intel-digest-logs"

if [ ! -f "$TEMPLATE" ]; then
  echo "✗ Template not found: $TEMPLATE" >&2
  exit 1
fi

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

# Substitute and write to final location.
sed \
  -e "s|{{REPO_ROOT}}|$REPO_ROOT|g" \
  -e "s|{{LOG_DIR}}|$LOG_DIR|g" \
  "$TEMPLATE" > "$DEST"

# Validate the rendered plist before activating.
if ! plutil -lint "$DEST" >/dev/null 2>&1; then
  echo "✗ Rendered plist failed validation: $DEST" >&2
  plutil -lint "$DEST" >&2 || true
  rm -f "$DEST"
  exit 1
fi

# Unload any existing job first (ignore failure if not loaded).
launchctl unload "$DEST" 2>/dev/null || true
launchctl load "$DEST"

echo "✓ Installed $DEST"
echo "  Repo:     $REPO_ROOT"
echo "  Log dir:  $LOG_DIR"
echo "  Schedule: every hour at :05"
echo
echo "Useful commands:"
echo "  tail -f $LOG_DIR/mirror.log             # watch live output"
echo "  launchctl list | grep codeintel.mirror  # confirm it's loaded"
echo "  launchctl start com.codeintel.mirror    # fire once manually"
echo "  scripts/uninstall-mirror-schedule.sh    # remove"
