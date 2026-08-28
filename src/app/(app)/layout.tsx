import { Suspense } from "react";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import {
  roleFromEmployee,
  isPrivilegedRole,
  isSelfServeForSide,
  counterSide,
  isPathAllowedForSide,
  homePathForSide,
  landingPathFor,
} from "@/lib/roles";
import { getHiddenMenuKeys } from "@/lib/menu-visibility";
import Sidebar from "@/components/Sidebar";
import EmbedMode from "@/components/EmbedMode";
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
  // Selling and taking the money are separate jobs: a 'pc' works the
  // register and never the POS, a salesperson the reverse. See roles.ts.
  const side = counterSide(employee);
  const roleHome = landingPathFor(employee);
  const isRegisterUser = side === "register";
  // Only redirect when we are *certain* the user is not on the POS path.
  // If x-pathname is empty (proxy didn't run, edge case during dev HMR,
  // or transient), skip the redirect — otherwise we'd loop indefinitely
  // until the browser bails out, which renders the page blank.
  const isOnPosPath =
    pathname === "/orders/new" || pathname.startsWith("/orders/new/");
  // POS-locked staff may also open their own profile + bonus/sales views.
  // A user assigned to one side of the counter has exactly one work
  // screen, and the shared dashboard is not it — they also get no sidebar
  // on desktop, so landing on "/" leaves them with nothing to click. Send
  // them to their screen however they arrive: a fresh login, an old
  // session, a bookmark or the app icon. Routing this at login alone only
  // fixed the first of those.
  if (pathname === "/" && roleHome !== "/") {
    redirect(roleHome);
  }
  const posAllowed =
    !pathname ||
    (isSelfServeForSide(side, pathname) && isPathAllowedForSide(side, pathname));
  if (posOnly && pathname && !posAllowed) {
    redirect(roleHome);
  }
  // Regular salespeople (position-derived, not the POS-locked cashier users
  // handled above) keep the normal layout + Home dashboard, but may only reach
  // their own screens — the sidebar hides management links and this guard
  // blocks anyone who types a restricted URL directly. Heads / managers see
  // everything. As with posOnly, skip the redirect when x-pathname is empty
  // (proxy didn't run) so we never loop the page into a blank render.
  const privileged = isPrivilegedRole(role);
  if (
    !privileged &&
    !posOnly &&
    pathname &&
    (!isSelfServeForSide(side, pathname) || !isPathAllowedForSide(side, pathname))
  ) {
    redirect(roleHome);
  }
  const displayName = employee.fullnameLo || employee.fullnameEn || employee.employeeCode || "—";
  const subtitle = employee.nickname && employee.nickname !== "0" ? employee.nickname : undefined;
  const hiddenMenuKeys = await getHiddenMenuKeys(role);

  if (posOnly) {
    // POS users are the senders, not the recipients — skip the notifier
    // for them so they don't get a ping for the bill they just rang up.
    // How many sales orders are still waiting to be billed. Cheap COUNT,
    // and only for the register — nobody else sees the badge. A failure
    // here must not take the whole shell down, so it falls back to none.
    let pendingOrders = 0;
    if (isRegisterUser) {
      try {
        const rows = await prisma.$queryRaw<Array<{ n: bigint }>>`
          SELECT COUNT(*)::bigint AS n
          FROM ic_trans
          WHERE doc_format_code = 'SOK'
            AND COALESCE(status, 0) NOT IN (1, 2)
        `;
        pendingOrders = Number(rows[0]?.n ?? 0);
      } catch {
        pendingOrders = 0;
      }
    }

    // Two jobs, two menus. Taking the order and issuing the receipt are
    // separate documents in the books, so the register gets a link to each
    // instead of one screen with the receipt buried behind a row link.
    const registerNav = [
      {
        href: "/cashier",
        label: "ໃບສັ່ງຂາຍ",
        hint: "ລໍຖ້າອອກບິນ",
        badge: pendingOrders,
        active: pathname === "/cashier",
        icon: (
          <>
            <path d="M8 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2h-3" />
            <rect x="8" y="2" width="8" height="4" rx="1" />
            <path d="M8 11h8M8 15h5" />
          </>
        ),
      },
      {
        href: "/cashier/history",
        label: "ໃບຮັບເງິນ",
        active:
          pathname.startsWith("/cashier/history") ||
          pathname.startsWith("/cashier/receipts"),
        icon: (
          <>
            <path d="M6 2h12v20l-3-2-3 2-3-2-3 2z" />
            <path d="M9 7h6M9 11h6M9 15h3" />
          </>
        ),
      },
      {
        href: "/reports/daily-payments",
        label: "ສະຫຼຸບການຮັບເງິນ",
        active: pathname.startsWith("/reports/daily-payments"),
        icon: <path d="M4 19V9M10 19V5M16 19v-7M22 19H2" />,
      },
    ];

    return (
      // On md+ the row is exactly the viewport and only <main> scrolls —
      // the sidebar measured itself in dvh while the page measured itself
      // in vh, and the two disagree whenever the browser bar collapses,
      // which read as a sidebar that did not fit the height.
      <div className="min-h-screen bg-background text-odoo-text md:flex md:h-screen md:min-h-0 md:overflow-hidden">
        <Suspense fallback={null}>
          <EmbedMode />
        </Suspense>
        {/* The register wears the same sidebar as the head's screens — the
            dark sbd-* shell, brand on top, user and logout in the foot —
            so the till does not look like a different product. Only the
            menu inside differs: the register's three links, with the
            pending count riding the ໃບສັ່ງຂາຍ row. */}
        {isRegisterUser ? (
          <aside className="app-chrome sbd-shell hidden md:flex md:!h-full">
            <div className="sbd-bg" aria-hidden />
            <div className="sbd-inner">
              <a href="/cashier" className="sbd-brand" aria-label="ໜ້າຮັບເງິນ">
                <div className="sbd-brand-logo">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src="/odm.png" alt="ODIEN Mall" />
                </div>
                <div className="sbd-brand-text">
                  <div className="sbd-brand-name">ODG ຂາຍ</div>
                  <div className="sbd-brand-tag">ໜ້າຮັບເງິນ</div>
                </div>
              </a>

              <nav className="sbd-nav" aria-label="ເມນູຫຼັກ">
                <div className="sbd-section">
                  <div className="sbd-section-label">Cashier</div>
                  <ul>
                    {registerNav.map((item) => (
                      <li key={item.href} className="sbd-item-wrap">
                        <a
                          href={item.href}
                          title={
                            item.hint ? `${item.label} · ${item.hint}` : item.label
                          }
                          className={
                            "sbd-item " + (item.active ? "sbd-item-active" : "")
                          }
                        >
                          <span className="sbd-item-icon">
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.8"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-[18px] w-[18px]"
                            >
                              {item.icon}
                            </svg>
                          </span>
                          <span className="sbd-item-label">{item.label}</span>
                          {item.badge ? (
                            <span className="ml-auto inline-flex h-5 min-w-[20px] shrink-0 items-center justify-center rounded-full bg-odoo-warning px-1.5 text-[11px] font-black text-white">
                              {item.badge}
                            </span>
                          ) : item.active ? (
                            <span className="sbd-item-dot" aria-hidden />
                          ) : null}
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              </nav>

              <div className="sbd-foot">
                <div className="sbd-user">
                  <div className="sbd-avatar">
                    {displayName.trim().charAt(0) || "·"}
                    <span className="sbd-avatar-dot" aria-hidden />
                  </div>
                  <div className="sbd-user-text">
                    <div className="sbd-user-name" title={displayName}>
                      {displayName}
                    </div>
                    <div className="sbd-user-code">Cashier</div>
                  </div>
                </div>
                <form action={logoutAction}>
                  <button
                    type="submit"
                    className="sbd-logout"
                    aria-label="ອອກຈາກລະບົບ"
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
                      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                      <polyline points="16 17 21 12 16 7" />
                      <line x1="21" y1="12" x2="9" y2="12" />
                    </svg>
                    <span>ອອກຈາກລະບົບ</span>
                  </button>
                </form>
              </div>
            </div>
          </aside>
        ) : (
          <form action={logoutAction} className="app-chrome fixed right-3 top-3 z-50">
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
        )}

        <main className="min-w-0 flex-1 pb-20 md:h-screen md:overflow-y-auto md:pb-0">
          {children}
        </main>

        <nav className="app-chrome fixed inset-x-0 bottom-0 z-40 flex border-t border-odoo-border bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(0,0,0,0.06)] md:hidden">
          {isRegisterUser ? (
            <>
              <a href="/cashier" className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${pathname === "/cashier" ? "text-odoo-primary" : "text-odoo-text-muted"}`}>
                <span className="text-lg">🧾</span> ໃບສັ່ງຂາຍ
              </a>
              <a href="/cashier/history" className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${pathname.startsWith("/cashier/history") || pathname.startsWith("/cashier/receipts") ? "text-odoo-primary" : "text-odoo-text-muted"}`}>
                <span className="text-lg">💵</span> ໃບຮັບເງິນ
              </a>
            </>
          ) : (
            <a href={roleHome} className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${isOnPosPath ? "text-odoo-primary" : "text-odoo-text-muted"}`}>
              <span className="text-lg">🛒</span> ຂາຍ
            </a>
          )}
          <a href="/profile" className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold ${pathname.startsWith("/profile") ? "text-odoo-primary" : "text-odoo-text-muted"}`}>
            <span className="text-lg">👤</span> ໂປຣໄຟລ໌
          </a>
        </nav>
      </div>
    );
  }

  return (
    <div
      className={
        "min-h-screen bg-background text-odoo-text md:flex" +
        // POS needs every pixel for its three columns (catalogue / cart /
        // checkout). On that route the sidebar collapses to an icon rail,
        // giving the sale back ~190px. Nav is still one tap away.
        (isOnPosPath ? " pos-compact-nav" : "")
      }
    >
      {/* Desktop: sidebar. Mobile: hidden entirely (no drawer / no top bar) — the
          bottom navigation + profile page replace it. */}
      <Suspense fallback={null}>
        <EmbedMode />
      </Suspense>
      <div className="app-chrome hidden md:contents">
        <Sidebar
          side={side}
          displayName={displayName}
          employeeCode={employee.employeeCode ?? "—"}
          subtitle={subtitle}
          role={role}
          hiddenMenuKeys={hiddenMenuKeys}
        />
      </div>
      <main className="min-w-0 flex-1 pb-20 md:h-screen md:overflow-y-auto md:pb-0">{children}</main>
      <div className="app-chrome contents">
        <BottomNav role={role} side={side} />
      </div>
      <OrderNotifier selfEmployeeCode={employee.employeeCode ?? null} />
    </div>
  );
}
