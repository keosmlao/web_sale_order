// The Android build currently published at /downloads/odg-sale.apk.
//
// Every release is mandatory. The shop's tablets are updated by someone
// walking over to them, so an old build will otherwise sit there selling
// for months against a server that has moved on — which is how a cart gets
// priced by rules the bill no longer agrees with. Rather than deciding
// case by case whether a given change is "important enough" to force,
// minBuildNumber is pinned to the published build: install the new APK, or
// the app stops at the update screen.
//
// So a release is exactly two edits, and they must agree:
//   1. pubspec.yaml   version: x.y.z+BUILD
//   2. BUILD below, plus VERSION and the note
// Then rebuild the APK and copy it to public/downloads/odg-sale.apk.
const VERSION = "2.1.0";
const BUILD = 34;

export const APP_RELEASE = {
  version: VERSION,
  buildNumber: BUILD,
  // Not a separate decision — the published build IS the floor.
  minBuildNumber: BUILD,
  downloadUrl: "/downloads/odg-sale.apk",
  notes: "ແບ່ງສາງ = 2 ແຖວໃນກະຕ່າ ຄືເວັບ — ແຕ່ລະແຖວມີ stepper ຂອງມັນ",
} as const;
