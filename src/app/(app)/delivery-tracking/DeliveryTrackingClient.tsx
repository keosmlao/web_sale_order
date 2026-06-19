"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DeliveryMap, { type Truck, type MapFocus } from "./DeliveryMap";

type Status = "opened" | "scheduled" | "inprogress" | "done" | "cancelled";

type BillItem = {
  billNo: string;
  billDate: string | null;
  customerName: string;
  telephone: string | null;
  saleCode: string | null;
  salespersonName: string;
  roundCode: string | null;
  roundName: string;
  timeLabel: string | null;
  car: string;
  driverName: string;
  driverTel: string | null;
  status: Status;
  sentEnd: string | null;
  lat: number | null;
  lng: number | null;
};

type ListResp = {
  date: string;
  scope: "own" | "all";
  summary: {
    total: number;
    opened: number;
    scheduled: number;
    inprogress: number;
    done: number;
    cancelled: number;
  };
  items: BillItem[];
};

type Step = { at: string | null; label: string; remark: string | null };
type BillDetail = {
  billNo: string;
  customerName: string;
  telephone: string | null;
  salespersonName: string;
  roundName: string;
  timeLabel: string | null;
  routeName: string | null;
  car: string;
  driverName: string;
  driverTel: string | null;
  status: Status;
  lat: number | null;
  lng: number | null;
  steps: Step[];
};

