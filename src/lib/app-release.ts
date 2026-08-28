// The Android release the shop runs.
//
// Every release is mandatory: the tablets are updated by someone walking
// over to them, so an old build otherwise sits there selling for months
// against a server that has moved on — which is how a cart gets priced by
// rules the bill no longer agrees with. minBuildNumber is pinned to the
// published build rather than decided case by case: install the new APK,
// or the app stops at the update screen.
//
// Because it is mandatory, publish deliberately: two releases in an
// afternoon is an afternoon of installing for whoever is selling. Batch
// changes, and check the APK before it goes out —
//
//   scripts/check-apk.sh public/downloads/odg-sale.apk
//
// pubspec.yaml's `version: x.y.z+build` must match what is set here, or
// the app installs as one build and is told to update to another, forever.
//
// There was a second, non-forcing "beta" channel here for trying a build
// on one device first (git history, up to 3.5.2+45). It is gone because it
// stopped being used, not because it was wrong — bring it back if
// releasing straight to the shop starts to sting.

const VERSION = "3.5.8";
const BUILD = 51;

export const APP_RELEASE = {
  version: VERSION,
  buildNumber: BUILD,
  // Not a separate decision — the published build IS the floor.
  minBuildNumber: BUILD,
  downloadUrl: "/downloads/odg-sale.apk",
  notes: "ໜ້າຕາລາຍການບິນໃໝ່ · ຕ້ອງເລືອກລູກຄ້າກ່ອນຈຶ່ງເພີ່ມສິນຄ້າ · ກະຕ່າວ່າງແລ້ວກັບໜ້າຮ້ານ",
} as const;
