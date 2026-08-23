#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SERVER_PID=""

cleanup() {
  if [[ -n "$SERVER_PID" ]]; then
    kill "$SERVER_PID" >/dev/null 2>&1 || true
    wait "$SERVER_PID" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

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

ensure_server_running() {
  if curl -fsS "${BROWSER_BRIDGE_HTTP_URL:-http://127.0.0.1:8788}/healthz" >/dev/null 2>&1; then
    return
  fi
  if [[ -n "$SERVER_PID" ]]; then
    return
  fi
  echo "-- Starting temporary BrowserBridge server"
  ./scripts/run-server.sh &
  SERVER_PID="$!"
  for _ in $(seq 1 20); do
    if curl -fsS "${BROWSER_BRIDGE_HTTP_URL:-http://127.0.0.1:8788}/healthz" >/dev/null 2>&1; then
      return
    fi
    sleep 1
  done
}

cd "$ROOT_DIR"

echo "== BrowserBridge doctor =="

echo "-- PostgreSQL setup/migrate"
./scripts/setup-local-postgres.sh
load_env

echo "-- Bot DB flow verifier"
node tools/verify_bot_db_flow.mjs

echo "-- Media worker DB flow verifier"
node tools/verify_worker_db_flow.mjs

echo "-- Social user import verifier"
node tools/verify_social_user_import.mjs

echo "-- One-shot social export + worker verifier"
node tools/verify_social_once_flow.mjs

echo "-- Live readiness reporting verifier"
node tools/verify_live_readiness_reporting.mjs

echo "-- Extension package verifier"
node tools/verify_extension_package.mjs

if [[ "${SKIP_DRIVE_UPLOAD:-false}" != "true" ]]; then
  ensure_server_running
  echo "-- Drive upload + media_assets verifier"
  node tools/verify_drive_upload_flow.mjs
else
  echo "-- Drive upload verifier skipped"
fi

echo "-- Pipeline readiness verifier"
ensure_server_running
if node tools/verify_social_pipeline.mjs; then
  echo "doctor: ready"
else
  echo "doctor: readiness verifier reported remaining setup gaps"
fi
