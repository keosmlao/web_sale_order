"use client";

import { useEffect, useState } from "react";

type Row = {
  itemCode: string;
  itemName: string;
  warehouseCode: string;
  warehouseName: string;
  balanceQty: number;
  minQty: number;
};

export default function LowStockBanner() {
  const [rows, setRows] = useState<Row[]>([]);
  const [expanded, setExpanded] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let abort = false;
    async function load() {
      try {
        const res = await fetch("/api/cashier/low-stock");
        if (!res.ok) return;
        const data = await res.json();
        if (!abort) setRows(data.rows ?? []);
      } catch {
        // ignore
      }
    }
    void load();
    const id = window.setInterval(load, 60_000); // every minute
    return () => {
      abort = true;
      window.clearInterval(id);
    };
  }, []);

  if (hidden || rows.length === 0) return null;

  return (
    <div className="mb-3 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] text-amber-900">
      <div className="flex items-center justify-between gap-2">
        <div className="font-semibold">
          ⚠ ສິນຄ້າຢູ່ໃນຂັ້ນຕ່ຳ — {rows.length} ລາຍການ
        </div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-amber-100"
          >
            {expanded ? "ຫຍໍ້" : "ສະແດງລາຍລະອຽດ"}
          </button>
          <button
            type="button"
            onClick={() => setHidden(true)}
            className="rounded border border-amber-300 bg-white px-2 py-0.5 text-[11px] font-semibold hover:bg-amber-100"
            title="ປິດແຈ້ງເຕືອນ"
          >
            ✕
          </button>
        </div>
      </div>
      {expanded ? (
        <div className="mt-2 max-h-44 overflow-y-auto rounded border border-amber-200 bg-white">
          <table className="w-full text-[12px]">
            <thead className="text-left text-[10px] font-bold uppercase text-amber-700">
              <tr>
                <th className="px-2 py-1">ສິນຄ້າ</th>
                <th className="px-2 py-1">ສາງ</th>
                <th className="px-2 py-1 text-right">ຍອດ</th>
                <th className="px-2 py-1 text-right">ຕ່ຳສຸດ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={`${r.warehouseCode}-${r.itemCode}`}
                  className="border-t border-amber-100"
                >
                  <td className="px-2 py-1">
                    <div className="font-mono text-[10px] text-odoo-text-muted">
                      {r.itemCode}
                    </div>
                    <div>{r.itemName}</div>
                  </td>
                  <td className="px-2 py-1 text-[11px]">{r.warehouseName}</td>
                  <td className="px-2 py-1 text-right font-mono font-bold text-odoo-danger">
                    {r.balanceQty}
                  </td>
                  <td className="px-2 py-1 text-right font-mono">
                    {r.minQty}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