const STATUS: Record<Status, { label: string; cls: string }> = {
  opened: { label: "ເປີດບິນ", cls: "bg-slate-100 text-slate-600 border-slate-200" },
  scheduled: { label: "ນັດສົ່ງ", cls: "bg-sky-50 text-sky-700 border-sky-200" },
  inprogress: { label: "ກຳລັງສົ່ງ", cls: "bg-amber-50 text-amber-700 border-amber-200" },
  done: { label: "ສຳເລັດ", cls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  cancelled: { label: "ຍົກເລີກ", cls: "bg-rose-50 text-rose-700 border-rose-200" },
};

function todayLocal(): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}
function fmtAt(at: string | null): string {
  if (!at) return "—";
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return at;
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${p(d.getDate())}/${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export default function DeliveryTrackingClient({
  canSeeAll,
}: {
  canSeeAll: boolean;
}) {
  const [date, setDate] = useState(todayLocal());
  const [round, setRound] = useState("");
  const [scope, setScope] = useState<"own" | "all">("own");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BillDetail | null>(null);
  const [focus, setFocus] = useState<MapFocus>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ date, scope });
      if (round) params.set("round", round);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/tms/deliveries?${params.toString()}`);
      if (res.ok) setData((await res.json()) as ListResp);
    } finally {
      setLoading(false);
    }
  }, [date, scope, round, q]);

  useEffect(() => {
    void loadList();
  }, [loadList]);

  // Trucks: load now + refresh every 30s.
  useEffect(() => {
    let cancelled = false;
    const pull = async () => {
      try {
        const res = await fetch("/api/tms/gps");
        if (res.ok && !cancelled) {
          const j = await res.json();
          setTrucks((j.trucks ?? []) as Truck[]);
        }
      } catch {
        /* ignore */
      }
    };
    void pull();
    const id = window.setInterval(pull, 30_000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, []);

  async function openBill(billNo: string) {
    setSelected(billNo);
    setDetail(null);
    try {
      const res = await fetch(`/api/tms/deliveries/${encodeURIComponent(billNo)}`);
      if (res.ok) {
        const d = (await res.json()) as BillDetail;
        setDetail(d);
        if (d.lat != null && d.lng != null) {
          setFocus({ lat: d.lat, lng: d.lng, label: `${d.billNo} · ${d.customerName}` });
        }
      }
    } catch {
      /* ignore */
    }
  }

  const roundOptions = useMemo(() => {
    const m = new Map<string, string>();
    for (const it of data?.items ?? []) {
      if (it.roundCode) m.set(it.roundCode, it.roundName);
    }
    return [...m.entries()];
  }, [data]);

  const s = data?.summary;

  return (
    <div className="px-4 py-6 sm:px-6">
      <header className="mb-4">
        <div className="odoo-label">ຕິດຕາມຂົນສົ່ງ</div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">ງານຂົນສົ່ງ</h1>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="odoo-label">ວັນທີ່</span>
          <input
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="odoo-input"
          />
        </label>
        <label className="text-sm">
          <span className="odoo-label">ຮອບ</span>
          <select value={round} onChange={(e) => setRound(e.target.value)} className="odoo-input">
            <option value="">ທັງໝົດ</option>
            {roundOptions.map(([code, name]) => (
              <option key={code} value={code}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="min-w-[180px] flex-1 text-sm">
          <span className="odoo-label">ຄົ້ນຫາ (ບິນ / ລູກຄ້າ)</span>
          <input
            type="text"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="ບິນ ຫຼື ຊື່ລູກຄ້າ"
            className="odoo-input"
          />
        </label>
        {canSeeAll ? (
          <div className="flex overflow-hidden rounded-md border border-odoo-border text-sm">
            <button
              type="button"
              onClick={() => setScope("own")}
              className={`px-3 py-2 font-bold ${scope === "own" ? "bg-odoo-primary text-white" : "bg-odoo-surface"}`}
            >
              ຂອງຂ້ອຍ
            </button>
            <button
              type="button"
              onClick={() => setScope("all")}
              className={`px-3 py-2 font-bold ${scope === "all" ? "bg-odoo-primary text-white" : "bg-odoo-surface"}`}
            >
              ທັງໝົດ
            </button>
          </div>
        ) : null}
        <button type="button" onClick={() => void loadList()} className="odoo-btn odoo-btn-secondary">
          ໂຫຼດໃໝ່
        </button>
      </div>

      {/* Summary */}
      {s ? (
        <div className="mb-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
          <SummaryChip label="ທັງໝົດ" value={s.total} cls="text-odoo-text-strong" />
          <SummaryChip label="ເປີດບິນ" value={s.opened} cls="text-slate-500" />
          <SummaryChip label="ນັດສົ່ງ" value={s.scheduled} cls="text-sky-600" />
          <SummaryChip label="ກຳລັງສົ່ງ" value={s.inprogress} cls="text-amber-600" />
          <SummaryChip label="ສຳເລັດ" value={s.done} cls="text-emerald-600" />
          <SummaryChip label="ຍົກເລີກ" value={s.cancelled} cls="text-rose-600" />
        </div>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,460px)]">
        {/* Bill list */}
        <div className="rounded-md border border-odoo-border bg-odoo-surface">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-odoo-surface-muted text-left text-xs font-bold uppercase text-odoo-text-muted">
                <tr>
                  <th className="px-3 py-2">ບິນ / ລູກຄ້າ</th>
                  <th className="px-3 py-2">ຮອບ / ລົດ</th>
                  <th className="px-3 py-2 text-right">ສະຖານະ</th>
                </tr>
              </thead>
              <tbody>
                {loading ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-odoo-text-muted">
                      ກຳລັງໂຫຼດ...
                    </td>
                  </tr>
                ) : (data?.items.length ?? 0) === 0 ? (
                  <tr>
                    <td colSpan={3} className="px-3 py-8 text-center text-odoo-text-muted">
                      ບໍ່ມີຂໍ້ມູນຂົນສົ່ງ
                    </td>
                  </tr>
                ) : (
                  data!.items.map((it) => (
                    <tr
                      key={it.billNo}
                      onClick={() => void openBill(it.billNo)}
                      className={`cursor-pointer border-t border-odoo-border hover:bg-odoo-primary-50 ${selected === it.billNo ? "bg-odoo-primary-50" : ""}`}
                    >
                      <td className="px-3 py-2">
                        <div className="font-mono text-xs font-bold text-odoo-text-strong">{it.billNo}</div>
                        <div className="text-odoo-text">{it.customerName}</div>
                      </td>
                      <td className="px-3 py-2 text-xs text-odoo-text-muted">
                        <div>{it.roundName}</div>
                        <div>{it.car} · {it.driverName}</div>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className={`inline-block rounded border px-2 py-0.5 text-[11px] font-bold ${STATUS[it.status].cls}`}>
                          {STATUS[it.status].label}
                        </span>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Map + timeline */}
        <div className="flex flex-col gap-4">
          <div className="h-[320px] overflow-hidden rounded-md border border-odoo-border bg-odoo-surface-muted">
            <DeliveryMap trucks={trucks} focus={focus} />
          </div>

          {selected ? (
            <div className="rounded-md border border-odoo-border bg-odoo-surface p-4">
              {!detail ? (
                <div className="py-6 text-center text-odoo-text-muted">ກຳລັງໂຫຼດ...</div>
              ) : (
                <>
                  <div className="mb-3 flex items-start justify-between gap-2">
                    <div>
                      <div className="font-mono text-xs font-bold text-odoo-text-strong">{detail.billNo}</div>
                      <div className="text-sm font-bold">{detail.customerName}</div>
                      <div className="text-xs text-odoo-text-muted">
                        {detail.roundName}
                        {detail.routeName ? ` · ${detail.routeName}` : ""} · {detail.car} · {detail.driverName}
                        {detail.driverTel ? ` (${detail.driverTel})` : ""}
                      </div>
                    </div>
                    <span className={`shrink-0 rounded border px-2 py-0.5 text-[11px] font-bold ${STATUS[detail.status].cls}`}>
                      {STATUS[detail.status].label}
                    </span>
                  </div>
                  <ol className="relative ml-2 border-l border-odoo-border">
                    {detail.steps.length === 0 ? (
                      <li className="ml-4 py-2 text-sm text-odoo-text-muted">ຍັງບໍ່ມີຄວາມເຄື່ອນໄຫວ</li>
                    ) : (
                      detail.steps.map((st, i) => (
                        <li key={i} className="ml-4 py-2">
                          <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-odoo-primary" />
                          <div className="text-sm font-bold text-odoo-text-strong">{st.label}</div>
                          <div className="text-xs text-odoo-text-muted">{fmtAt(st.at)}</div>
                          {st.remark ? <div className="text-xs text-odoo-text">{st.remark}</div> : null}
                        </li>
                      ))
                    )}
                  </ol>
                </>
              )}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function SummaryChip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="rounded-md border border-odoo-border bg-odoo-surface px-3 py-2">
      <div className="text-[11px] font-bold uppercase text-odoo-text-muted">{label}</div>
      <div className={`font-mono text-xl font-black ${cls}`}>{value}</div>
    </div>
  );
}
