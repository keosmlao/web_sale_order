"use client";

import { useEffect, useState } from "react";

type Round = {
  code: string;
  name: string;
  timeLabel: string | null;
  assigned: number;
  pending: number;
};
type Data = {
  date: string;
  rounds: Round[];
  totals: { assigned: number; pending: number };
};

function fmtDate(iso: string): string {
  // YYYY-MM-DD → DD/MM/YYYY for display
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : iso;
}

// Compact "delivery load by round" summary for a given date (defaults to the
// selected ວັນຮັບສິນຄ້າ), pulled from the TMS (/api/tms/delivery-today). Shown
// in the POS summary panel so the salesperson sees how full each round already
// is before promising a slot. Stays silent (renders nothing) if TMS is
// unreachable, so it can never block order-taking.
export default function DeliveryTodayCard({ date }: { date?: string }) {
  const [data, setData] = useState<Data | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setData(null);
    setFailed(false);
    (async () => {
      try {
        const qs = date ? `?date=${encodeURIComponent(date)}` : "";
        const res = await fetch(`/api/tms/delivery-today${qs}`);
        if (!res.ok) throw new Error(String(res.status));
        const json = (await res.json()) as Data;
        if (!cancelled) setData(json);
      } catch {
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [date]);

  if (failed) return null;

  const total = data ? data.totals.assigned + data.totals.pending : 0;

  return (
    <div className="pos-delivery-today mt-3 overflow-hidden rounded-md border border-odoo-border">
      <div className="pos-delivery-today-head flex items-center justify-between gap-2 bg-indigo-50 px-3 py-2.5 text-[12px] font-bold text-indigo-900">
        <span className="flex items-center gap-2">
          <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <rect x="1" y="3" width="15" height="13" rx="1" />
            <path d="M16 8h4l3 3v5h-7z" />
            <circle cx="5.5" cy="18.5" r="2" />
            <circle cx="18.5" cy="18.5" r="2" />
          </svg>
          <span>
            ບິນຈັດສົ່ງ ຕາມຮອບ
            {data ? (
              <span className="ml-1 font-normal text-indigo-500">
                {fmtDate(data.date)}
              </span>
            ) : null}
          </span>
        </span>
        {data ? (
          <span className="font-mono">{total} ບິນ</span>
        ) : (
          <span className="text-indigo-400">ກຳລັງໂຫລດ...</span>
        )}
      </div>

      {data ? (
        <div className="pos-delivery-today-body bg-odoo-surface">
          <table className="w-full text-[12px]">
            <thead>
              <tr className="border-b border-odoo-border text-[10px] uppercase tracking-wide text-odoo-text-muted">
                <th className="px-3 py-1.5 text-left font-bold">ຮອບ</th>
                <th className="px-2 py-1.5 text-right font-bold">ຂຶ້ນຮອບແລ້ວ</th>
                <th className="px-3 py-1.5 text-right font-bold">ນັດໄວ້</th>
              </tr>
            </thead>
            <tbody>
              {data.rounds.length === 0 ? (
                <tr>
                  <td colSpan={3} className="px-3 py-3 text-center text-odoo-text-muted">
                    ມື້ນີ້ຍັງບໍ່ມີບິນຈັດສົ່ງ
                  </td>
                </tr>
              ) : (
                data.rounds.map((r) => (
                  <tr key={r.code} className="border-b border-odoo-border last:border-0">
                    <td className="px-3 py-2">
                      <span className="font-bold text-odoo-text-strong">{r.name}</span>
                      {r.timeLabel ? (
                        <span className="ml-1 text-[10px] text-odoo-text-muted">{r.timeLabel}</span>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right font-mono font-bold text-emerald-600">
                      {r.assigned}
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold text-amber-600">
                      {r.pending}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
