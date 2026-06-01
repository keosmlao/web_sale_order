"use client";

import { useCallback, useEffect, useState } from "react";

type Row = {
  promoId: string;
  promoName: string;
  promoType: string;
  isActive: boolean;
  billCount: number;
  lineCount: number;
  totalDiscountKip: number;
  totalKip: number;
};

const moneyFmt = new Intl.NumberFormat("en-US");

export default function PromoEffectivenessClient() {
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
      const res = await fetch(`/api/reports/promo-effectiveness?${params}`);
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

  return (
    <div className="odoo-page">
      <header className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          Reports
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ປະສິດທິພາບໂປຣໂມຊັນ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ໂປຣໃດໃຫ້ຍອດຂາຍຫຼາຍສຸດ + ສ່ວນຫຼຸດທີ່ໃຫ້ໄປ.
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

      <div className="overflow-x-auto rounded-md border border-odoo-border bg-odoo-surface">
        <table className="odoo-table">
          <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            <tr>
              <th className="px-3 py-2">ໂປຣໂມຊັນ</th>
              <th className="px-3 py-2">ປະເພດ</th>
              <th className="px-3 py-2">ສະຖານະ</th>
              <th className="px-3 py-2 text-right">ບິນ</th>
              <th className="px-3 py-2 text-right">ລາຍການ</th>
              <th className="px-3 py-2 text-right">ສ່ວນຫຼຸດ</th>
              <th className="px-3 py-2 text-right">ຍອດຂາຍ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-odoo-text-muted">
                  ກຳລັງໂຫລດ…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-3 py-6 text-center text-odoo-text-muted">
                  ບໍ່ມີຂໍ້ມູນ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr key={r.promoId} className="border-t border-odoo-border">
                  <td className="px-3 py-2">
                    <div className="font-semibold">{r.promoName}</div>
                    <div className="font-mono text-[10px] text-odoo-text-muted">
                      #{r.promoId}
                    </div>
                  </td>
                  <td className="px-3 py-2 text-[12px]">{r.promoType}</td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.isActive ? (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">
                        ເປີດ
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-odoo-surface-muted px-2 py-0.5 font-bold text-odoo-text-muted">
                        ປິດ
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {moneyFmt.format(r.billCount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {moneyFmt.format(r.lineCount)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold text-odoo-danger">
                    −{moneyFmt.format(r.totalDiscountKip)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {moneyFmt.format(r.totalKip)}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
