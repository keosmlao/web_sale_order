// The two Android channels.
//
// STABLE is what the shop runs. Every stable release is mandatory: the
// tablets are updated by someone walking over to them, so an old build
// otherwise sits there selling for months against a server that has moved
// on — which is how a cart gets priced by rules the bill no longer agrees
// with. minBuildNumber is pinned to the published build rather than
// decided case by case: install the new APK, or the app stops at the
// update screen.
//
// That is exactly why BETA exists. A forced channel must not also be the
// channel work lands on — publish twice in an afternoon and whoever is
// selling spends the afternoon installing. Changes go to beta, get tried
// on one device, and only then move to stable.
//
// Promotion copies bytes, it does not rebuild: the APK the tester
// approved is the APK the shop gets, same build number, same file.
//
//   beta      → bump BETA_BUILD, build, copy to odg-sale-beta.apk
//   promote   → set BUILD/VERSION to the beta's, copy that same file
//               to odg-sale.apk
//
// pubspec.yaml's `version: x.y.z+build` must match whichever channel the
// APK was built for.

const VERSION = "3.3.0";
const BUILD = 39;

export const APP_RELEASE = {
  version: VERSION,
  buildNumber: BUILD,
  // Not a separate decision — the published build IS the floor.
  minBuildNumber: BUILD,
  downloadUrl: "/downloads/odg-sale.apk",
  notes: "ຂາຍຫຼາຍສາງ · ແກ້ໄຂ/ລົບບິນ · stock ຫັກ order ແລ້ວ · ໜ້າຕາໃໝ່",
} as const;

const BETA_VERSION = "3.4.0";
const BETA_BUILD = 40;

export const APP_BETA = {
  version: BETA_VERSION,
  buildNumber: BETA_BUILD,
  // A beta never forces anything. Its floor is the stable floor, so a
  // tester who wants out just installs stable — and a beta that falls
  // behind stable is pulled forward like any other old build.
  minBuildNumber: BUILD,
  downloadUrl: "/downloads/odg-sale-beta.apk",
  notes: "ໜ້າເລືອກລູກຄ້າເຕັມຈໍ ພ້ອມເງົາຄອບ",
  // Set when beta is ahead of stable and there is something to try.
  isAhead: BETA_BUILD > BUILD,
} as const;
