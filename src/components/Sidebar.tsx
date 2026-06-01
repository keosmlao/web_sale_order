"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { logoutAction } from "@/app/login/actions";
import type { AppRole } from "@/lib/roles";

type NavLeaf = {
  href: string;
  label: string;
  icon: ReactNode;
  // When set, the link is only shown to these roles. Absent → visible to all.
  roles?: AppRole[];
};

type NavGroup = {
  id: string;
  label: string;
  icon: ReactNode;
  children: NavLeaf[];
};

type NavItem = NavLeaf | NavGroup;

type NavSection = {
  id: string;
  label: string;
  items: NavItem[];
};

const sections: NavSection[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    items: [
      {
        href: "/",
        label: "ໜ້າຫຼັກ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M3 10.5 12 3l9 7.5" />
            <path d="M5 10v10h14V10" />
            <path d="M9 20v-6h6v6" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "reports",
    label: "Reports",
    items: [
      {
        href: "/reports/daily-sales",
        label: "ຍອດຂາຍປະຈຳວັນ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M3 3v18h18" />
            <path d="M7 14l4-4 4 4 5-6" />
          </svg>
        ),
      },
      {
        href: "/reports/cashiers",
        label: "Cashier performance",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <circle cx="12" cy="8" r="4" />
            <path d="M4 20c0-3 4-5 8-5s8 2 8 5" />
          </svg>
        ),
      },
      {
        href: "/reports/promo-effectiveness",
        label: "ປະສິດທິພາບໂປຣ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M20.59 13.41 13.42 20.58a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82Z" />
            <path d="M7 7h.01" />
          </svg>
        ),
      },
      {
        href: "/reports/daily-payments",
        label: "ສະຫຼຸບການຮັບເງິນ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M6 10v.01M18 14v.01" />
          </svg>
        ),
      },
      {
        href: "/reports/salespeople",
        label: "ຍອດຂາຍຕາມພະນັກງານ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="m22 11-3 3-2-2" />
          </svg>
        ),
      },
      {
        href: "/reports/items",
        label: "ສິນຄ້າຂາຍດີ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M3 9h18" />
            <path d="M9 21V9" />
            <rect x="3" y="3" width="18" height="18" rx="2" />
          </svg>
        ),
      },
      {
        href: "/reports/stock-refill",
        label: "ຂໍເຕີມສະຕ້ອກ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <path d="M12 7v6" />
            <path d="M9 10l3 3 3-3" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "ops",
    label: "Operations",
    items: [
      {
        href: "/inventory",
        label: "ສິນຄ້າຄົງເຫຼືອ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
            <path d="M3.27 6.96 12 12.01l8.73-5.05" />
            <path d="M12 22.08V12" />
          </svg>
        ),
      },
      {
        href: "/cashier",
        label: "ຮັບເງິນ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <rect x="2" y="6" width="20" height="12" rx="2" />
            <circle cx="12" cy="12" r="2.5" />
            <path d="M6 10v.01M18 10v.01M6 14v.01M18 14v.01" />
          </svg>
        ),
      },
      {
        href: "/cashier/history",
        label: "ປະຫວັດການຂາຍ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
        ),
      },
      {
        href: "/orders/new",
        label: "POS",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M4 4h16v5H4z" />
            <path d="M4 9v11h16V9" />
            <path d="M8 13h2" />
            <path d="M14 13h2" />
            <path d="M8 17h8" />
          </svg>
        ),
      },
    ],
  },
  {
    id: "manage",
    label: "Management",
    items: [
      {
        href: "/members",
        label: "ສະມາຊິກລູກຄ້າ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M20 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M4 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2" />
            <circle cx="10" cy="7" r="4" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        href: "/employees",
        label: "ຈັດການພະນັກງານ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
            <path d="M16 3.13a4 4 0 0 1 0 7.75" />
          </svg>
        ),
      },
      {
        href: "/monitor",
        label: "ຕິດຕາມມືຖື sale",
        roles: ["manager", "head"],
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <rect x="7" y="2" width="10" height="20" rx="2" />
            <path d="M11 18h2" />
          </svg>
        ),
      },
      {
        id: "settings",
        label: "ການຕັ້ງຄ່າ",
        icon: (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[18px] w-[18px]">
            <path d="M12 15.5A3.5 3.5 0 1 0 12 8a3.5 3.5 0 0 0 0 7.5Z" />
            <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.88-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 0 1-4 0v-.09a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 0 1 0-4h.09A1.7 1.7 0 0 0 4.65 8.94a1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.7 1.7 0 0 0 1.88.34H9a1.7 1.7 0 0 0 1-1.56V3a2 2 0 0 1 4 0v.09a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.7 1.7 0 0 0-.34 1.88V9a1.7 1.7 0 0 0 1.56 1.03H21a2 2 0 0 1 0 4h-.09A1.7 1.7 0 0 0 19.4 15Z" />
          </svg>
        ),
        children: [
          {
            href: "/settings/sales-warehouses",
            label: "ສາງຂາຍ",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px]">
                <path d="M3 9 12 4l9 5-9 5-9-5Z" />
                <path d="M3 9v6l9 5 9-5V9" />
              </svg>
            ),
          },
          {
            href: "/settings/stock-minimum",
            label: "Minimum Stock",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px]">
                <path d="M4 19h16" />
                <path d="M7 16V9" />
                <path d="M12 16V5" />
                <path d="M17 16v-4" />
              </svg>
            ),
          },
          {
            href: "/settings/barcodes",
            label: "Barcode ສິນຄ້າ",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px]">
                <path d="M3 5v14" />
                <path d="M7 5v14" />
                <path d="M11 5v14" />
                <path d="M15 5v14" />
                <path d="M19 5v14" />
              </svg>
            ),
          },
          {
            href: "/promotions",
            label: "ໂປຣໂມຊັນ",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px]">
                <path d="M20.59 13.41 13 21l-9-9V4h8l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                <circle cx="8" cy="8" r="1.5" />
              </svg>
            ),
          },
          {
            href: "/loyalty",
            label: "ສະສົມແຕ້ມ",
            icon: (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-[16px] w-[16px]">
                <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
              </svg>
            ),
          },
        ],
      },
    ],
  },
];

