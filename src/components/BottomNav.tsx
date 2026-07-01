"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";

type Tab = { href: string; label: string; icon: ReactNode; match: (p: string) => boolean };

const icon = (path: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" className="h-6 w-6">{path}</svg>
);

const TABS: Tab[] = [
  { href: "/", label: "ໜ້າຫຼັກ", match: (p) => p === "/", icon: icon(<><path d="M3 9.5 12 3l9 6.5" /><path d="M5 10v10h14V10" /></>) },
  { href: "/orders/new", label: "ຂາຍ", match: (p) => p.startsWith("/orders"), icon: icon(<><circle cx="9" cy="20" r="1.5" /><circle cx="18" cy="20" r="1.5" /><path d="M2 3h3l2.4 12.3a1 1 0 0 0 1 .7h9.2a1 1 0 0 0 1-.8L21 7H6" /></>) },
  { href: "/inventory", label: "ສະຕັອກ", match: (p) => p.startsWith("/inventory"), icon: icon(<><path d="m21 8-9-5-9 5 9 5 9-5Z" /><path d="M3 8v8l9 5 9-5V8" /><path d="M12 13v8" /></>) },
  { href: "/profile", label: "ໂປຣໄຟລ໌", match: (p) => p.startsWith("/profile"), icon: icon(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>) },
];

export default function BottomNav() {
  const pathname = usePathname() ?? "/";
  return (
    <nav className="fixed inset-x-0 bottom-0 z-40 flex border-t border-odoo-border bg-white pb-[env(safe-area-inset-bottom)] shadow-[0_-2px_10px_rgba(0,0,0,0.06)] md:hidden">
      {TABS.map((t) => {
        const active = t.match(pathname);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold transition-colors ${
              active ? "text-odoo-primary" : "text-odoo-text-muted"
            }`}
          >
            <span className={active ? "scale-110 transition-transform" : "transition-transform"}>{t.icon}</span>
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
