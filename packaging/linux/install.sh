#!/bin/sh
# Installs Divine Pulse for the current user: copies the program to ~/.local/opt/divine-pulse and adds it to the
# applications menu. Needs no administrator rights. Run again from a newer version's folder to update.
#   ./install.sh               install or update
#   ./install.sh --uninstall   remove the program and its menu entry (your runs and settings are kept)
set -eu
here="$(cd "$(dirname "$0")" && pwd)"
program="$HOME/.local/opt/divine-pulse"
data="${XDG_DATA_HOME:-$HOME/.local/share}"
entry="$data/applications/divine-pulse.desktop"

quit_running() {
    if [ -x "$program/Divine Pulse" ]; then
        "$program/Divine Pulse" --quit || { echo "Divine Pulse is still running: close it and try again." >&2; exit 1; }
    fi
}

if [ "${1:-}" = "--uninstall" ]; then
    quit_running
    rm -rf "$program"
    rm -f "$entry"
    echo "Divine Pulse was removed. Your runs, battle history, imported game files and settings are still in:"
    echo "  $data/Divine Pulse"
    exit 0
fi

[ -x "$here/Divine Pulse" ] || { echo "Run this from the unpacked Divine Pulse folder." >&2; exit 1; }
if [ "$here" != "$program" ]; then
    quit_running
    mkdir -p "$(dirname "$program")"
    rm -rf "$program.new"
    cp -R "$here" "$program.new"
    chmod -R u+w "$program.new"
    rm -rf "$program.new/data"
    if [ -d "$program/data" ]; then
        mv "$program/data" "$program.new/data"  # a portable copy's records
    fi
    rm -rf "$program"
    mv "$program.new" "$program"
fi

mkdir -p "$(dirname "$entry")"
cat > "$entry" <<ENTRY
[Desktop Entry]
Type=Application
Name=Divine Pulse
Comment=Companion for Fire Emblem: Three Houses
Exec="$program/Divine Pulse"
Icon=$program/_internal/frontend_dist/favicon.png
Terminal=false
Categories=Game;Utility;
StartupWMClass=divine-pulse
ENTRY
if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$(dirname "$entry")" >/dev/null 2>&1 || true
fi
echo "Divine Pulse is installed in $program. Start it from your applications menu."
