#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PLATFORM="${SOCIAL_MEDIA_PLATFORM:-all}"

case "$PLATFORM" in
  all|tiktok|instagram) ;;
  *)
    echo "SOCIAL_MEDIA_PLATFORM must be all, tiktok, or instagram" >&2
    exit 2
    ;;
esac

run_worker_once() {
  local platform="$1"
  echo "-- running media worker once for $platform"
  (
    cd "$ROOT_DIR/bot"
    SOCIAL_MEDIA_WORKER_RUN_ONCE=true SOCIAL_MEDIA_PLATFORM="$platform" npm run worker
  )
}

cd "$ROOT_DIR"

echo "-- exporting social following for $PLATFORM"
node tools/export_social_following.mjs --platform "$PLATFORM"

if [[ "$PLATFORM" == "all" ]]; then
  run_worker_once "tiktok"
  run_worker_once "instagram"
else
  run_worker_once "$PLATFORM"
fi
