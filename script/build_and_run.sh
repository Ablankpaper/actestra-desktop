#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/release/mac-arm64/Actestra.app"
RUN_ROOT="${TMPDIR:-/tmp}/actestra-codex-run"
STAGED_APP_BUNDLE="$RUN_ROOT/Actestra.app"
STAGED_APP_EXECUTABLE="$STAGED_APP_BUNDLE/Contents/MacOS/Actestra"
RUN_PROFILE="$RUN_ROOT/profile"
MODE="${1:---run}"

build_app() {
  cd "$ROOT_DIR"
  bun run package
  bun run dist:dir
  bun run verify:package
}

stop_existing() {
  pkill -x Actestra 2>/dev/null || true
}

stage_app() {
  case "$RUN_ROOT" in
    /tmp/* | /var/folders/*)
      ;;
    *)
      echo "Refusing to stage outside a temporary directory: $RUN_ROOT" >&2
      exit 1
      ;;
  esac

  mkdir -p "$RUN_ROOT"
  /bin/rm -rf -- "$STAGED_APP_BUNDLE"
  /usr/bin/ditto "$APP_BUNDLE" "$STAGED_APP_BUNDLE"
}

launch_bundle() {
  mkdir -p "$RUN_PROFILE"
  (
    cd "$RUN_ROOT"
    open -n "$STAGED_APP_BUNDLE" --env "ACTESTRA_USER_DATA_DIR=$RUN_PROFILE"
  )
}

case "$MODE" in
  --run)
    build_app
    stop_existing
    stage_app
    launch_bundle
    ;;
  --debug)
    build_app
    stop_existing
    stage_app
    mkdir -p "$RUN_PROFILE"
    (
      cd "$RUN_ROOT"
      ACTESTRA_USER_DATA_DIR="$RUN_PROFILE" lldb "$STAGED_APP_EXECUTABLE"
    )
    ;;
  --logs)
    open -a Console
    /usr/bin/log stream --style compact --predicate 'process == "Actestra"'
    ;;
  --telemetry)
    open -a "Instruments"
    /usr/bin/log stream --style compact --predicate 'process == "Actestra"'
    ;;
  --verify)
    build_app
    bun run smoke:package
    ;;
  *)
    echo "Usage: $0 [--run|--debug|--logs|--telemetry|--verify]" >&2
    exit 64
    ;;
esac
