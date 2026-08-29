"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import DeliveryMap, { type Truck, type MapFocus } from "./DeliveryMap";
import { fmtDateTime } from "@/lib/datetime";

// ຂົນສົ່ງ — rebuilt on the owner's TMS-console reference. Three tabs:
// the unfinished queue, the finished bills, and the live map. One header
// card carries the search, the date range and the refresh; the statuses
// are one-tap chips with coloured counts, and the right edge keeps the
// three figures a dispatcher actually watches — unfinished, on the road,
// and stuck past 7 days.

type Status = "opened" | "scheduled" | "inprogress" | "done" | "cancelled";

type BillItem = {
  billNo: string;
  billDate: string | null;
  billDateIso: string | null;
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
  from: string;
  to: string;
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
  steps: Step[];
};

const STATUS: Record<Status, { label: string; badge: string; count: string }> =
  {
    opened: {
      label: "ເປີດບິນແລ້ວ",
      badge: "bg-slate-100 text-slate-600",
      count: "text-slate-600",
    },
    scheduled: {
      label: "ນັດສົ່ງ",
      badge: "bg-sky-50 text-sky-700",
      count: "text-sky-600",
    },
    inprogress: {
      label: "ກຳລັງຈັດສົ່ງ",
      badge: "bg-amber-50 text-amber-700",
      count: "text-amber-600",
    },
    done: {
      label: "ສົ່ງສຳເລັດ",
      badge: "bg-emerald-50 text-emerald-700",
      count: "text-emerald-600",
    },
    cancelled: {
      label: "ຍົກເລີກ",
      badge: "bg-rose-50 text-rose-600",
      count: "text-rose-600",
    },
  };

const OPEN_STATUSES: Status[] = ["opened", "scheduled", "inprogress"];
const DONE_STATUSES: Status[] = ["done", "cancelled"];

function localDate(daysAgo = 0): string {
  const d = new Date(Date.now() + 7 * 3600 * 1000 - daysAgo * 86400_000);
  return d.toISOString().slice(0, 10);
}

