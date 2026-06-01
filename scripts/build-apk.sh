#!/usr/bin/env bash
# Build the Android release APK from the Flutter app and publish it to the
# web's public/downloads so the /download page (and its QR) always serves the
# latest build. Run from the web project: `npm run build:apk`.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
WEB_DIR="$(cd "$SCRIPT_DIR/.." && pwd)"
APP_DIR="$(cd "$WEB_DIR/../app_sale_order" && pwd)"
SRC="$APP_DIR/build/app/outputs/flutter-apk/app-release.apk"
DEST_DIR="$WEB_DIR/public/downloads"
DEST="$DEST_DIR/odg-sale.apk"

if ! command -v flutter >/dev/null 2>&1; then
  echo "✗ flutter not found on PATH" >&2
  exit 1
fi

echo "▶ Building release APK in $APP_DIR ..."
( cd "$APP_DIR" && flutter build apk --release )

if [ ! -f "$SRC" ]; then
  echo "✗ Expected APK not found at $SRC" >&2
  exit 1
fi

mkdir -p "$DEST_DIR"
cp "$SRC" "$DEST"
echo "✓ Published $DEST ($(du -h "$DEST" | cut -f1))"
