import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentEmployee } from "@/lib/auth";
import { lineLoginConfigured } from "@/lib/line";
import LoginForm from "./LoginForm";

export const dynamic = "force-dynamic";

async function signedInPath(employeeCode: string | null): Promise<string> {
  if (!employeeCode) return "/";
  const rows = await prisma.$queryRaw<Array<{ app_role: string | null }>>`
    SELECT app_role
    FROM app_employee_access
    WHERE employee_code = ${employeeCode}
      AND is_active = true
    LIMIT 1
  `;
  const explicitRole = rows[0]?.app_role?.trim().toLowerCase();
  return explicitRole === "pc" || explicitRole === "salesperson" ? "/orders/new" : "/";
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams?: Promise<{ line?: string }>;
}) {
  const employee = await getCurrentEmployee();
  if (employee) redirect(await signedInPath(employee.employeeCode));

  const year = new Date().getFullYear();
  // Arriving from an unlinked LINE sign-in: one normal login links it.
  const lineLinkNotice = (await searchParams)?.line === "link";

  return (
    <div className="login-shell">
      {/* Brand panel — left side, gradient + marketing */}
      <aside className="login-brand">
        <div className="login-brand-bg" aria-hidden />
        <div className="login-brand-inner">
          <div className="login-brand-mark">
            <div className="login-brand-logo"><img src="/odm.png" alt="ODIEN Mall" /></div>
            <div>
              <div className="login-brand-name">ODG ຂາຍ</div>
              <div className="login-brand-tag">Sales Management System</div>
            </div>
          </div>

          <div className="login-brand-hero">
            <h1>ຍິນດີຕ້ອນຮັບ</h1>
            <p>ລະບົບຈັດການການຂາຍ ສຳລັບພະນັກງານ ODG — ຮັບອໍເດີ້, ຄິດເງິນ, ກວດເບິ່ງສິນຄ້າ ແລະ ລາຍງານທັງໝົດໃນທີ່ດຽວ.</p>
          </div>

          <ul className="login-brand-features">
            <li>
              <span className="login-feature-dot" aria-hidden>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <strong>ຮັບອໍເດີ້ໄວ</strong>
                <small>ສ້າງອໍເດີ້ ແລະ ສະແກນບາໂຄດໃນຄຣິກດຽວ</small>
              </div>
            </li>
            <li>
              <span className="login-feature-dot" aria-hidden>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <strong>ຄຸ້ມຄອງສິນຄ້າຄົງເຫຼືອ</strong>
                <small>ເບິ່ງສະຕັອກ ແລະ ລາຄາແບບ real-time</small>
              </div>
            </li>
            <li>
              <span className="login-feature-dot" aria-hidden>
                <svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </span>
              <div>
                <strong>ລາຍງານຂາຍ</strong>
                <small>ສະຫຼຸບຍອດຂາຍ ແລະ KPI ປະຈຳວັນ</small>
              </div>
            </li>
          </ul>

          <div className="login-brand-foot">© {year} ODIEN Group</div>
        </div>
      </aside>

      {/* Form panel — right side */}
      <main className="login-panel">
        <div className="login-panel-inner">
          <div className="login-mobile-brand">
            <div className="login-brand-logo"><img src="/odm.png" alt="ODIEN Mall" /></div>
            <div>
              <div className="login-brand-name">ODG ຂາຍ</div>
              <div className="login-brand-tag">Sales Management</div>
            </div>
          </div>

          <div className="login-form-head">
            <h2>ເຂົ້າສູ່ລະບົບ</h2>
            <p>ກະລຸນາໃສ່ລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານຂອງທ່ານ</p>
          </div>

          {lineLinkNotice ? (
            <div className="mb-3 flex items-center gap-2 rounded-lg border border-[#06C755]/30 bg-[#06C755]/10 px-3 py-2.5 text-xs font-bold text-emerald-800">
              <svg viewBox="0 0 24 24" width="16" height="16" fill="#06C755" aria-hidden className="shrink-0">
                <path d="M12 2C6.48 2 2 5.64 2 10.13c0 4.03 3.58 7.4 8.41 8.04.33.07.77.22.89.5.1.26.07.66.03.92l-.14.86c-.04.26-.2 1.02.89.56 1.1-.46 5.93-3.49 8.09-5.98C21.75 13.31 22 11.78 22 10.13 22 5.64 17.52 2 12 2Z" />
              </svg>
              ເຂົ້າລະບົບຄັ້ງນີ້ຄັ້ງດຽວ — ລະບົບຈະຜູກບັນຊີ LINE ໃຫ້ອັດຕະໂນມັດ, ຄັ້ງຕໍ່ໄປກົດ LINE ເຂົ້າໄດ້ເລີຍ
            </div>
          ) : null}

          <LoginForm />

          {lineLoginConfigured() ? (
            <>
              <div className="my-4 flex items-center gap-3 text-[11px] font-bold text-odoo-text-muted">
                <span className="h-px flex-1 bg-odoo-border" /> ຫຼື{" "}
                <span className="h-px flex-1 bg-odoo-border" />
              </div>
              <a
                href="/api/auth/line/start"
                className="flex items-center justify-center gap-2 rounded-lg bg-[#06C755] px-4 py-2.5 text-sm font-bold text-white transition hover:brightness-105"
              >
                <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
                  <path d="M12 2C6.48 2 2 5.64 2 10.13c0 4.03 3.58 7.4 8.41 8.04.33.07.77.22.89.5.1.26.07.66.03.92l-.14.86c-.04.26-.2 1.02.89.56 1.1-.46 5.93-3.49 8.09-5.98C21.75 13.31 22 11.78 22 10.13 22 5.64 17.52 2 12 2Z" />
                </svg>
                ເຂົ້າສູ່ລະບົບດ້ວຍ LINE
              </a>
            </>
          ) : null}

          <a
            href="/download"
            className="mt-4 flex items-center justify-center gap-2 rounded-lg border border-odoo-border bg-odoo-surface-muted px-4 py-2.5 text-sm font-bold text-odoo-text-strong transition hover:border-odoo-primary hover:bg-odoo-primary-50"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="7" y="2" width="10" height="20" rx="2" />
              <path d="M11 18h2" />
            </svg>
            ດາວໂຫລດແອັບມືຖື (Android)
          </a>

          <div className="login-foot-help">
            ມີບັນຫາການເຂົ້າລະບົບ? ຕິດຕໍ່ <strong>ຝ່າຍ IT</strong>
          </div>
        </div>
      </main>
    </div>
  );
}
