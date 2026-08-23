#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS=()

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "${PIDS[@]:-}"; do
    wait "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

load_env() {
  if [[ -f "$ROOT_DIR/server/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/server/.env"
    set +a
  elif [[ -f "$ROOT_DIR/.env" ]]; then
    set -a
    # shellcheck disable=SC1091
    source "$ROOT_DIR/.env"
    set +a
  fi
}

has_mezon_env() {
  [[ -n "${MEZON_BOT_ID:-}" && -n "${MEZON_BOT_TOKEN:-}" && -n "${MEZON_CHANNEL_ID:-}" && -n "${MEZON_ADMIN_USER_ID:-}" ]]
}

start_process() {
  local name="$1"
  shift
  echo "-- starting $name"
  "$@" &
  PIDS+=("$!")
}

cd "$ROOT_DIR"
./scripts/setup-local-postgres.sh
load_env

start_process "browser-bridge server" ./scripts/run-server.sh

if [[ "${RUN_MEDIA_WORKER:-true}" == "true" ]]; then
  start_process "media worker" ./scripts/run-media-worker.sh
else
  echo "-- media worker skipped (RUN_MEDIA_WORKER=false)"
fi

if has_mezon_env; then
  start_process "mezon bot" ./scripts/run-bot.sh
else
  echo "-- mezon bot skipped (missing MEZON_BOT_ID/MEZON_BOT_TOKEN/MEZON_CHANNEL_ID/MEZON_ADMIN_USER_ID)"
fi

echo "-- stack running; press Ctrl+C to stop"
while :; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" || true
      exit 1
    fi
  done
  sleep 2
done
