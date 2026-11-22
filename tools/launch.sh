#!/bin/sh
# Starts Divine Pulse from the source checkout on macOS, after tools/setup.sh (the same checks as tools/launch.bat).
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
backend="$root/backend"
if [ ! -x "$backend/.venv/bin/python" ]; then
    echo "Divine Pulse isn't set up yet: run tools/setup.sh first." >&2
    exit 1
fi
if [ ! -f "$root/frontend/dist/index.html" ]; then
    echo "The frontend isn't built: run tools/setup.sh again." >&2
    exit 1
fi
cd "$backend"
exec "$backend/.venv/bin/python" -m app "$@"
