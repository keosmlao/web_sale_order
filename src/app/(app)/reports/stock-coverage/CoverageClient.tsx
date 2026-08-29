"use client";

import { useCallback, useEffect, useState } from "react";
import { fmtDate } from "@/lib/datetime";

// ວິເຄາະຄວາມພຽງພໍ / Coverage — the owner's reference screen: pick the
// warehouse and the horizons, and every item answers the one question a
// buyer has — how many days until this shelf is empty — bucketed from ໝົດ
// to ບໍ່ເຄື່ອນໄຫວ, with the money that refilling costs and the money that
// is sitting still.

type Status = "out" | "critical" | "reorder" | "ok" | "excess" | "idle";

type Item = {
  code: string;
  name: string;
  unit: string;
  balance: number;
  sold: number;
  bills: number;
  lastSale: string | null;
  avgDay: number;
  coverDays: number | null;
  status: Status;
  refillQty: number;
  refillValue: number;
  stockValue: number;
  revenue: number;
  abc: "A" | "B" | "C" | null;
  fsn: "F" | "S" | "N";
  wmsQty: number | null;
  wmsDiff: boolean;
};

type Resp = {
  wh: string;
  days: number;
  warehouses: Array<{ code: string; name: string }>;
  summary: {
    total: number;
    selling: number;
    fillRate: number;
    wmsCompared: number;
    wmsMismatch: number;
    out: number;
    critical: number;
    reorder: number;
    ok: number;
    excess: number;
    idle: number;
    refillValue: number;
    sunkValue: number;
  };
  items: Item[];
};

const n = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const n2 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 });

const ST: Record<Status, { label: string; dot: string; pill: string; bar: string }> = {
  out: { label: "ໝົດ", dot: "bg-rose-500", pill: "bg-rose-50 text-rose-600", bar: "bg-rose-500" },
  critical: { label: "ວິກິດ", dot: "bg-orange-500", pill: "bg-orange-50 text-orange-600", bar: "bg-orange-500" },
  reorder: { label: "ສັ່ງຊື້", dot: "bg-amber-400", pill: "bg-amber-50 text-amber-600", bar: "bg-amber-400" },
  ok: { label: "ພຽງພໍ", dot: "bg-emerald-500", pill: "bg-emerald-50 text-emerald-600", bar: "bg-emerald-500" },
  excess: { label: "ເກີນ", dot: "bg-sky-500", pill: "bg-sky-50 text-sky-600", bar: "bg-sky-500" },
  idle: { label: "ບໍ່ເຄື່ອນໄຫວ", dot: "bg-slate-300", pill: "bg-slate-100 text-slate-500", bar: "bg-slate-300" },
};
const ORDER: Status[] = ["out", "critical", "reorder", "ok", "excess", "idle"];

function kMoney(v: number): string {
  if (v >= 1_000_000) return `${n2.format(v / 1_000_000)} ລ້ານ`;
  if (v >= 1_000) return `${n.format(Math.round(v / 1_000))} ພັນ`;
  return n.format(v);
}

