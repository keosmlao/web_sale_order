"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  cashierCode: string;
  cashierName: string;
  day: string;
  billCount: number;
  voidedCount: number;
  totalKip: number;
  cashKip: number;
  transferKip: number;
  redeemedKip: number;
  promoKip: number;
};

const moneyFmt = new Intl.NumberFormat("en-US");

export default function CashiersClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() - 30);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ from, to });
      const res = await fetch(`/api/reports/shift-summary?${params}`);
      if (!res.ok) {
        setError(`Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [from, to]);

  useEffect(() => {
    Promise.resolve().then(() => {
      void load();
    });
  }, [load]);

  // Aggregate by cashier across the date range.
  const byCashier = new Map<
    string,
    {
      cashierName: string;
      billCount: number;
      voidedCount: number;
      totalKip: number;
      cashKip: number;
      transferKip: number;
    }
  >();
  for (const r of rows) {
    const acc = byCashier.get(r.cashierCode) ?? {
      cashierName: r.cashierName,
      billCount: 0,
      voidedCount: 0,
      totalKip: 0,
      cashKip: 0,
      transferKip: 0,
    };
    acc.billCount += r.billCount;
    acc.voidedCount += r.voidedCount;
    acc.totalKip += r.totalKip;
    acc.cashKip += r.cashKip;
    acc.transferKip += r.transferKip;
    byCashier.set(r.cashierCode, acc);
  }
  const summary = Array.from(byCashier.entries())
    .map(([code, v]) => ({ cashierCode: code, ...v }))
    .sort((a, b) => b.totalKip - a.totalKip);

  return (
    <div className="odoo-page">
      <header className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          Reports
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          Cashier performance
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ສະຫຼຸບຍອດຂາຍຕໍ່ cashier ໃນຊ່ວງເວລາ.
        </p>
      </header>

      <div className="mb-4 grid gap-2 rounded-md border border-odoo-border bg-odoo-surface p-3 sm:grid-cols-3">
        <label className="grid gap-1">
          <span className="odoo-label">ຈາກວັນທີ</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="odoo-input"
          />
        </label>
        <label className="grid gap-1">
          <span className="odoo-label">ເຖິງວັນທີ</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            className="odoo-input"
          />
        </label>
        <div className="flex items-end">
          <button
            type="button"
            onClick={load}
            className="odoo-btn odoo-btn-primary"
          >
            ໂຫລດໃໝ່
          </button>
        </div>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
          {error}
        </div>
      ) : null}

      <section className="mb-6 rounded-md border border-odoo-border bg-odoo-surface">
        <div className="border-b border-odoo-border px-3 py-2 text-sm font-bold text-odoo-text-strong">
          ສະຫຼຸບຕໍ່ Cashier
        </div>
        <table className="odoo-table">
          <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            <tr>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2 text-right">ບິນ</th>
              <th className="px-3 py-2 text-right">ຍົກເລີກ</th>
              <th className="px-3 py-2 text-right">ເງິນສົດ</th>
              <th className="px-3 py-2 text-right">ໂອນ</th>
              <th className="px-3 py-2 text-right">ລວມ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-odoo-text-muted">
                  ກຳລັງໂຫລດ…
                </td>
              </tr>
            ) : summary.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-3 py-6 text-center text-odoo-text-muted">
                  ບໍ່ມີຂໍ້ມູນ
                </td>
              </tr>
            ) : (
              summary.map((s) => (
                <tr key={s.cashierCode} className="border-t border-odoo-border">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{s.cashierName}</div>
                    <div className="font-mono text-[10px] text-odoo-text-muted">
                      {s.cashierCode}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {moneyFmt.format(s.billCount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-odoo-danger">
                    {s.voidedCount > 0 ? moneyFmt.format(s.voidedCount) : "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">
                    {moneyFmt.format(s.cashKip)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">
                    {moneyFmt.format(s.transferKip)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {moneyFmt.format(s.totalKip)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>

      <section className="rounded-md border border-odoo-border bg-odoo-surface">
        <div className="border-b border-odoo-border px-3 py-2 text-sm font-bold text-odoo-text-strong">
          ລາຍລະອຽດຕາມວັນ
        </div>
        <table className="odoo-table">
          <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            <tr>
              <th className="px-3 py-2">ວັນ</th>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2 text-right">ບິນ</th>
              <th className="px-3 py-2 text-right">ລວມ</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-3 py-6 text-center text-odoo-text-muted">
                  ບໍ່ມີຂໍ້ມູນ
                </td>
              </tr>
            ) : (
              rows.map((r, i) => (
                <tr key={i} className="border-t border-odoo-border">
                  <td className="px-3 py-2 font-mono text-[11px]">{r.day}</td>
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.cashierName}</div>
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {moneyFmt.format(r.billCount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {moneyFmt.format(r.totalKip)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </div>
  );
}
