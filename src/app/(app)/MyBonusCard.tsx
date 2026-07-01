"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  bonusPoints: number;
  netBonus: number;
  specialReward: number;
  commission: number;
  totalPay: number;
};

const pointFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
type Report = { currencyCode: string; rows: Row[] };
type Item = { itemName: string; brand: string; category: string; qty: number; points: number };

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const REFRESH_MS = 45000;

export default function MyBonusCard() {
  const [row, setRow] = useState<Row | null>(null);
  const [currency, setCurrency] = useState("THB");
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Item[] | null>(null);

  const toggleItems = useCallback(async () => {
    setOpen((v) => !v);
    if (items === null) {
      try {
        const res = await fetch("/api/reports/my-bonus-items", { cache: "no-store" });
        setItems(res.ok ? ((await res.json()) as { items: Item[] }).items : []);
      } catch {
        setItems([]);
      }
    }
  }, [items]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/reports/incentives", { cache: "no-store" });
      if (!res.ok) return;
      const data = (await res.json()) as Report;
      setCurrency(data.currencyCode || "THB");
      setRow(data.rows?.[0] ?? null);
    } catch {
      /* silent — optional card */
    }
  }, []);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const timer = setInterval(() => void load(), REFRESH_MS);
    const onVisible = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { clearInterval(timer); document.removeEventListener("visibilitychange", onVisible); };
  }, [load]);

  if (!row) return null;
  const hasSpecial = row.specialReward > 0;

  return (
    <section className="odoo-card mt-3 overflow-hidden bg-gradient-to-br from-emerald-600 to-emerald-800 p-5 text-white">
      <div className="flex items-end justify-between gap-3">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-emerald-100">ໂບນັດ &amp; ຄ່າຄອມ ເດືອນນີ້</div>
          <div className="mt-1 font-mono text-4xl font-black">{fmt.format(row.totalPay)}</div>
          <div className="text-sm text-emerald-100">{currency} · ລວມລາຍຮັບ</div>
        </div>
        <div className="rounded-xl bg-white/15 px-3 py-2 text-center ring-1 ring-inset ring-white/20">
          <div className="text-[10px] uppercase tracking-wide text-emerald-100">ຄະແນນ</div>
          <div className="font-mono text-2xl font-black leading-none">{pointFmt.format(row.bonusPoints)}</div>
        </div>
      </div>

      <div className={`mt-4 grid gap-2.5 ${hasSpecial ? "grid-cols-3" : "grid-cols-2"}`}>
        <Item label="① ໂບນັດ" value={fmt.format(row.netBonus)} />
        {hasSpecial ? <Item label="② ເງິນພິເສດ" value={fmt.format(row.specialReward)} /> : null}
        <Item label="③ ຄ່າຄອມ" value={row.commission > 0 ? fmt.format(row.commission) : "—"} />
      </div>

      <button type="button" onClick={() => void toggleItems()} className="mt-4 flex w-full items-center justify-center gap-1 rounded-xl bg-white/10 py-2 text-xs font-bold ring-1 ring-inset ring-white/15 transition hover:bg-white/15">
        {open ? "ເຊື່ອງລາຍການ" : "ເບິ່ງລາຍການທີ່ໄດ້ຄະແນນ"} <span className={`transition-transform ${open ? "rotate-180" : ""}`}>▾</span>
      </button>

      {open ? (
        <div className="mt-3 overflow-hidden rounded-xl bg-white/10 ring-1 ring-inset ring-white/15">
          {items === null ? (
            <div className="py-6 text-center text-xs text-white/70">ກຳລັງໂຫລດ…</div>
          ) : items.length === 0 ? (
            <div className="py-6 text-center text-xs text-white/70">ຍັງບໍ່ມີລາຍການທີ່ໄດ້ຄະແນນ</div>
          ) : (
            <ul className="divide-y divide-white/10">
              {items.map((it, i) => (
                <li key={`${it.itemName}-${i}`} className="flex items-center gap-2 px-3 py-2">
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[13px] font-bold">{it.itemName}</span>
                    <span className="text-[11px] text-white/60">{it.brand}{it.category ? ` · ${it.category}` : ""} · x{fmt.format(it.qty)}</span>
                  </span>
                  <span className="shrink-0 rounded-lg bg-white/15 px-2 py-1 font-mono text-sm font-black">{pointFmt.format(it.points)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : null}
    </section>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-white/10 px-3 py-2.5 ring-1 ring-inset ring-white/15">
      <div className="text-[11px] uppercase tracking-wide text-white/70">{label}</div>
      <div className="mt-0.5 font-mono text-lg font-black leading-tight">{value}</div>
    </div>
  );
}
