"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  netBonus: number;
  specialReward: number;
  commission: number;
  totalPay: number;
};
type Report = { currencyCode: string; rows: Row[] };

const fmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const REFRESH_MS = 45000;

export default function MyBonusCard() {
  const [row, setRow] = useState<Row | null>(null);
  const [currency, setCurrency] = useState("THB");

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
      <div className="flex items-end justify-between">
        <div>
          <div className="text-xs font-bold uppercase tracking-widest text-emerald-100">ໂບນັດ &amp; ຄ່າຄອມ ເດືອນນີ້</div>
          <div className="mt-1 font-mono text-4xl font-black">{fmt.format(row.totalPay)}</div>
          <div className="text-sm text-emerald-100">{currency} · ລວມລາຍຮັບ</div>
        </div>
      </div>

      <div className={`mt-4 grid gap-2.5 ${hasSpecial ? "grid-cols-3" : "grid-cols-2"}`}>
        <Item label="① ໂບນັດ" value={fmt.format(row.netBonus)} />
        {hasSpecial ? <Item label="② ເງິນພິເສດ" value={fmt.format(row.specialReward)} /> : null}
        <Item label="③ ຄ່າຄອມ" value={row.commission > 0 ? fmt.format(row.commission) : "—"} />
      </div>
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
