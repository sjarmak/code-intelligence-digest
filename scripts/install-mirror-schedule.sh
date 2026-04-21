#!/bin/bash
#
# Install all launchd schedules for the production → local mirror:
#   - com.codeintel.mirror              hourly,  :05 (hourly sync)
#   - com.codeintel.mirror.reconcile    daily,   03:10 (deletion reconciliation)
#   - com.codeintel.mirror.schema-drift weekly,  Mon 04:00 (schema-drift alert)
#
# Each plist template has {{REPO_ROOT}} and {{LOG_DIR}} placeholders; this
# script substitutes them, lints the rendered plist with plutil, and loads
# it via launchctl. Safe to re-run — existing jobs are unloaded first.
#
# To remove, run scripts/uninstall-mirror-schedule.sh.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TEMPLATE_DIR="$REPO_ROOT/scripts/launchd"
LAUNCH_AGENTS_DIR="$HOME/Library/LaunchAgents"
LOG_DIR="$HOME/.code-intel-digest-logs"

PLISTS=(
  "com.codeintel.mirror.plist"
  "com.codeintel.mirror.reconcile.plist"
  "com.codeintel.mirror.schema-drift.plist"
)

mkdir -p "$LAUNCH_AGENTS_DIR" "$LOG_DIR"

install_one() {
  local name="$1"
  local template="$TEMPLATE_DIR/$name"
  local dest="$LAUNCH_AGENTS_DIR/$name"

  if [ ! -f "$template" ]; then
    echo "✗ Template missing: $template" >&2
    return 1
  fi

  sed \
    -e "s|{{REPO_ROOT}}|$REPO_ROOT|g" \
    -e "s|{{LOG_DIR}}|$LOG_DIR|g" \
    "$template" > "$dest"

  if ! plutil -lint "$dest" >/dev/null 2>&1; then
    echo "✗ Rendered plist failed validation: $dest" >&2
    plutil -lint "$dest" >&2 || true
    rm -f "$dest"
    return 1
  fi

  launchctl unload "$dest" 2>/dev/null || true
  launchctl load "$dest"
  echo "  ✓ $name"
}

echo "Installing launchd jobs:"
for plist in "${PLISTS[@]}"; do
  install_one "$plist"
done

echo
echo "Schedules:"
echo "  hourly sync           every hour at :05"
echo "  deletion reconcile    daily at 03:10"
echo "  schema-drift check    Mondays at 04:00"
echo
echo "Logs:   $LOG_DIR"
echo "Remove: scripts/uninstall-mirror-schedule.sh"
echo
echo "Useful:"
echo "  launchctl list | grep codeintel.mirror"
echo "  launchctl start com.codeintel.mirror              # fire hourly now"
echo "  launchctl start com.codeintel.mirror.reconcile    # fire reconcile now"
echo "  launchctl start com.codeintel.mirror.schema-drift # fire drift-check now"
echo "  tail -f $LOG_DIR/mirror.log"
