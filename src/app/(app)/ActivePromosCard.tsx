"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

// Active promotions surfaced on the home page so salespeople see what to push
// before a customer walks in. Renders nothing when no promo is running.
type Promo = {
  id?: string | number;
  name: string;
  endAt: string | null;
  note?: string | null;
};

const endFmt = new Intl.DateTimeFormat("en-GB", {
  day: "2-digit",
  month: "2-digit",
  timeZone: "Asia/Vientiane",
});

export default function ActivePromosCard() {
  const [promos, setPromos] = useState<Promo[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/promotions/active", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const data = (await res.json()) as Promo[];
        if (!cancelled) setPromos(Array.isArray(data) ? data : []);
      } catch {
        if (!cancelled) setPromos([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  if (!promos || promos.length === 0) return null;

  return (
    <section className="overflow-hidden rounded-2xl border border-violet-100 bg-white shadow-sm">
      <div className="flex items-center justify-between border-b border-violet-100/70 bg-gradient-to-r from-violet-50 to-fuchsia-50/60 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600 text-white">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M20.59 13.41 13 21l-9-9V4h8l8.59 8.59a2 2 0 0 1 0 2.82Z" />
              <circle cx="8" cy="8" r="1.5" />
            </svg>
          </span>
          <span className="text-sm font-black text-slate-900">ໂປຣທີ່ກຳລັງແລ່ນ</span>
          <span className="rounded-full bg-violet-100 px-1.5 py-0.5 text-[10px] font-black text-violet-700">
            {promos.length}
          </span>
        </div>
        <Link href="/promotions" className="text-[11px] font-bold text-violet-600 hover:underline">
          ທັງໝົດ ›
        </Link>
      </div>
      <ul className="divide-y divide-slate-100">
        {promos.slice(0, 3).map((p, i) => (
          <li key={p.id ?? i} className="flex items-center justify-between gap-3 px-4 py-2">
            <span className="min-w-0 truncate text-xs font-bold text-slate-800">{p.name}</span>
            <span className="shrink-0 text-[10px] font-bold text-slate-400">
              {p.endAt ? `ຮອດ ${endFmt.format(new Date(p.endAt))}` : "ບໍ່ກຳນົດໝົດອາຍຸ"}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