function isNavGroup(item: NavItem): item is NavGroup {
  return "children" in item;
}

type SidebarProps = {
  displayName: string;
  employeeCode: string;
  subtitle?: string;
  role: AppRole;
};

export default function Sidebar({ displayName, employeeCode, subtitle, role }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [pendingHref, setPendingHref] = useState<string | null>(null);
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  // Drop links the current role isn't allowed to see (e.g. the device
  // monitor is heads/managers only), then drop any section left empty.
  const visibleSections = useMemo(() => {
    const allowed = (leaf: NavLeaf) => !leaf.roles || leaf.roles.includes(role);
    return sections
      .map((s) => ({
        ...s,
        items: s.items
          .map((item) =>
            isNavGroup(item)
              ? { ...item, children: item.children.filter(allowed) }
              : item,
          )
          .filter((item) =>
            isNavGroup(item) ? item.children.length > 0 : allowed(item),
          ),
      }))
      .filter((s) => s.items.length > 0);
  }, [role]);

  // Flatten all items for the mobile horizontal scroller.
  const mobileNavItems = visibleSections.flatMap((s) =>
    s.items.flatMap((item) => (isNavGroup(item) ? item.children : [item])),
  );

  const isHrefActive = useCallback(
    (href: string) => {
      if (href === "/cashier") {
        return (
          pathname === "/cashier" ||
          (pathname.startsWith("/cashier/") && !pathname.startsWith("/cashier/history"))
        );
      }
      return pathname === href || (href !== "/" && pathname.startsWith(`${href}/`));
    },
    [pathname],
  );

  useEffect(() => {
    const id = window.setTimeout(() => setPendingHref(null), 0);
    return () => window.clearTimeout(id);
  }, [pathname]);

  const markPending = (href: string) => {
    if (!isHrefActive(href)) setPendingHref(href);
  };

  const userInitial = (subtitle || displayName || "?").trim().charAt(0).toUpperCase();

  return (
    <>
      {pendingHref ? (
        <div className="route-progress" aria-hidden="true">
          <div />
        </div>
      ) : null}

      {/* Mobile top header */}
      <header className="sticky top-0 z-20 border-b border-white/5 bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 px-4 py-3 shadow-md md:hidden">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="flex h-9 w-auto items-center justify-center rounded-xl bg-white px-2 shadow-sm">
              <img src="/odm.png" alt="ODIEN Mall" className="h-6 w-auto object-contain" />
            </div>
            <div>
              <div className="text-base font-extrabold leading-none text-white tracking-tight">ODG ຂາຍ</div>
              <div className="mt-1 text-[10px] font-medium text-slate-400">ລະບົບຈັດການການຂາຍ</div>
            </div>
          </div>
          <form action={logoutAction}>
            <button
              type="submit"
              aria-label="ອອກຈາກລະບົບ"
              className="inline-flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 text-slate-300 hover:bg-white/10 hover:text-white"
            >
              <LogoutIcon className="h-4 w-4" />
            </button>
          </form>
        </div>
        <nav className="mt-3 flex gap-2 overflow-x-auto pb-1.5 scrollbar-none">
          {mobileNavItems.map((item) => {
            const active = isHrefActive(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch
                onPointerEnter={() => router.prefetch(item.href)}
                onClick={() => markPending(item.href)}
                className={
                  "inline-flex shrink-0 items-center gap-2 rounded-xl border px-3.5 py-1.5 text-xs font-bold transition-all " +
                  (active
                    ? "bg-indigo-600 border-indigo-500 text-white shadow-md shadow-indigo-600/20"
                    : "bg-white/5 border-white/10 text-slate-300 hover:bg-white/10 hover:text-white")
                }
              >
                {item.icon}
                {item.label}
              </Link>
            );
          })}
        </nav>
      </header>

      {/* Desktop dark sidebar */}
      <aside className="sbd-shell hidden md:flex">
        <div className="sbd-bg" aria-hidden />
        <div className="sbd-inner">
          <Link
            href="/"
            prefetch
            onClick={() => markPending("/")}
            className="sbd-brand"
            aria-label="ໜ້າຫຼັກ"
          >
            <div className="sbd-brand-logo"><img src="/odm.png" alt="ODIEN Mall" /></div>
            <div className="sbd-brand-text">
              <div className="sbd-brand-name">ODG ຂາຍ</div>
              <div className="sbd-brand-tag">Sales Management</div>
            </div>
          </Link>

          <nav className="sbd-nav" aria-label="ເມນູຫຼັກ">
            {visibleSections.map((section) => (
              <div key={section.id} className="sbd-section">
                <div className="sbd-section-label">{section.label}</div>
                <ul>
                  {section.items.map((item) => {
                    if (isNavGroup(item)) {
                      const groupActive = item.children.some((c) => isHrefActive(c.href));
                      const open = openGroups[item.id] ?? groupActive;
                      return (
                        <li key={item.id} className="sbd-item-wrap">
                          <button
                            type="button"
                            aria-expanded={open}
                            onClick={() =>
                              setOpenGroups((prev) => ({
                                ...prev,
                                [item.id]: !(prev[item.id] ?? groupActive),
                              }))
                            }
                            className={"sbd-item " + (groupActive ? "sbd-item-active" : "")}
                          >
                            <span className="sbd-item-icon">{item.icon}</span>
                            <span className="sbd-item-label">{item.label}</span>
                            <span
                              className={"sbd-item-chevron " + (open ? "sbd-item-chevron-open" : "")}
                              aria-hidden
                            >
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3">
                                <path d="m6 9 6 6 6-6" />
                              </svg>
                            </span>
                          </button>
                          {open ? (
                            <ul className="sbd-sub">
                              {item.children.map((child) => {
                                const childActive = isHrefActive(child.href);
                                return (
                                  <li key={child.href}>
                                    <Link
                                      href={child.href}
                                      prefetch
                                      onPointerEnter={() => router.prefetch(child.href)}
                                      onClick={() => markPending(child.href)}
                                      className={"sbd-sub-item " + (childActive ? "sbd-sub-item-active" : "")}
                                    >
                                      <span className="sbd-sub-icon">{child.icon}</span>
                                      <span>{child.label}</span>
                                    </Link>
                                  </li>
                                );
                              })}
                            </ul>
                          ) : null}
                        </li>
                      );
                    }
                    const active = isHrefActive(item.href);
                    return (
                      <li key={item.href} className="sbd-item-wrap">
                        <Link
                          href={item.href}
                          prefetch
                          onPointerEnter={() => router.prefetch(item.href)}
                          onClick={() => markPending(item.href)}
                          className={"sbd-item " + (active ? "sbd-item-active" : "")}
                        >
                          <span className="sbd-item-icon">{item.icon}</span>
                          <span className="sbd-item-label">{item.label}</span>
                          {active ? <span className="sbd-item-dot" aria-hidden /> : null}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </nav>

          <div className="sbd-foot">
            <div className="sbd-user">
              <div className="sbd-avatar">
                {userInitial}
                <span className="sbd-avatar-dot" aria-hidden />
              </div>
              <div className="sbd-user-text">
                <div className="sbd-user-name" title={displayName}>{displayName}</div>
                <div className="sbd-user-code">{employeeCode}</div>
              </div>
            </div>
            <form action={logoutAction}>
              <button
                type="submit"
                className="sbd-logout"
                aria-label="ອອກຈາກລະບົບ"
              >
                <LogoutIcon className="h-4 w-4" />
                <span>ອອກຈາກລະບົບ</span>
              </button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}

function LogoutIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
