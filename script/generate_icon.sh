#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="$ROOT_DIR/apps/desktop/resources/icon-source.svg"
OUTPUT_ICON="$ROOT_DIR/apps/desktop/resources/Actestra.icns"
OUTPUT_PNG="$ROOT_DIR/apps/desktop/resources/Actestra.png"
OUTPUT_ICO="$ROOT_DIR/apps/desktop/resources/Actestra.ico"
OUTPUT_PWA_180="$ROOT_DIR/apps/desktop/resources/Actestra-180.png"
OUTPUT_PWA_192="$ROOT_DIR/apps/desktop/resources/Actestra-192.png"
OUTPUT_PWA_512="$ROOT_DIR/apps/desktop/resources/Actestra-512.png"
ICON_TMP_DIR="$(mktemp -d)"
ICONSET_DIR="$ICON_TMP_DIR/Actestra.iconset"
MASTER_PNG="$ICON_TMP_DIR/Actestra-1024.png"
WINDOWS_ICON_DIR="$ICON_TMP_DIR/windows"

case "$ICON_TMP_DIR" in
  /tmp/* | /var/folders/*)
    trap '/bin/rm -rf -- "$ICON_TMP_DIR"' EXIT
    ;;
  *)
    echo "Refusing to use unexpected temporary directory: $ICON_TMP_DIR" >&2
    exit 1
    ;;
esac

mkdir -p "$ICONSET_DIR"
mkdir -p "$WINDOWS_ICON_DIR"
sips -s format png "$SOURCE_ICON" --out "$MASTER_PNG" >/dev/null
cp "$MASTER_PNG" "$OUTPUT_PNG"

create_icon() {
  local pixels="$1"
  local filename="$2"
  sips -z "$pixels" "$pixels" "$MASTER_PNG" --out "$ICONSET_DIR/$filename" >/dev/null
}

create_icon 16 icon_16x16.png
create_icon 32 icon_16x16@2x.png
create_icon 32 icon_32x32.png
create_icon 64 icon_32x32@2x.png
create_icon 128 icon_128x128.png
create_icon 256 icon_128x128@2x.png
create_icon 256 icon_256x256.png
create_icon 512 icon_256x256@2x.png
create_icon 512 icon_512x512.png
create_icon 1024 icon_512x512@2x.png

iconutil -c icns "$ICONSET_DIR" -o "$OUTPUT_ICON"

create_windows_icon() {
  local pixels="$1"
  sips -z "$pixels" "$pixels" "$MASTER_PNG" --out "$WINDOWS_ICON_DIR/icon-${pixels}.png" >/dev/null
}

create_windows_icon 16
create_windows_icon 24
create_windows_icon 32
create_windows_icon 48
create_windows_icon 64
create_windows_icon 128
create_windows_icon 256

node "$ROOT_DIR/script/generate_windows_icon.mjs" \
  "$OUTPUT_ICO" \
  "$WINDOWS_ICON_DIR/icon-16.png" \
  "$WINDOWS_ICON_DIR/icon-24.png" \
  "$WINDOWS_ICON_DIR/icon-32.png" \
  "$WINDOWS_ICON_DIR/icon-48.png" \
  "$WINDOWS_ICON_DIR/icon-64.png" \
  "$WINDOWS_ICON_DIR/icon-128.png" \
  "$WINDOWS_ICON_DIR/icon-256.png"

sips -z 180 180 "$MASTER_PNG" --out "$OUTPUT_PWA_180" >/dev/null
sips -z 192 192 "$MASTER_PNG" --out "$OUTPUT_PWA_192" >/dev/null
sips -z 512 512 "$MASTER_PNG" --out "$OUTPUT_PWA_512" >/dev/null

echo "Generated Actestra desktop and PWA icon assets"
