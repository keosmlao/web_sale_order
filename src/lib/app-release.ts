// The Android build currently published at /downloads/odg-sale.apk.
//
// `minBuildNumber` is the floor the app enforces on itself: anything older
// is refused entry and sent to the download page. Raise it only when an
// older build would genuinely misbehave against today's server — a changed
// API contract, a fix that must not be skipped. Cosmetic releases should
// leave it alone, because raising it locks every tablet out of selling
// until someone walks over and updates it.
//
// Keep `buildNumber` in step with pubspec.yaml's `version: x.y.z+build`
// whenever an APK is published.
export const APP_RELEASE = {
  version: "1.0.1",
  buildNumber: 2,
  minBuildNumber: 2,
  downloadUrl: "/downloads/odg-sale.apk",
  notes: "POS ແບບ tablet: ສິນຄ້າຢູ່ໜ້າຈໍຕະຫຼອດ, ກະຕ່າຢູ່ຂວາ",
} as const;
