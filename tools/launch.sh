#!/bin/sh
# Starts the tracker from the source checkout on macOS (after tools/setup.sh).
set -eu
backend="$(cd "$(dirname "$0")/../backend" && pwd)"
cd "$backend"
exec "$backend/.venv/bin/python" -m app "$@"
