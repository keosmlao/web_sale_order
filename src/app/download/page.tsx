import Link from "next/link";
import QRCode from "qrcode";
import fs from "node:fs";
import path from "node:path";

export const dynamic = "force-dynamic";

// Public base URL the QR encodes — must be the real domain a phone can reach,
// not the server's localhost. Override per-environment with APP_PUBLIC_URL.
const PUBLIC_BASE_URL = (
  process.env.APP_PUBLIC_URL || "https://klpos.odienmall.com"
).replace(/\/+$/, "");

// Public download page for the Android sales app — reachable without login so
// a new salesperson can install before their first sign-in. The APK lives in
// public/downloads/odg-sale.apk; we stat it here to show its size + build date
// (and to hide the button gracefully if it hasn't been published yet).
function apkInfo(): { exists: boolean; sizeMb: string; builtAt: string | null } {
  try {
    const p = path.join(process.cwd(), "public", "downloads", "odg-sale.apk");
    const st = fs.statSync(p);
    return {
      exists: true,
      sizeMb: (st.size / (1024 * 1024)).toFixed(1),
      builtAt: st.mtime.toISOString().slice(0, 10),
    };
  } catch {
    return { exists: false, sizeMb: "0", builtAt: null };
  }
}

const STEPS = [
  "ກົດປຸ່ມ “ດາວໂຫລດ” ດ້ານລຸ່ມ ເພື່ອໂຫລດໄຟລ໌ .apk",
  "ເປີດໄຟລ໌ທີ່ໂຫລດແລ້ວ — ຖ້າມືຖືແຈ້ງເຕືອນ ໃຫ້ອະນຸຍາດ “ຕິດຕັ້ງຈາກແຫຼ່ງທີ່ບໍ່ຮູ້ຈັກ”",
  "ກົດ “ຕິດຕັ້ງ” ແລ້ວລໍຖ້າຈົນສຳເລັດ",
  "ເປີດແອັບ ODG ຂາຍ ແລ້ວເຂົ້າສູ່ລະບົບດ້ວຍລະຫັດພະນັກງານ",
];

export default async function DownloadPage() {
  const apk = apkInfo();
  const url = `${PUBLIC_BASE_URL}/download`;
  // Encode the download page URL as an SVG QR so a phone can scan it straight
  // off a desktop screen. Generated server-side — no external QR service.
  const qrSvg = await QRCode.toString(url, {
    type: "svg",
    margin: 1,
    width: 160,
    color: { dark: "#1f2937", light: "#ffffff" },
  });
  return (
    <div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 px-4 py-10 text-white">
      <div className="w-full max-w-md overflow-hidden rounded-2xl bg-white text-odoo-text shadow-2xl">
        <div className="flex items-center gap-3 bg-odoo-primary px-6 py-5 text-white">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15">
            <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="2" width="10" height="20" rx="2" />
              <path d="M11 18h2" />
            </svg>
          </div>
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-white/70">
              Android App
            </div>
            <h1 className="text-xl font-black leading-tight">ODG ຂາຍ — ແອັບມືຖື</h1>
          </div>
        </div>

        <div className="px-6 py-5">
          <p className="text-sm text-odoo-text-muted">
            ແອັບສຳລັບພະນັກງານຂາຍ ODG — ຮັບອໍເດີ້, ສະແກນບາໂຄດ, ກວດສິນຄ້າຄົງເຫຼືອ ແລະ ເບິ່ງລາຍງານ.
          </p>

          {apk.exists ? (
            <>
              <a
                href="/downloads/odg-sale.apk"
                download
                className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-odoo-primary px-4 py-3 text-base font-black text-white transition hover:brightness-110 active:scale-[0.99]"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                  <polyline points="7 10 12 15 17 10" />
                  <line x1="12" y1="15" x2="12" y2="3" />
                </svg>
                ດາວໂຫລດ (.apk · {apk.sizeMb} MB)
              </a>
              <div className="mt-1.5 text-center text-[11px] text-odoo-text-muted">
                ສຳລັບ Android ເທົ່ານັ້ນ{apk.builtAt ? ` · ອັບເດດ ${apk.builtAt}` : ""}
              </div>
            </>
          ) : (
            <div className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-800">
              ໄຟລ໌ຕິດຕັ້ງຍັງບໍ່ພ້ອມ — ກະລຸນາຕິດຕໍ່ຝ່າຍ IT
            </div>
          )}

          <div className="mt-6 flex flex-col items-center gap-2 rounded-xl border border-odoo-border bg-odoo-surface-muted px-4 py-4">
            <div className="text-xs font-bold text-odoo-text-muted">
              ສະແກນ QR ດ້ວຍມືຖື ເພື່ອເປີດໜ້ານີ້
            </div>
            <div
              className="rounded-lg bg-white p-2 shadow-sm [&>svg]:h-40 [&>svg]:w-40"
              dangerouslySetInnerHTML={{ __html: qrSvg }}
            />
            <div className="break-all text-center font-mono text-[10px] text-odoo-text-muted">
              {url}
            </div>
          </div>

          <div className="mt-6">
            <div className="text-xs font-black uppercase tracking-wide text-odoo-text-muted">
              ວິທີຕິດຕັ້ງ
            </div>
            <ol className="mt-2 space-y-2">
              {STEPS.map((step, i) => (
                <li key={i} className="flex gap-2.5 text-[13px] leading-5 text-odoo-text">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-odoo-primary text-[11px] font-black text-white">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
          </div>

          <Link
            href="/login"
            className="mt-6 block text-center text-sm font-semibold text-odoo-primary hover:underline"
          >
            ← ກັບໄປໜ້າເຂົ້າສູ່ລະບົບ
          </Link>
        </div>
      </div>
    </div>
  );
}
