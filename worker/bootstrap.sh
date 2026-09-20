#!/usr/bin/env bash
# Install and start the OpenBot worker on this Linux host.
# Idempotent. Prefers systemd --user, then tmux, then nohup.
set -euo pipefail

HOME_DIR="${HOME:-/tmp}"
WORKER_HOME="${OPENBOT_WORKER_HOME:-$HOME_DIR/.openbot-worker}"
PORT="${OPENBOT_WORKER_PORT:-3848}"
WORKSPACE="${OPENBOT_WORKSPACE:-$HOME_DIR/openbot-workspace}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${OPENBOT_PYTHON:-python3}"

mkdir -p "$WORKER_HOME" "$WORKSPACE"
chmod 700 "$WORKER_HOME"

if [[ ! -f "$SCRIPT_DIR/worker.py" ]]; then
  echo "worker.py missing next to bootstrap.sh" >&2
  exit 1
fi

cp "$SCRIPT_DIR/worker.py" "$WORKER_HOME/worker.py"
chmod 755 "$WORKER_HOME/worker.py"

if [[ ! -f "$WORKER_HOME/token" ]]; then
  # 64 hex chars; stays on the host, copied back to ~/.openbot on the laptop.
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -hex 32 > "$WORKER_HOME/token"
  else
    "$PYTHON" -c 'import uuid,sys; sys.stdout.write(uuid.uuid4().hex+uuid.uuid4().hex+"\n")' > "$WORKER_HOME/token"
  fi
  chmod 600 "$WORKER_HOME/token"
fi

if ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "python3 is required on the host" >&2
  exit 1
fi

export OPENBOT_WORKER_HOME="$WORKER_HOME"
export OPENBOT_WORKER_PORT="$PORT"
export OPENBOT_WORKSPACE="$WORKSPACE"
export OPENBOT_WORKER_TOKEN
OPENBOT_WORKER_TOKEN="$(tr -d '[:space:]' < "$WORKER_HOME/token")"

stop_old() {
  if [[ -f "$WORKER_HOME/worker.pid" ]]; then
    old_pid="$(cat "$WORKER_HOME/worker.pid" || true)"
    if [[ -n "${old_pid:-}" ]] && kill -0 "$old_pid" 2>/dev/null; then
      # Only kill if it looks like our worker.
      if ps -p "$old_pid" -o args= 2>/dev/null | grep -q "openbot-worker\|worker.py"; then
        kill "$old_pid" 2>/dev/null || true
        sleep 0.3
      fi
    fi
  fi
}

persist_method=""

try_systemd() {
  command -v systemctl >/dev/null 2>&1 || return 1
  systemctl --user status >/dev/null 2>&1 || return 1
  mkdir -p "$HOME_DIR/.config/systemd/user"
  cat > "$HOME_DIR/.config/systemd/user/openbot-worker.service" <<EOF
[Unit]
Description=OpenBot remote worker
After=default.target

[Service]
Type=simple
ExecStart=${PYTHON} ${WORKER_HOME}/worker.py
Restart=on-failure
RestartSec=2
Environment=OPENBOT_WORKER_HOME=${WORKER_HOME}
Environment=OPENBOT_WORKER_PORT=${PORT}
Environment=OPENBOT_WORKSPACE=${WORKSPACE}
WorkingDirectory=${WORKER_HOME}
StandardOutput=append:${WORKER_HOME}/worker.log
StandardError=append:${WORKER_HOME}/worker.log

[Install]
WantedBy=default.target
EOF
  systemctl --user daemon-reload
  systemctl --user enable --now openbot-worker.service
  # Linger keeps the user service after SSH logout / laptop disconnect.
  if command -v loginctl >/dev/null 2>&1; then
    loginctl enable-linger "$(id -un)" 2>/dev/null || true
  fi
  persist_method="systemd-user"
  return 0
}

try_tmux() {
  command -v tmux >/dev/null 2>&1 || return 1
  tmux has-session -t openbot-worker 2>/dev/null && tmux kill-session -t openbot-worker 2>/dev/null || true
  tmux new-session -d -s openbot-worker \
    "export OPENBOT_WORKER_HOME='$WORKER_HOME' OPENBOT_WORKER_PORT='$PORT' OPENBOT_WORKSPACE='$WORKSPACE'; exec $PYTHON $WORKER_HOME/worker.py"
  persist_method="tmux"
  return 0
}

try_nohup() {
  stop_old
  nohup "$PYTHON" "$WORKER_HOME/worker.py" >> "$WORKER_HOME/worker.log" 2>&1 &
  echo $! > "$WORKER_HOME/worker.pid"
  persist_method="nohup"
  return 0
}

if try_systemd; then
  :
elif try_tmux; then
  :
else
  try_nohup
fi

echo "$persist_method" > "$WORKER_HOME/persist_method"

ok=0
for _ in $(seq 1 40); do
  if "$PYTHON" - "$PORT" <<'PY' 2>/dev/null
import socket, sys
s = socket.socket()
s.settimeout(0.25)
try:
    s.connect(("127.0.0.1", int(sys.argv[1])))
    sys.exit(0)
except OSError:
    sys.exit(1)
finally:
    s.close()
PY
  then
    ok=1
    break
  fi
  sleep 0.15
done

if [[ "$ok" != 1 ]]; then
  echo "worker did not start on 127.0.0.1:${PORT}" >&2
  if [[ -f "$WORKER_HOME/worker.log" ]]; then
    tail -n 40 "$WORKER_HOME/worker.log" >&2 || true
  fi
  exit 1
fi

echo "OPENBOT_PERSIST=${persist_method}"
echo "OPENBOT_PORT=${PORT}"
echo "OPENBOT_WORKSPACE=${WORKSPACE}"
echo "OPENBOT_WORKER_HOME=${WORKER_HOME}"
echo "OPENBOT_TOKEN=${OPENBOT_WORKER_TOKEN}"
echo "OPENBOT_OK=1"
