#!/bin/bash
# Frankston Reports — Mac launcher. Double-click to run.
# First run sets everything up (takes a few minutes); after that it starts in seconds.
# Close this Terminal window (or press Ctrl+C) to stop the app.

BACKEND_PORT=8020
FRONTEND_PORT=5190

cd "$(dirname "$0")" || exit 1
ROOT="$(pwd)"

# Make Homebrew / nvm installs visible when launched from Finder
export PATH="/opt/homebrew/bin:/usr/local/bin:$HOME/.homebrew/bin:$PATH"
[ -s "$HOME/.nvm/nvm.sh" ] && . "$HOME/.nvm/nvm.sh" >/dev/null 2>&1

fail() { echo; echo "ERROR: $1"; echo; read -r -p "Press Enter to close..."; exit 1; }

# ---- Python ----
PY=""
for c in python3.13 python3.12 python3.11 python3.14 python3; do
  if command -v "$c" >/dev/null 2>&1; then PY="$(command -v "$c")"; break; fi
done
[ -z "$PY" ] && fail "Python 3 not found. Install it with:  brew install python@3.13"
command -v npm >/dev/null 2>&1 || fail "Node.js (npm) not found. Install it with:  brew install node"

# ---- Ports ----
for p in $BACKEND_PORT $FRONTEND_PORT; do
  if lsof -nP -iTCP:$p -sTCP:LISTEN >/dev/null 2>&1; then
    fail "Port $p is already in use (is Frankston Reports already running in another window?)"
  fi
done

# ---- Backend setup (Mac venv kept separate from the Windows .venv) ----
VENV="$ROOT/backend/.venv-mac"
if [ ! -x "$VENV/bin/python" ] || [ "$ROOT/backend/requirements.txt" -nt "$VENV/.installed" ]; then
  echo "Setting up Python environment using $PY ..."
  [ -x "$VENV/bin/python" ] || "$PY" -m venv "$VENV" || fail "Could not create Python venv"
  "$VENV/bin/python" -m pip install --upgrade pip -q
  "$VENV/bin/python" -m pip install -r "$ROOT/backend/requirements.txt" || fail "pip install failed"
  touch "$VENV/.installed"
fi

# ---- Frontend setup (node_modules came from Windows; reinstall for Mac) ----
cd "$ROOT/frontend" || exit 1
if ! ls node_modules/@esbuild 2>/dev/null | grep -q darwin; then
  echo "Installing frontend packages for macOS ..."
  rm -rf node_modules
  npm install || fail "npm install failed"
fi

# ---- Run ----
cd "$ROOT/backend" || exit 1
"$VENV/bin/python" -m uvicorn app.main:app --reload --port $BACKEND_PORT &
BACKEND_PID=$!
trap 'echo; echo "Stopping..."; kill $BACKEND_PID 2>/dev/null; exit 0' INT TERM EXIT

cd "$ROOT/frontend" || exit 1
echo
echo "Frankston Reports running at http://localhost:$FRONTEND_PORT  (backend on $BACKEND_PORT)"
echo "Close this window or press Ctrl+C to stop."
echo
VITE_API_URL="http://localhost:$BACKEND_PORT" npx vite --port $FRONTEND_PORT --strictPort --open
