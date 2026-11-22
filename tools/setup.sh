#!/bin/sh
# One-time setup on macOS: Python venv + dependencies, the memory reader, the frontend build, a desktop shortcut.
# Run again any time to update after pulling changes. Then start the app with the shortcut or tools/launch.sh.
# The same steps, in the same order and with the same messages, as tools/setup.ps1 on Windows.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
backend="$root/backend"
frontend="$root/frontend"
venv="$backend/.venv"

fail() {
    echo "$1" >&2
    exit 1
}

# Python 3.12+: the newest on PATH, or where Homebrew and python.org install one (macOS's own python3 is 3.9).
python=""
for candidate in python3.14 python3.13 python3.12 /opt/homebrew/bin/python3 /usr/local/bin/python3 python3; do
    if command -v "$candidate" >/dev/null 2>&1 && "$candidate" -c 'import sys; sys.exit(sys.version_info < (3, 12))' 2>/dev/null; then
        python="$candidate"
        break
    fi
done
[ -n "$python" ] || fail "Python 3.12 or newer is needed (for example: brew install python@3.13)."
node_ok=0
if command -v node >/dev/null 2>&1; then
    node -e 'const [a, b] = process.versions.node.split(".").map(Number); process.exit(a > 22 || (a === 22 && b >= 12) ? 0 : 1)' && node_ok=1
fi
[ "$node_ok" = 1 ] || fail "Node.js 22.12 or newer is needed (for example: brew install node)."
xcode-select -p >/dev/null 2>&1 || fail "Xcode's command-line tools are needed to build the memory reader. Run: xcode-select --install"

echo "== Python environment"
if [ ! -x "$venv/bin/python" ]; then
    "$python" -m venv "$venv" || fail "Creating the venv failed."
fi
"$venv/bin/python" -m pip install --upgrade pip --quiet
"$venv/bin/python" -m pip install -r "$backend/requirements.txt" --quiet || fail "pip install failed"

echo "== Memory reader"
# Built into the data folder on first use anyway; building now reports a problem here instead.
(cd "$backend" && "$venv/bin/python" -c 'from app.system.memory_macos import helper_path; print(helper_path())')

echo "== Frontend build"
cd "$frontend"
npm install --no-audit --no-fund || fail "npm install failed"
npm run build || fail "Frontend build failed"

echo "== Desktop shortcut"
# Its own name, so it and the installed "Divine Pulse.app" don't get mixed up. Opens Terminal, which shows the log.
shortcut="$HOME/Desktop/Divine Pulse (source).command"
mkdir -p "$HOME/Desktop"
printf '#!/bin/sh\nexec "%s/tools/launch.sh"\n' "$root" > "$shortcut"
chmod +x "$shortcut"
echo "$shortcut"

echo
echo "Done. Start Divine Pulse with 'Divine Pulse (source)' on your desktop, or tools/launch.sh."
echo "Closing the Divine Pulse window stops the app."
