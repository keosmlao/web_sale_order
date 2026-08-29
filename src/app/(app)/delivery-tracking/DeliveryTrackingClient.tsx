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
  carCode: string | null;
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
  const [from, setFrom] = useState(todayLocal());
  const [to, setTo] = useState(todayLocal());
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [round, setRound] = useState("");
  // Managers open the shared delivery queue by default. Storefront bills may
  // belong to another cashier, so defaulting to "own" hid valid delivery jobs.
  const [scope, setScope] = useState<"own" | "all">(canSeeAll ? "all" : "own");
  const [q, setQ] = useState("");
  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BillDetail | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, scope });
      if (round) params.set("round", round);
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/tms/deliveries?${params.toString()}`);
      if (res.ok) setData((await res.json()) as ListResp);
    } finally {
      setLoading(false);
    }
  }, [from, to, scope, round, q]);

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
  const visibleBills = useMemo(
    () =>
      (data?.items ?? []).filter(
        (item) => statusFilter === "all" || item.status === statusFilter,
      ),
    [data, statusFilter],
  );
  const waitingBills = useMemo(
    () => (data?.items ?? []).filter(
      (item) => item.status === "opened" || item.status === "scheduled",
    ),
    [data],
  );

  // The map is an operational view: only vehicles assigned to bills that are
  // currently on a delivery trip are visible. Open/scheduled/completed bills
  // must not make unrelated fleet vehicles appear here.
  const activeCarCodes = useMemo(
    () => new Set(
      (data?.items ?? [])
        .filter((item) => item.status === "inprogress" && item.carCode)
        .map((item) => item.carCode!.trim()),
    ),
    [data],
  );
  const activeTrucks = useMemo(
    () => trucks
      .filter((truck) => truck.carCode && activeCarCodes.has(truck.carCode.trim()))
      .map((truck) => ({
        ...truck,
        billNos: (data?.items ?? [])
          .filter(
            (item) => item.status === "inprogress"
              && item.carCode?.trim() === truck.carCode?.trim(),
          )
          .map((item) => item.billNo),
      })),
    [trucks, activeCarCodes, data],
  );
  const focus = useMemo<MapFocus>(() => {
    if (!selected) return null;
    const bill = data?.items.find((item) => item.billNo === selected);
    if (!bill?.carCode || bill.status !== "inprogress") return null;
    const truck = activeTrucks.find((item) => item.carCode?.trim() === bill.carCode?.trim());
    if (!truck) return null;
    return {
      lat: truck.lat,
      lng: truck.lng,
      label: `${bill.billNo} · ${truck.carName}`,
    };
  }, [activeTrucks, data, selected]);

  return (
    <div className="px-4 py-6 sm:px-6">
      <header className="mb-4">
        <div className="odoo-label">ຕິດຕາມຂົນສົ່ງ</div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">ງານຂົນສົ່ງ</h1>
      </header>

      {/* Filters */}
      <div className="mb-4 flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="odoo-label">ຈາກວັນທີ</span>
          <input
            type="date"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            className="odoo-input"
          />
        </label>
        <label className="text-sm">
          <span className="odoo-label">ເຖິງວັນທີ</span>
          <input
            type="date"
            value={to}
            onChange={(e) => setTo(e.target.value)}
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

      {s ? (
        <div className="mb-5 grid grid-cols-2 overflow-hidden rounded-lg border border-odoo-border bg-odoo-border lg:grid-cols-4">
          <SummaryChip label="ບິນຄ້າງສົ່ງ" value={s.total} cls="text-odoo-text-strong" />
          <SummaryChip label="ລົດກຳລັງແລ່ນ" value={activeTrucks.length} cls="text-emerald-600" />
          <SummaryChip label="ບິນກຳລັງສົ່ງ" value={s.inprogress} cls="text-amber-600" />
          <SummaryChip label="ລໍຖ້າຈັດສົ່ງ" value={s.opened + s.scheduled} cls="text-sky-600" />
        </div>
      ) : null}

      {/* Status chips, counts in colour — one tap filters the bill list. */}
      {s ? (
        <div className="mb-4 flex flex-wrap gap-1.5">
          {(
            [
              ["all", "ທັງໝົດ", s.total, "text-odoo-text-strong"],
              ["opened", "ເປີດບິນແລ້ວ", s.opened, "text-slate-600"],
              ["scheduled", "ນັດສົ່ງ", s.scheduled, "text-sky-600"],
              ["inprogress", "ກຳລັງຈັດສົ່ງ", s.inprogress, "text-amber-600"],
              ["done", "ສົ່ງສຳເລັດ", s.done, "text-emerald-600"],
              ["cancelled", "ຍົກເລີກ", s.cancelled, "text-rose-600"],
            ] as Array<[Status | "all", string, number, string]>
          ).map(([value, label, count, tone]) => (
            <button
              key={value}
              type="button"
              onClick={() => setStatusFilter(value)}
              className={
                "rounded-full border px-3.5 py-1.5 text-xs font-bold transition " +
                (statusFilter === value
                  ? "border-odoo-primary bg-odoo-primary text-white"
                  : "border-odoo-border bg-odoo-surface hover:bg-odoo-surface-muted")
              }
            >
              {label}{" "}
              <b className={statusFilter === value ? "" : tone}>{count}</b>
            </button>
          ))}
        </div>
      ) : null}

      {/* Live operations: vehicle list controls the large GPS map. */}
      <section className="mb-5 overflow-hidden rounded-xl border border-odoo-border bg-odoo-surface shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-odoo-border px-4 py-3">
          <div>
            <h2 className="font-black text-odoo-text-strong">ຕຳແໜ່ງລົດກຳລັງຈັດສົ່ງ</h2>
            <p className="text-xs text-odoo-text-muted">ອັບເດດຕຳແໜ່ງ GPS ອັດຕະໂນມັດທຸກ 30 ວິນາທີ</p>
          </div>
          <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
            LIVE · {activeTrucks.length} ຄັນ
          </span>
        </div>
        <div className="grid lg:grid-cols-[minmax(0,1fr)_380px]">
          <div className="relative h-[440px] border-b border-odoo-border bg-odoo-surface-muted lg:h-[560px] lg:border-b-0 lg:border-r">
            <DeliveryMap trucks={activeTrucks} focus={focus} />
          </div>
          <div className="flex h-[560px] flex-col">
            <div className="flex items-center justify-between border-b border-odoo-border px-4 py-3">
              <div>
                <h3 className="text-sm font-black text-odoo-text-strong">ບິນຄ້າງສົ່ງ</h3>
                <p className="text-xs text-odoo-text-muted">ລໍຖ້າ {waitingBills.length} · ກຳລັງສົ່ງ {s?.inprogress ?? 0}</p>
              </div>
              <span className="font-mono text-lg font-black text-odoo-primary">{visibleBills.length}</span>
            </div>
            <div className="flex-1 overflow-y-auto">
              {loading ? (
                <div className="py-12 text-center text-sm text-odoo-text-muted">ກຳລັງໂຫຼດ...</div>
              ) : visibleBills.length === 0 ? (
                <div className="py-12 text-center text-sm text-odoo-text-muted">
                  <div className="text-2xl">🚚</div>
                  <div className="mt-1 font-bold">ບໍ່ມີບິນໃນເງື່ອນໄຂນີ້</div>
                  <div className="text-xs">ລອງຂະຫຍາຍຊ່ວງວັນທີ ຫຼື ເລືອກສະຖານະອື່ນ</div>
                </div>
              ) : (
                visibleBills.map((bill) => (
                  <button
                    key={bill.billNo}
                    type="button"
                    onClick={() => void openBill(bill.billNo)}
                    className={`flex w-full items-start gap-3 border-b border-odoo-border px-4 py-3 text-left transition hover:bg-odoo-surface-muted ${selected === bill.billNo ? "bg-odoo-primary-50" : ""}`}
                  >
                    <span className={`mt-1.5 h-2.5 w-2.5 shrink-0 rounded-full ${bill.status === "inprogress" ? "bg-emerald-500" : bill.status === "scheduled" ? "bg-sky-500" : "bg-slate-300"}`} />
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs font-black text-odoo-text-strong">{bill.billNo}</span>
                        <span className="shrink-0 text-[10px] font-bold text-odoo-text-muted">{STATUS[bill.status].label}</span>
                      </span>
                      <span className="mt-0.5 block truncate text-sm font-bold text-odoo-text">{bill.customerName}</span>
                      <span className="mt-1 flex justify-between gap-2 text-[11px] text-odoo-text-muted">
                        <span>{bill.status === "inprogress" ? `${bill.car} · ${bill.driverName}` : bill.roundName}</span>
                        <span>{bill.billDate || "—"}</span>
                      </span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </section>

      <div>
        <aside>
          {selected ? (
            <div className="rounded-xl border border-odoo-border bg-odoo-surface p-4 shadow-sm">
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
          ) : (
            <div className="rounded-lg border border-dashed border-odoo-border bg-odoo-surface-muted p-6 text-center">
              <div className="font-bold text-odoo-text-strong">ເລືອກບິນຈັດສົ່ງ</div>
              <p className="mt-1 text-xs text-odoo-text-muted">ລາຍລະອຽດຖ້ຽວລົດ ແລະ timeline ຈະສະແດງຢູ່ນີ້</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  );
}

function SummaryChip({ label, value, cls }: { label: string; value: number; cls: string }) {
  return (
    <div className="bg-odoo-surface px-4 py-3">
      <div className="text-xs font-bold text-odoo-text-muted">{label}</div>
      <div className={`mt-1 font-mono text-2xl font-black ${cls}`}>{value}</div>
    </div>
  );
}