export default function CoverageClient() {
  const [wh, setWh] = useState("");
  const [days, setDays] = useState(90);
  const [crit, setCrit] = useState(7);
  const [reorder, setReorder] = useState(14);
  const [excess, setExcess] = useState(60);
  const [data, setData] = useState<Resp | null>(null);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [q, setQ] = useState("");
  // Sets, not single values — a buyer wants "A and B" or "F and S" at
  // once. Empty set = everything.
  const [abcFilter, setAbcFilter] = useState<Set<string>>(new Set());
  const [fsnFilter, setFsnFilter] = useState<Set<string>>(new Set());
  const [sort, setSort] = useState("severity");

  const load = useCallback(
    async (targetWh?: string) => {
      setLoading(true);
      try {
        const p = new URLSearchParams({
          days: String(days),
          crit: String(crit),
          reorder: String(reorder),
          excess: String(excess),
        });
        const w = targetWh ?? wh;
        if (w) p.set("wh", w);
        const res = await fetch(`/api/reports/stock-coverage?${p}`);
        if (res.ok) {
          const d = (await res.json()) as Resp;
          setData(d);
          setWh(d.wh);
        }
      } finally {
        setLoading(false);
      }
    },
    [wh, days, crit, reorder, excess],
  );

  useEffect(() => {
    void load();
    // Initial load only — after that the ວິເຄາະ button drives it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const s = data?.summary;
  const visible = (data?.items ?? [])
    .filter(
      (it) =>
        (statusFilter === "all" || it.status === statusFilter) &&
        (abcFilter.size === 0 || (it.abc !== null && abcFilter.has(it.abc))) &&
        (fsnFilter.size === 0 || fsnFilter.has(it.fsn)) &&
        (!q.trim() ||
          it.code.toLowerCase().includes(q.trim().toLowerCase()) ||
          it.name.toLowerCase().includes(q.trim().toLowerCase())),
    )
    .sort((a, b) => {
      switch (sort) {
        case "refill":
          return b.refillValue - a.refillValue || b.refillQty - a.refillQty;
        case "cover":
          return (a.coverDays ?? 1e9) - (b.coverDays ?? 1e9);
        case "sold":
          return b.sold - a.sold;
        case "revenue":
          return b.revenue - a.revenue;
        case "sunk":
          return b.stockValue - a.stockValue;
        default:
          return 0; // severity — the API's own order
      }
    });

  return (
    <div className="px-4 py-5 sm:px-6">
      <header className="mb-4">
        <h1 className="flex items-center gap-2 text-xl font-black text-odoo-text-strong">
          📈 ວິເຄາະຄວາມພຽງພໍ / Coverage
        </h1>
        <p className="mt-0.5 text-[12.5px] text-odoo-text-muted">
          ຂອງທີ່ຈັດເກັບໄວ້ ພຽງພໍສຳລັບການຂາຍບໍ — ທຽບຄົງເຫຼືອກັບຍອດຂາຍຈິງ ເປັນ
          &quot;ວັນທີ່ພໍໃຊ້&quot;
        </p>
      </header>

      {/* Parameters */}
      <div className="mb-4 rounded-xl border border-odoo-border bg-odoo-surface p-3">
        <div className="flex flex-wrap items-center gap-1.5">
          {(data?.warehouses ?? []).map((w) => (
            <button
              key={w.code}
              type="button"
              onClick={() => void load(w.code)}
              className={
                "rounded-full px-3.5 py-1.5 text-xs font-bold transition " +
                (wh === w.code
                  ? "bg-odoo-primary text-white"
                  : "bg-odoo-surface-muted text-odoo-text hover:bg-odoo-border")
              }
            >
              {w.code} {w.name}
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-end gap-2">
          <label className="text-xs font-bold text-odoo-text-muted">
            ຊ່ວງຂາຍຍ້ອນຫຼັງ
            <select
              value={days}
              onChange={(e) => setDays(Number(e.target.value))}
              className="odoo-input mt-1 !w-auto"
            >
              {[30, 60, 90, 180].map((d) => (
                <option key={d} value={d}>{d} ວັນ</option>
              ))}
            </select>
          </label>
          <label className="text-xs font-bold text-odoo-text-muted">
            ວິກິດ ຕໍ່າກວ່າ (ວັນ)
            <input type="number" min={1} value={crit} onChange={(e) => setCrit(Number(e.target.value) || 7)} className="odoo-input mt-1 !w-20" />
          </label>
          <label className="text-xs font-bold text-odoo-text-muted">
            ສັ່ງຊື້ ຕໍ່າກວ່າ (ວັນ)
            <input type="number" min={1} value={reorder} onChange={(e) => setReorder(Number(e.target.value) || 14)} className="odoo-input mt-1 !w-20" />
          </label>
          <label className="text-xs font-bold text-odoo-text-muted">
            ເກີນ ສູງກວ່າ (ວັນ)
            <input type="number" min={1} value={excess} onChange={(e) => setExcess(Number(e.target.value) || 60)} className="odoo-input mt-1 !w-20" />
          </label>
          <button type="button" onClick={() => void load()} className="odoo-btn odoo-btn-primary">
            ວິເຄາະ
          </button>
        </div>
        <p className="mt-2 text-[11px] text-odoo-text-muted">
          ວັນທີ່ພໍໃຊ້ = ຄົງເຫຼືອ ÷ ຍອດຂາຍສະເລ່ຍ/ມື້ (ຈາກບິນຂາຍຈິງຂອງສາງນີ້) ·
          ຕ້ອງເຕີມ = ໃຫ້ພໍຂາຍຮອດ {reorder} ວັນ
        </p>
      </div>

      {loading ? (
        <div className="rounded-xl border border-odoo-border bg-odoo-surface py-16 text-center text-sm text-odoo-text-muted">
          ກຳລັງວິເຄາະ… (ອາດໃຊ້ເວລາ 5–10 ວິນາທີ)
        </div>
      ) : !s ? (
        <div className="rounded-xl border border-odoo-border bg-odoo-surface py-16 text-center text-sm text-odoo-text-muted">
          ໂຫລດບໍ່ສຳເລັດ
        </div>
      ) : (
        <>
          {/* The reference's headline: not-enough band + fill rate */}
          <div className="mb-3 flex flex-wrap items-center gap-2 rounded-xl border border-rose-200 bg-rose-50/60 px-4 py-2.5">
            <span className="rounded-full border border-rose-300 bg-white px-3 py-1 text-xs font-black text-rose-600">
              ບໍ່ພຽງພໍ — ຕ້ອງເຕີມ
            </span>
            <span className="text-[12.5px] font-semibold text-odoo-text">
              ໃຫ້ບໍລິການໄດ້ <b className="text-rose-600">{s.fillRate}%</b>{" "}
              ຂອງສິນຄ້າທີ່ຂາຍຢູ່ ({n.format(s.selling)} ລາຍການ, ຊ່ວງ {data?.days} ວັນ)
            </span>
          </div>

          {/* Stat cards */}
          <div className="mb-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div className="rounded-xl border border-odoo-border bg-odoo-surface p-3.5">
              <div className="text-[11px] font-bold text-odoo-text-muted">ຕ້ອງເຕີມດ່ວນ</div>
              <div className="font-mono text-2xl font-black text-rose-600">
                {n.format(s.out + s.critical + s.reorder)}{" "}
                <small className="text-xs text-odoo-text-muted">ລາຍການ</small>
              </div>
            </div>
            <div className="rounded-xl border border-odoo-border bg-odoo-surface p-3.5">
              <div className="text-[11px] font-bold text-odoo-text-muted">ມູນຄ່າທີ່ຕ້ອງເຕີມ</div>
              <div className="font-mono text-2xl font-black text-odoo-primary">
                {kMoney(s.refillValue)}{" "}
                <small className="text-xs text-odoo-text-muted">ບາດ</small>
              </div>
            </div>
            <div className="rounded-xl border border-odoo-border bg-odoo-surface p-3.5">
              <div className="text-[11px] font-bold text-odoo-text-muted">ເກີນ / ບໍ່ເຄື່ອນໄຫວ</div>
              <div className="font-mono text-2xl font-black text-odoo-text-strong">
                {n.format(s.excess + s.idle)}{" "}
                <small className="text-xs text-odoo-text-muted">ລາຍການ</small>
              </div>
            </div>
            <div className="rounded-xl border border-odoo-border bg-odoo-surface p-3.5">
              <div className="text-[11px] font-bold text-odoo-text-muted">ເງິນຈົມ (ເກີນ+ນິ້ງ)</div>
              <div className="font-mono text-2xl font-black text-sky-700">
                {kMoney(s.sunkValue)}{" "}
                <small className="text-xs text-odoo-text-muted">ບາດ</small>
              </div>
            </div>
          </div>

          {/* Stacked segment bar + legend chips (the legend IS the filter) */}
          <div className="mb-3 rounded-xl border border-odoo-border bg-odoo-surface p-3">
            <div className="flex h-3 overflow-hidden rounded-full bg-slate-100">
              {ORDER.map((st) =>
                s[st] > 0 ? (
                  <div
                    key={st}
                    className={ST[st].bar}
                    style={{ width: `${(s[st] / Math.max(1, s.total)) * 100}%` }}
                    title={`${ST[st].label} ${s[st]}`}
                  />
                ) : null,
              )}
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => setStatusFilter("all")}
                className={
                  "rounded-full px-3 py-1 text-[11.5px] font-black transition " +
                  (statusFilter === "all"
                    ? "bg-slate-900 text-white"
                    : "bg-odoo-surface-muted text-odoo-text")
                }
              >
                ທັງໝົດ {n.format(s.total)}
              </button>
              {ORDER.map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => setStatusFilter(statusFilter === st ? "all" : st)}
                  className={
                    "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[11.5px] font-bold transition " +
                    (statusFilter === st
                      ? "bg-slate-900 text-white"
                      : "bg-odoo-surface-muted text-odoo-text hover:bg-odoo-border")
                  }
                >
                  <span className={`h-2 w-2 rounded-full ${ST[st].dot}`} />
                  {ST[st].label} {n.format(s[st])}
                </button>
              ))}
              <span className="ml-auto flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-odoo-surface-muted p-1">
                  <span className="pl-2 text-[10px] font-black text-odoo-text-soft">ABC</span>
                  {(["A", "B", "C"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      title={v === "A" ? "A — 80% ຂອງລາຍຮັບ" : v === "B" ? "B — ຮອດ 95%" : "C — ສ່ວນຫາງ"}
                      onClick={() =>
                        setAbcFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(v)) next.delete(v);
                          else next.add(v);
                          return next;
                        })
                      }
                      className={
                        "h-7 w-7 rounded-full text-[11px] font-black transition " +
                        (abcFilter.has(v)
                          ? "bg-odoo-primary text-white"
                          : "text-odoo-text-muted hover:bg-odoo-border")
                      }
                    >
                      {v}
                    </button>
                  ))}
                </span>
                <span className="inline-flex items-center gap-1 rounded-full bg-odoo-surface-muted p-1">
                  <span className="pl-2 text-[10px] font-black text-odoo-text-soft">FSN</span>
                  {(["F", "S", "N"] as const).map((v) => (
                    <button
                      key={v}
                      type="button"
                      title={v === "F" ? "F — ຂາຍໄວ (30 ວັນ)" : v === "S" ? "S — ຂາຍຊ້າ" : "N — ບໍ່ຂາຍໃນຊ່ວງ"}
                      onClick={() =>
                        setFsnFilter((prev) => {
                          const next = new Set(prev);
                          if (next.has(v)) next.delete(v);
                          else next.add(v);
                          return next;
                        })
                      }
                      className={
                        "h-7 w-7 rounded-full text-[11px] font-black transition " +
                        (fsnFilter.has(v)
                          ? "bg-odoo-primary text-white"
                          : "text-odoo-text-muted hover:bg-odoo-border")
                      }
                    >
                      {v}
                    </button>
                  ))}
                </span>
                <select value={sort} onChange={(e) => setSort(e.target.value)} className="odoo-input !w-auto">
                  <option value="severity">ຮ້າຍແຮງກ່ອນ</option>
                  <option value="refill">ຕ້ອງເຕີມຫຼາຍ</option>
                  <option value="cover">ວັນພໍໃຊ້ໜ້ອຍ</option>
                  <option value="sold">ຂາຍຫຼາຍ</option>
                  <option value="revenue">ລາຍຮັບສູງ</option>
                  <option value="sunk">ເງິນຈົມຫຼາຍ</option>
                </select>
                <input
                  type="search"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="ຄົ້ນຫາ ລະຫັດ / ຊື່…"
                  className="odoo-input !w-48"
                />
              </span>
            </div>
          </div>

          {/* WMS vs ERP disagreement — count before ordering. */}
          {s.wmsCompared > 0 && s.wmsMismatch > 0 ? (
            <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50/70 px-4 py-2.5 text-[12px] font-semibold text-amber-800">
              ຍອດ WMS ກັບ ERP ບໍ່ກົງກັນ{" "}
              <b>{Math.round((s.wmsMismatch / s.wmsCompared) * 100)}%</b> (
              {n.format(s.wmsMismatch)} / {n.format(s.wmsCompared)} ລາຍການທີ່ທຽບໄດ້) —
              ລາຍການທີ່ມີໝາຍ <b>WMS ຕ່າງ</b> ຄວນນັບກວດກ່ອນຕັດສິນສັ່ງຊື້
            </div>
          ) : null}

          {/* Items */}
          <div className="overflow-x-auto rounded-xl border border-odoo-border bg-odoo-surface">
            <table className="w-full text-sm">
              <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
                <tr>
                  <th className="px-3 py-2">ສະຖານະ</th>
                  <th className="px-3 py-2">ສິນຄ້າ</th>
                  <th className="px-3 py-2 text-right">ຄົງເຫຼືອ</th>
                  <th className="px-3 py-2 text-right">ຂາຍ {data?.days} ວັນ</th>
                  <th className="px-3 py-2 text-right">ຂາຍລ່າສຸດ</th>
                  <th className="px-3 py-2 text-right">ສະເລ່ຍ/ມື້</th>
                  <th className="px-3 py-2 text-right">ວັນທີ່ພໍໃຊ້</th>
                  <th className="px-3 py-2 text-right">ຕ້ອງເຕີມ</th>
                  <th className="px-3 py-2 text-right">WMS</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-odoo-border">
                {visible.slice(0, 500).map((it) => (
                  <tr key={it.code} className="hover:bg-odoo-surface-muted/50">
                    <td className="px-3 py-2">
                      <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold ${ST[it.status].pill}`}>
                        <span className={`h-1.5 w-1.5 rounded-full ${ST[it.status].dot}`} />
                        {ST[it.status].label}
                      </span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="max-w-md truncate font-bold text-odoo-text-strong">{it.name}</div>
                      <div className="flex items-center gap-1.5 font-mono text-[11px] text-odoo-text-muted">
                        {it.code}
                        {it.abc ? (
                          <span className={`rounded px-1 text-[9px] font-black ${it.abc === "A" ? "bg-indigo-100 text-indigo-700" : it.abc === "B" ? "bg-slate-100 text-slate-600" : "bg-slate-50 text-slate-400"}`}>
                            {it.abc}
                          </span>
                        ) : null}
                        <span className={`rounded px-1 text-[9px] font-black ${it.fsn === "F" ? "bg-emerald-50 text-emerald-600" : it.fsn === "S" ? "bg-amber-50 text-amber-600" : "bg-slate-50 text-slate-400"}`}>
                          {it.fsn}
                        </span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-right font-mono font-bold">
                      {n2.format(it.balance)}{" "}
                      <small className="text-odoo-text-muted">{it.unit}</small>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {n2.format(it.sold)}
                      <small className="block text-[10px] text-odoo-text-muted">{it.bills} ບິນ</small>
                    </td>
                    <td className="px-3 py-2 text-right text-[12px] text-odoo-text-muted">
                      {it.lastSale ? fmtDate(it.lastSale) : "—"}
                    </td>
                    <td className="px-3 py-2 text-right font-mono">{n2.format(it.avgDay)}</td>
                    <td className={`px-3 py-2 text-right font-mono font-black ${
                      it.coverDays === null
                        ? "text-odoo-text-muted"
                        : it.status === "out" || it.status === "critical"
                          ? "text-rose-600"
                          : it.status === "reorder"
                            ? "text-amber-600"
                            : "text-odoo-text-strong"
                    }`}>
                      {it.coverDays === null ? "—" : n2.format(it.coverDays)}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {it.refillQty > 0 ? (
                        <>
                          <b className="font-mono text-rose-600">{n.format(it.refillQty)}</b>{" "}
                          <small className="text-odoo-text-muted">{it.unit}</small>
                          <small className="block text-[10px] text-odoo-text-muted">
                            ≈ {kMoney(it.refillValue)} ບາດ
                          </small>
                        </>
                      ) : (
                        <span className="text-odoo-text-muted">—</span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {it.wmsQty === null ? (
                        <span className="text-[11px] text-odoo-text-muted">—</span>
                      ) : it.wmsDiff ? (
                        <span
                          className="rounded bg-amber-50 px-1.5 py-0.5 font-mono text-[11px] font-bold text-amber-700"
                          title={`WMS ${n2.format(it.wmsQty)} · ERP ${n2.format(it.balance)}`}
                        >
                          ⚠ {n2.format(it.wmsQty)}
                        </span>
                      ) : (
                        <span className="text-[11px] font-bold text-emerald-600">✓</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {visible.length > 500 ? (
              <p className="border-t border-odoo-border px-3 py-2 text-center text-[11px] text-odoo-text-muted">
                ສະແດງ 500 ຈາກ {n.format(visible.length)} — ໃຊ້ຕົວກອງ/ຄົ້ນຫາເພື່ອແຄບລົງ
              </p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}
