"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

type Row = {
  docNo: string;
  cartNumber: string | null;
  createdAt: string;
  customerId: string | null;
  customerName: string | null;
  customerPhone: string | null;
  cashierCode: string | null;
  cashierName: string | null;
  totalKip: number;
  cashKip: number;
  transferKip: number;
  redeemedKip: number;
  isVoided: boolean;
  voidDocNo: string | null;
  voidReason: string | null;
  voidedAt: string | null;
};

const moneyFmt = new Intl.NumberFormat("en-US");

export default function HistoryClient() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [status, setStatus] = useState<"all" | "settled" | "voided">("all");

  const fetchHistory = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (from) params.set("from", from);
      if (to) params.set("to", to);
      if (status !== "all") params.set("status", status);
      const res = await fetch(`/api/cashier/history?${params.toString()}`);
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      const data = await res.json();
      setRows(data.rows ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "fetch failed");
    } finally {
      setLoading(false);
    }
  }, [q, from, to, status]);

  useEffect(() => {
    void fetchHistory();
  }, [fetchHistory]);

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          Cashier
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ປະຫວັດການຊາຍ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ຄົ້ນບິນທີ່ຮັບເງິນແລ້ວ ໂດຍເລກບິນ, ຊື່ລູກຄ້າ, ເບີໂທ ຫຼື ໄລຍະວັນທີ.
        </p>
      </header>

      <div className="mb-4 grid gap-2 rounded-md border border-odoo-border bg-odoo-surface p-3 sm:grid-cols-5">
        <label className="grid gap-1 sm:col-span-2">
          <span className="odoo-label">ຄົ້ນ</span>
          <input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ເລກບິນ / ຊື່ / ເບີໂທ"
            className="odoo-input"
          />
        </label>
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
        <label className="grid gap-1">
          <span className="odoo-label">ສະຖານະ</span>
          <select
            value={status}
            onChange={(e) =>
              setStatus(e.target.value as "all" | "settled" | "voided")
            }
            className="odoo-input"
          >
            <option value="all">ທັງໝົດ</option>
            <option value="settled">ປົກກະຕິ</option>
            <option value="voided">ຍົກເລີກ</option>
          </select>
        </label>
      </div>

      {error ? (
        <div className="mb-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
          {error}
        </div>
      ) : null}

      <div className="overflow-x-auto rounded-md border border-odoo-border bg-odoo-surface">
        <table className="w-full text-sm">
          <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            <tr>
              <th className="px-3 py-2">ເລກບິນ</th>
              <th className="px-3 py-2">ວັນທີ</th>
              <th className="px-3 py-2">ລູກຄ້າ</th>
              <th className="px-3 py-2">Cashier</th>
              <th className="px-3 py-2 text-right">ຍອດ (ກີບ)</th>
              <th className="px-3 py-2 text-right">ເງິນສົດ</th>
              <th className="px-3 py-2 text-right">ໂອນ</th>
              <th className="px-3 py-2">ສະຖານະ</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-odoo-text-muted"
                >
                  ກຳລັງໂຫລດ…
                </td>
              </tr>
            ) : rows.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-3 py-6 text-center text-odoo-text-muted"
                >
                  ບໍ່ພົບຂໍ້ມູນ
                </td>
              </tr>
            ) : (
              rows.map((r) => (
                <tr
                  key={r.docNo}
                  className="border-t border-odoo-border hover:bg-odoo-surface-muted/50"
                >
                  <td className="px-3 py-2 font-mono text-[12px]">
                    <Link
                      href={`/cashier/receipts/${r.docNo}`}
                      className="text-odoo-link hover:underline"
                    >
                      {r.docNo}
                    </Link>
                  </td>
                  <td className="px-3 py-2 text-[12px] text-odoo-text-muted">
                    {new Date(r.createdAt).toLocaleString()}
                  </td>
                  <td className="px-3 py-2">
                    <div className="font-semibold text-odoo-text-strong">
                      {r.customerName ?? "—"}
                    </div>
                    {r.customerPhone ? (
                      <div className="text-[11px] text-odoo-text-muted">
                        {r.customerPhone}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.cashierName ?? r.cashierCode ?? "—"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono font-bold">
                    {moneyFmt.format(r.totalKip)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">
                    {moneyFmt.format(r.cashKip)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-[12px]">
                    {moneyFmt.format(r.transferKip)}
                  </td>
                  <td className="px-3 py-2 text-[12px]">
                    {r.isVoided ? (
                      <span className="inline-flex rounded-full bg-rose-100 px-2 py-0.5 font-bold text-odoo-danger">
                        ຍົກເລີກ
                      </span>
                    ) : (
                      <span className="inline-flex rounded-full bg-emerald-100 px-2 py-0.5 font-bold text-emerald-700">
                        ປົກກະຕິ
                      </span>
                    )}
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
