#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_BUNDLE="$ROOT_DIR/release/mac-arm64/Actestra.app"
RUN_ROOT=""
STAGED_APP_BUNDLE=""
STAGED_APP_EXECUTABLE=""
RUN_PROFILE=""
MODE="${1:---run}"

build_app() {
  cd "$ROOT_DIR"
  bun run package
  bun run dist:dir
  bun run verify:package
}

prepare_run_root() {
  local requested_root="${TMPDIR:-/tmp}"
  local temporary_root
  if ! temporary_root="$(cd -- "$requested_root" && pwd -P)"; then
    echo "Refusing to stage from an invalid temporary directory: $requested_root" >&2
    exit 1
  fi

  case "$temporary_root" in
    /tmp | /tmp/* | /private/tmp | /private/tmp/* | /var/folders/* | /private/var/folders/*)
      ;;
    *)
      echo "Refusing to stage outside a temporary directory: $temporary_root" >&2
      exit 1
      ;;
  esac

  RUN_ROOT="$(mktemp -d "${temporary_root%/}/actestra-codex-run.XXXXXX")"
  STAGED_APP_BUNDLE="$RUN_ROOT/Actestra.app"
  STAGED_APP_EXECUTABLE="$STAGED_APP_BUNDLE/Contents/MacOS/Actestra"
  RUN_PROFILE="$RUN_ROOT/profile"
}

stage_app() {
  prepare_run_root
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
    stage_app
    launch_bundle
    ;;
  --debug)
    build_app
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
