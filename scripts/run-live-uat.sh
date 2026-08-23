#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PIDS=()
WAIT_SECONDS="${WAIT_SECONDS:-300}"
WAIT_INTERVAL_SECONDS="${WAIT_INTERVAL_SECONDS:-5}"
SERVER_STARTUP_GRACE_SECONDS="${SERVER_STARTUP_GRACE_SECONDS:-1}"
RUN_MEDIA_WORKER="${RUN_MEDIA_WORKER:-true}"
RUN_MEZON_BOT="${RUN_MEZON_BOT:-true}"

cleanup() {
  for pid in "${PIDS[@]:-}"; do
    kill "$pid" >/dev/null 2>&1 || true
  done
  for pid in "${PIDS[@]:-}"; do
    wait "$pid" >/dev/null 2>&1 || true
  done
}
trap cleanup EXIT INT TERM

start_process() {
  local name="$1"
  shift
  echo "-- starting $name"
  "$@" &
  PIDS+=("$!")
}

cd "$ROOT_DIR"
./scripts/setup-local-postgres.sh

start_process "browser-bridge server" ./scripts/run-server.sh
sleep "$SERVER_STARTUP_GRACE_SECONDS"

echo "-- waiting for live readiness"
echo "-- connect Chrome extension to ws://127.0.0.1:8788/v1/extension while this waits"
./scripts/wait-live-ready.sh --wait-seconds "$WAIT_SECONDS" --interval-seconds "$WAIT_INTERVAL_SECONDS"

if [[ "$RUN_MEDIA_WORKER" == "true" ]]; then
  start_process "media worker" ./scripts/run-media-worker.sh
else
  echo "-- media worker skipped (RUN_MEDIA_WORKER=false)"
fi

if [[ "$RUN_MEZON_BOT" == "true" ]]; then
  start_process "mezon bot" ./scripts/run-bot.sh
else
  echo "-- mezon bot skipped (RUN_MEZON_BOT=false)"
fi

echo "-- live UAT stack running; press Ctrl+C to stop"
while :; do
  for pid in "${PIDS[@]}"; do
    if ! kill -0 "$pid" >/dev/null 2>&1; then
      wait "$pid" || true
      exit 1
    fi
  done
  sleep 2
done