export default function DeliveryTrackingClient({
  canSeeAll,
}: {
  canSeeAll: boolean;
}) {
  // The reference opens on a wide window — a queue is judged over weeks,
  // not a single day.
  const [from, setFrom] = useState(() => localDate(90));
  const [to, setTo] = useState(() => localDate());
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<"own" | "all">(canSeeAll ? "all" : "own");
  const [tab, setTab] = useState<"open" | "done" | "map">("open");
  const [statusFilter, setStatusFilter] = useState<Status | "all">("all");
  const [data, setData] = useState<ListResp | null>(null);
  const [loading, setLoading] = useState(true);
  const [trucks, setTrucks] = useState<Truck[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<BillDetail | null>(null);

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ from, to, scope });
      if (q.trim()) params.set("q", q.trim());
      const res = await fetch(`/api/tms/deliveries?${params.toString()}`);
      if (res.ok) setData((await res.json()) as ListResp);
    } finally {
      setLoading(false);
    }
  }, [from, to, scope, q]);

  useEffect(() => {
    const t = setTimeout(() => void loadList(), q ? 300 : 0);
    return () => clearTimeout(t);
  }, [loadList, q]);

  // Trucks feed the map tab; refreshed every 30s while the page is open.
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
    if (selected === billNo) {
      setSelected(null);
      return;
    }
    setSelected(billNo);
    setDetail(null);
    try {
      const res = await fetch(
        `/api/tms/deliveries/${encodeURIComponent(billNo)}`,
      );
      if (res.ok) setDetail((await res.json()) as BillDetail);
    } catch {
      /* ignore */
    }
  }

  const s = data?.summary;
  const items = useMemo(() => data?.items ?? [], [data]);

  // ຄ້າງເກີນ 7 ວັນ — unfinished bills whose bill date is older than a week.
  // "Now" is pinned at mount: render stays pure, and a page left open a
  // few minutes does not need its overdue line re-judged live.
  const [mountedAt] = useState(() => Date.now());
  const overdue = useMemo(() => {
    const limit = mountedAt - 7 * 86400_000;
    return items.filter(
      (b) =>
        OPEN_STATUSES.includes(b.status) &&
        b.billDateIso &&
        new Date(b.billDateIso).getTime() < limit,
    ).length;
  }, [items, mountedAt]);

  const tabItems = useMemo(
    () =>
      items.filter((b) =>
        tab === "done"
          ? DONE_STATUSES.includes(b.status)
          : OPEN_STATUSES.includes(b.status),
      ),
    [items, tab],
  );
  const visible = useMemo(
    () =>
      tabItems.filter(
        (b) => statusFilter === "all" || b.status === statusFilter,
      ),
    [tabItems, statusFilter],
  );

  // Map: only trucks carrying bills that are on the road right now.
  const activeTrucks = useMemo(() => {
    const carBills = new Map<string, string[]>();
    for (const b of items) {
      if (b.status === "inprogress" && b.carCode) {
        const key = b.carCode.trim();
        carBills.set(key, [...(carBills.get(key) ?? []), b.billNo]);
      }
    }
    return trucks
      .filter((t) => t.carCode && carBills.has(t.carCode.trim()))
      .map((t) => ({ ...t, billNos: carBills.get(t.carCode!.trim()) ?? [] }));
  }, [trucks, items]);

  const focus = useMemo<MapFocus>(() => {
    if (!selected) return null;
    const bill = items.find((b) => b.billNo === selected);
    if (!bill?.carCode || bill.status !== "inprogress") return null;
    const truck = activeTrucks.find(
      (t) => t.carCode?.trim() === bill.carCode?.trim(),
    );
    return truck
      ? {
          lat: truck.lat,
          lng: truck.lng,
          label: `${bill.billNo} · ${truck.carName}`,
        }
      : null;
  }, [activeTrucks, items, selected]);

  const chipDefs: Array<[Status | "all", string, number]> = s
    ? tab === "done"
      ? [
          ["all", "ທັງໝົດ", s.done + s.cancelled],
          ["done", STATUS.done.label, s.done],
          ["cancelled", STATUS.cancelled.label, s.cancelled],
        ]
      : [
          ["all", "ທັງໝົດ", s.opened + s.scheduled + s.inprogress],
          ["opened", STATUS.opened.label, s.opened],
          ["scheduled", STATUS.scheduled.label, s.scheduled],
          ["inprogress", STATUS.inprogress.label, s.inprogress],
        ]
    : [];

  return (
    <div className="px-4 py-5 sm:px-6">
      {/* ── Tabs ── */}
      <div className="mb-3 flex w-fit gap-1 rounded-full bg-odoo-surface p-1 shadow-sm">
        {(
          [
            ["open", "🧾 ບິນຍັງບໍ່ສຳເລັດ"],
            ["done", "✅ ບິນສຳເລັດ"],
            ["map", "🗺 ແຜນທີ"],
          ] as const
        ).map(([value, label]) => (
          <button
            key={value}
            type="button"
            onClick={() => {
              setTab(value);
              setStatusFilter("all");
            }}
            className={
              "rounded-full px-4 py-2 text-sm font-bold transition " +
              (tab === value
                ? "bg-odoo-primary text-white shadow"
                : "text-odoo-text-muted hover:text-odoo-text")
            }
          >
            {label}
          </button>
        ))}
      </div>

      {/* ── Header card: title, search, range, refresh ── */}
      <div className="mb-3 rounded-2xl border border-odoo-border bg-odoo-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h1 className="flex flex-wrap items-center gap-2 text-lg font-black text-odoo-text-strong">
              {tab === "done" ? "ບິນສົ່ງສຳເລັດ" : "ບິນຍັງສົ່ງບໍ່ສຳເລັດ"}
              {tab !== "done" ? (
                <span className="rounded-full bg-amber-100 px-2.5 py-0.5 text-[11px] font-bold text-amber-700">
                  ບິນທີ່ຄ້າງສົ່ງ
                </span>
              ) : null}
            </h1>
            <p className="mt-0.5 text-[12px] text-odoo-text-muted">
              ບິນຂາຍທີ່ມີການຈັດສົ່ງ — ສະຖານະຕິດຕາມຮ່ວມກັບ TMS
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="🔍 ຄົ້ນຫາ ເລກບິນ / ລູກຄ້າ"
              className="odoo-input w-52"
            />
            <input
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="odoo-input !w-auto"
            />
            <input
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="odoo-input !w-auto"
            />
            <button
              type="button"
              onClick={() => void loadList()}
              className="odoo-btn odoo-btn-primary"
            >
              ⟳ ອັບເດດ
            </button>
          </div>
        </div>

        {/* Chips + the dispatcher's three figures */}
        {s && tab !== "map" ? (
          <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-odoo-border pt-3">
            <div className="flex flex-wrap items-center gap-1.5">
              {chipDefs.map(([value, label, count]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => setStatusFilter(value)}
                  className={
                    "rounded-full px-3 py-1.5 text-xs font-bold transition " +
                    (statusFilter === value
                      ? "bg-odoo-primary text-white"
                      : "bg-odoo-surface-muted text-odoo-text hover:bg-odoo-border")
                  }
                >
                  {label}{" "}
                  <b
                    className={
                      statusFilter === value
                        ? ""
                        : value === "all"
                          ? "text-odoo-text-strong"
                          : STATUS[value].count
                    }
                  >
                    {count}
                  </b>
                </button>
              ))}
              {canSeeAll ? (
                <button
                  type="button"
                  onClick={() => setScope(scope === "all" ? "own" : "all")}
                  className="ml-1 rounded-full border border-odoo-border px-3 py-1.5 text-xs font-bold text-odoo-text-muted hover:bg-odoo-surface-muted"
                >
                  {scope === "all" ? "ທັງພະແນກ" : "ຂອງຕົນເອງ"} ▾
                </button>
              ) : null}
            </div>
            <div className="text-[11.5px] font-bold text-odoo-text-muted">
              ຍັງບໍ່ສຳເລັດ{" "}
              <b className="text-odoo-text-strong">
                {s.opened + s.scheduled + s.inprogress}
              </b>{" "}
              · ກຳລັງຈັດສົ່ງ <b className="text-amber-600">{s.inprogress}</b> ·
              ຄ້າງເກີນ 7 ວັນ <b className="text-rose-600">{overdue}</b>
            </div>
          </div>
        ) : null}
      </div>

      {/* ── Map tab ── */}
      {tab === "map" ? (
        <div className="overflow-hidden rounded-2xl border border-odoo-border bg-odoo-surface">
          <div className="flex items-center justify-between border-b border-odoo-border px-4 py-2.5">
            <span className="text-sm font-black">ຕຳແໜ່ງລົດກຳລັງຈັດສົ່ງ</span>
            <span className="inline-flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-700">
              <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-500" />
              LIVE · {activeTrucks.length} ຄັນ
            </span>
          </div>
          <div className="relative h-[560px] bg-odoo-surface-muted">
            <DeliveryMap trucks={activeTrucks} focus={focus} />
          </div>
        </div>
      ) : (
        <div className="rounded-2xl border border-odoo-border bg-odoo-surface">
          <div className="border-b border-odoo-border px-4 py-2.5 text-[12px] font-bold text-odoo-text-muted">
            {visible.length} / {tabItems.length} ບິນ ·{" "}
            {scope === "all" ? "ທັງພະແນກ" : "ຂອງຕົນເອງ"}
          </div>
          {loading ? (
            <div className="py-16 text-center text-sm text-odoo-text-muted">
              ກຳລັງໂຫຼດ…
            </div>
          ) : visible.length === 0 ? (
            <div className="py-16 text-center">
              <div className="text-3xl">🚚</div>
              <div className="mt-2 text-sm font-black text-odoo-text-strong">
                ບໍ່ມີບິນໃນເງື່ອນໄຂນີ້
              </div>
              <div className="mt-0.5 text-xs text-odoo-text-muted">
                ລອງຂະຫຍາຍຊ່ວງວັນທີ ຫຼື ເອົາຕົວກອງອອກ
              </div>
            </div>
          ) : (
            <ul className="divide-y divide-odoo-border">
              {visible.map((b) => (
                <li key={b.billNo}>
                  <button
                    type="button"
                    onClick={() => void openBill(b.billNo)}
                    className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 text-left transition hover:bg-odoo-surface-muted"
                  >
                    <span className="w-36 shrink-0">
                      <span className="block font-mono text-[13px] font-black text-odoo-text-strong">
                        {b.billNo}
                      </span>
                      <span className="text-[11px] text-odoo-text-muted">
                        {b.billDate ?? "—"}
                      </span>
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold">
                        {b.customerName}
                      </span>
                      <span className="block truncate text-[11px] text-odoo-text-muted">
                        {b.telephone ? `${b.telephone} · ` : ""}
                        ຂາຍ {b.salespersonName}
                      </span>
                    </span>
                    <span className="hidden w-44 shrink-0 text-[11.5px] text-odoo-text-muted sm:block">
                      {b.status === "inprogress" || b.status === "done"
                        ? `${b.car} · ${b.driverName}`
                        : b.roundName}
                      {b.sentEnd ? (
                        <span className="block">ສົ່ງແລ້ວ {b.sentEnd}</span>
                      ) : null}
                    </span>
                    <span
                      className={`shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold ${STATUS[b.status].badge}`}
                    >
                      {STATUS[b.status].label}
                    </span>
                  </button>
                  {selected === b.billNo ? (
                    <div className="border-t border-dashed border-odoo-border bg-odoo-surface-muted/50 px-6 py-3">
                      {!detail ? (
                        <p className="text-sm text-odoo-text-muted">
                          ກຳລັງໂຫຼດ…
                        </p>
                      ) : (
                        <>
                          <div className="mb-2 text-[12px] text-odoo-text-muted">
                            {detail.roundName}
                            {detail.routeName ? ` · ${detail.routeName}` : ""} ·{" "}
                            {detail.car} · {detail.driverName}
                            {detail.driverTel ? ` (${detail.driverTel})` : ""}
                          </div>
                          <ol className="relative ml-2 border-l border-odoo-border">
                            {detail.steps.length === 0 ? (
                              <li className="ml-4 py-1.5 text-sm text-odoo-text-muted">
                                ຍັງບໍ່ມີຄວາມເຄື່ອນໄຫວ
                              </li>
                            ) : (
                              detail.steps.map((st, i) => (
                                <li key={i} className="ml-4 py-1.5">
                                  <span className="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full bg-odoo-primary" />
                                  <div className="text-sm font-bold text-odoo-text-strong">
                                    {st.label}
                                  </div>
                                  <div className="text-xs text-odoo-text-muted">
                                    {st.at ? fmtDateTime(st.at) : "—"}
                                  </div>
                                  {st.remark ? (
                                    <div className="text-xs">{st.remark}</div>
                                  ) : null}
                                </li>
                              ))
                            )}
                          </ol>
                        </>
                      )}
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
