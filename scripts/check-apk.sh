#!/usr/bin/env bash
# Refuse to publish an APK whose versionCode does not match the manifest.
#
# This exists because it happened: an APK built before pubspec was bumped
# was copied out as the new release, so the server asked for build 36 while
# the file installed as 35 — install, reopen, asked again, forever.
#
#   scripts/check-apk.sh public/downloads/odg-sale.apk
#   scripts/check-apk.sh public/downloads/odg-sale-beta.apk beta
#
# Compares against BUILD/VERSION (or BETA_BUILD/BETA_VERSION) in
# src/lib/app-release.ts.
set -euo pipefail

APK="${1:-public/downloads/odg-sale.apk}"
CHANNEL="${2:-stable}"
RELEASE="$(dirname "$0")/../src/lib/app-release.ts"

[ -f "$APK" ] || { echo "no APK at $APK"; exit 1; }

AAPT="$(ls ~/Library/Android/sdk/build-tools/*/aapt2 2>/dev/null | sort | tail -1 || true)"
[ -n "$AAPT" ] || { echo "aapt2 not found — cannot verify $APK"; exit 1; }

# `| head -1` here would SIGPIPE aapt2 under `set -o pipefail`.
BADGING="$("$AAPT" dump badging "$APK")"
BADGING="${BADGING%%$'\n'*}"
APK_CODE="$(sed -n "s/.*versionCode='\([0-9]*\)'.*/\1/p" <<< "$BADGING")"
APK_NAME="$(sed -n "s/.*versionName='\([^']*\)'.*/\1/p" <<< "$BADGING")"

if [ "$CHANNEL" = "beta" ]; then
  WANT_CODE="$(sed -n 's/^const BETA_BUILD = \([0-9]*\);/\1/p' "$RELEASE")"
  WANT_NAME="$(sed -n 's/^const BETA_VERSION = "\([^"]*\)";/\1/p' "$RELEASE")"
else
  WANT_CODE="$(sed -n 's/^const BUILD = \([0-9]*\);/\1/p' "$RELEASE")"
  WANT_NAME="$(sed -n 's/^const VERSION = "\([^"]*\)";/\1/p' "$RELEASE")"
fi

echo "apk:      $APK_NAME+$APK_CODE"
echo "manifest: $WANT_NAME+$WANT_CODE  ($CHANNEL)"

if [ "$APK_CODE" != "$WANT_CODE" ] || [ "$APK_NAME" != "$WANT_NAME" ]; then
  echo
  echo "MISMATCH — do not publish. The app would install as $APK_NAME+$APK_CODE"
  echo "and be told to update to $WANT_NAME+$WANT_CODE on every launch."
  echo "Rebuild after bumping pubspec.yaml, then run this again."
  exit 1
fi

echo "ok"
