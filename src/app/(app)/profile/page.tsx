import Link from "next/link";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import { getHiddenMenuKeys } from "@/lib/menu-visibility";
import { MENU_REGISTRY, ROLE_LABELS } from "@/lib/menu-registry";
import { logoutAction } from "@/app/login/actions";
import MyTargetCard from "../MyTargetCard";
import MyBonusCard from "../MyBonusCard";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  const employee = await requireEmployee();
  const role = roleFromEmployee(employee);
  const hidden = new Set(await getHiddenMenuKeys(role));
  const displayName = employee.fullnameLo || employee.fullnameEn || employee.employeeCode || "—";
  const initial = displayName.trim().charAt(0) || "?";

  // Menu the user can reach (registry minus role-hidden keys), grouped by section.
  // The home + the four bottom-nav destinations are omitted (already reachable).
  const skip = new Set(["/", "/orders/new", "/inventory"]);
  const groups = new Map<string, { key: string; label: string }[]>();
  for (const item of MENU_REGISTRY) {
    if (hidden.has(item.key) || skip.has(item.key)) continue;
    if (!groups.has(item.section)) groups.set(item.section, []);
    groups.get(item.section)!.push(item);
  }

  return (
    <div className="odoo-page pb-24">
      {/* Account header */}
      <div className="odoo-card flex items-center gap-4 bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 p-5 text-white">
        <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-white/15 text-2xl font-black">{initial}</div>
        <div className="min-w-0">
          <div className="truncate text-xl font-black">{displayName}</div>
          <div className="text-sm text-white/70">{employee.employeeCode ?? "—"}</div>
          <span className="mt-1 inline-block rounded-full bg-white/15 px-2 py-0.5 text-[11px] font-bold">{ROLE_LABELS[role] ?? role}</span>
        </div>
      </div>

      {/* My target + bonus (shown for salespeople with a target) */}
      <div className="mt-4">
        <MyTargetCard />
      </div>
      <MyBonusCard />

      {/* Quick links */}
      <Link href="/reports/my-sales" className="odoo-card mt-3 flex items-center justify-between p-4 transition hover:bg-odoo-surface-muted">
        <span className="font-bold text-odoo-text-strong">📊 Dashboard ຍອດຂາຍ</span>
        <span className="text-odoo-text-muted">›</span>
      </Link>

      {/* Full menu */}
      {[...groups.entries()].map(([section, items]) => (
        <div key={section} className="mt-5">
          <h2 className="mb-2 px-1 text-xs font-black uppercase tracking-wide text-odoo-text-muted">{section}</h2>
          <div className="odoo-card divide-y divide-odoo-border overflow-hidden">
            {items.map((item) => (
              <Link key={item.key} href={item.key} className="flex items-center justify-between px-4 py-3 transition hover:bg-odoo-surface-muted">
                <span className="text-odoo-text-strong">{item.label}</span>
                <span className="text-odoo-text-muted">›</span>
              </Link>
            ))}
          </div>
        </div>
      ))}

      {/* Logout */}
      <form action={logoutAction} className="mt-6">
        <button type="submit" className="w-full rounded-xl border border-rose-300 bg-rose-50 px-4 py-3 text-sm font-black text-odoo-danger transition hover:bg-rose-100">
          ອອກຈາກລະບົບ
        </button>
      </form>
    </div>
  );
}
