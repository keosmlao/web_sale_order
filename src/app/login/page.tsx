import { redirect } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { getCurrentEmployee } from "@/lib/auth";
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

export default async function LoginPage() {
  const employee = await getCurrentEmployee();
  if (employee) redirect(await signedInPath(employee.employeeCode));

  const year = new Date().getFullYear();

  return (
    <div className="login-shell">
      {/* Brand panel — left side, gradient + marketing */}
      <aside className="login-brand">
        <div className="login-brand-bg" aria-hidden />
        <div className="login-brand-inner">
          <div className="login-brand-mark">
            <div className="login-brand-logo">O</div>
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
              <span className="login-feature-dot" aria-hidden>✓</span>
              <div>
                <strong>ຮັບອໍເດີ້ໄວ</strong>
                <small>ສ້າງອໍເດີ້ ແລະ ສະແກນບາໂຄດໃນຄຣິກດຽວ</small>
              </div>
            </li>
            <li>
              <span className="login-feature-dot" aria-hidden>✓</span>
              <div>
                <strong>ຄຸ້ມຄອງສິນຄ້າຄົງເຫຼືອ</strong>
                <small>ເບິ່ງສະຕັອກ ແລະ ລາຄາແບບ real-time</small>
              </div>
            </li>
            <li>
              <span className="login-feature-dot" aria-hidden>✓</span>
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
            <div className="login-brand-logo">O</div>
            <div>
              <div className="login-brand-name">ODG ຂາຍ</div>
              <div className="login-brand-tag">Sales Management</div>
            </div>
          </div>

          <div className="login-form-head">
            <h2>ເຂົ້າສູ່ລະບົບ</h2>
            <p>ກະລຸນາໃສ່ລະຫັດພະນັກງານ ແລະ ລະຫັດຜ່ານຂອງທ່ານ</p>
          </div>

          <LoginForm />

          <div className="login-foot-help">
            ມີບັນຫາການເຂົ້າລະບົບ? ຕິດຕໍ່ <strong>ຝ່າຍ IT</strong>
          </div>
        </div>
      </main>
    </div>
  );
}
