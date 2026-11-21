#!/bin/sh
# One-time setup on macOS: Python venv + dependencies, the memory reader helper, the frontend build.
# Run again any time to update after pulling changes. Then start the app with tools/launch.sh.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
backend="$root/backend"
venv="$backend/.venv"

python=""
for candidate in python3.14 python3.13 python3.12 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 12))'; then
        python="$candidate"
        break
    fi
done
if [ -z "$python" ]; then
    echo "Python 3.12 or newer is needed (for example: brew install python@3.13)." >&2
    exit 1
fi
if ! xcode-select -p >/dev/null 2>&1; then
    echo "Xcode's command-line tools are needed to build the memory reader. Run: xcode-select --install" >&2
    exit 1
fi

echo "== Python environment"
[ -x "$venv/bin/python" ] || "$python" -m venv "$venv"
"$venv/bin/python" -m pip install --upgrade pip --quiet
"$venv/bin/python" -m pip install -r "$backend/requirements.txt" --quiet

echo "== Memory reader"
# Built into the data folder on first use anyway; building now reports a problem here instead.
(cd "$backend" && "$venv/bin/python" -c 'from app.system.memory_macos import helper_path; print(helper_path())')

echo "== Frontend build"
cd "$root/frontend"
npm install --no-audit --no-fund
npm run build

echo
echo "Done. Start Divine Pulse with: tools/launch.sh"
echo "Closing the Divine Pulse window stops the app."
