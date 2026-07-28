#!/bin/bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_ICON="$ROOT_DIR/apps/desktop/resources/icon-source.svg"
OUTPUT_ICON="$ROOT_DIR/apps/desktop/resources/Actestra.icns"
ICON_TMP_DIR="$(mktemp -d)"
ICONSET_DIR="$ICON_TMP_DIR/Actestra.iconset"
MASTER_PNG="$ICON_TMP_DIR/Actestra-1024.png"

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
sips -s format png "$SOURCE_ICON" --out "$MASTER_PNG" >/dev/null

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
echo "Generated $OUTPUT_ICON"
