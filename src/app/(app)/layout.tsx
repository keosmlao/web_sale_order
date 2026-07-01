import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import { getHiddenMenuKeys } from "@/lib/menu-visibility";
import Sidebar from "@/components/Sidebar";
import BottomNav from "@/components/BottomNav";
import OrderNotifier from "@/components/OrderNotifier";
import { logoutAction } from "@/app/login/actions";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const employee = await requireEmployee();
  const role = roleFromEmployee(employee);
  const pathname = (await headers()).get("x-pathname") ?? "";
  // POS-only restriction kicks in *only* when the user has an explicit
  // app_role of 'pc' or 'salesperson' in app_employee_access (the access
  // table sets employee.appRole during applyAccessOverride). Users without
  // an access record fall through to roleFromPositionCode which defaults
  // to 'salesperson' — we must NOT lock those users to POS, they get the
  // normal layout.
  const explicitAppRole = (employee.appRole ?? "").trim().toLowerCase();
  const posOnly = explicitAppRole === "pc" || explicitAppRole === "salesperson";
  // Only redirect when we are *certain* the user is not on the POS path.
  // If x-pathname is empty (proxy didn't run, edge case during dev HMR,
  // or transient), skip the redirect — otherwise we'd loop indefinitely
  // until the browser bails out, which renders the page blank.
  const isOnPosPath =
    pathname === "/orders/new" || pathname.startsWith("/orders/new/");
  if (posOnly && pathname && !isOnPosPath) {
    redirect("/orders/new");
  }
  const displayName = employee.fullnameLo || employee.fullnameEn || employee.employeeCode || "—";
  const subtitle = employee.nickname && employee.nickname !== "0" ? employee.nickname : undefined;
  const hiddenMenuKeys = await getHiddenMenuKeys(role);

  if (posOnly) {
    // POS users are the senders, not the recipients — skip the notifier
    // for them so they don't get a ping for the bill they just rang up.
    return (
      <div className="min-h-screen bg-background text-odoo-text">
        <form
          action={logoutAction}
          className="fixed right-3 top-3 z-50"
        >
          <button
            type="submit"
            title={`${displayName} · ອອກຈາກລະບົບ`}
            className="inline-flex items-center gap-2 rounded-md border border-odoo-border bg-white px-3 py-1.5 text-xs font-semibold text-odoo-text-strong shadow-sm transition hover:bg-odoo-surface-muted"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <path d="m16 17 5-5-5-5" />
              <path d="M21 12H9" />
            </svg>
            <span className="hidden sm:inline">{displayName}</span>
          </button>
        </form>
        <main className="min-h-screen">{children}</main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-odoo-text md:flex">
      {/* Desktop: sidebar. Mobile: hidden entirely (no drawer / no top bar) — the
          bottom navigation + profile page replace it. */}
      <div className="hidden md:contents">
        <Sidebar
          displayName={displayName}
          employeeCode={employee.employeeCode ?? "—"}
          subtitle={subtitle}
          role={role}
          hiddenMenuKeys={hiddenMenuKeys}
        />
      </div>
      <main className="min-w-0 flex-1 pb-20 md:h-screen md:overflow-y-auto md:pb-0">{children}</main>
      <BottomNav />
      <OrderNotifier selfEmployeeCode={employee.employeeCode ?? null} />
    </div>
  );
}
