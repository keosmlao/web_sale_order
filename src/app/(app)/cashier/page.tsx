"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  ACCEPTED_CURRENCIES,
  MAIN_CURRENCY,
  type CurrencyCode,
  type PayMethod,
} from "@/lib/payment";
import LowStockBanner from "./LowStockBanner";
import OnePayWatcher from "./OnePayWatcher";
import { fmtDateTime } from "@/lib/datetime";
import {
  publishCustomerDisplay,
  openCustomerDisplayWindow,
  subscribeCustomerDisplay,
  IDLE_DISPLAY_STATE,
} from "@/lib/customer-display";
import {
  getCashierData,
  type CashierOrder,
  type ApprovedPrice,
} from "./actions";

// Slip uploads are downscaled to JPEG client-side before being base64-encoded
// so the API doesn't have to deal with raw 5–10MB phone-camera shots. The
// server still rechecks the size; this is just for user-friendliness.
const SLIP_MAX_BYTES = 1_500_000;
const SLIP_MAX_DIMENSION = 1600;
const SLIP_JPEG_QUALITY = 0.85;
const SLIP_MAX_COUNT = 5;

// Redeeming points against a bill is off at the till for now, by the
// owner's call. Everything behind it is left wired — the balance still
// loads, the settle payload still carries redeemPoints, and with nothing
// typed it carries zero — so this comes back by flipping one flag rather
// than by rebuilding the card.
const POINTS_REDEEM_ENABLED = false;

type AttachedSlip = {
  id: string;
  fileName: string;
  mimeType: string;       // always "image/jpeg" after compression
  base64: string;         // no "data:..." prefix
  previewUrl: string;     // data URL, cheap to render <img src>
  size: number;
};

async function compressToJpegBase64(file: File): Promise<AttachedSlip> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error("ບໍ່ສາມາດອ່ານໄຟລ໌ຮູບ"));
      el.src = objectUrl;
    });
    let { width, height } = img;
    if (width > SLIP_MAX_DIMENSION || height > SLIP_MAX_DIMENSION) {
      const ratio = Math.min(
        SLIP_MAX_DIMENSION / width,
        SLIP_MAX_DIMENSION / height,
      );
      width = Math.max(1, Math.round(width * ratio));
      height = Math.max(1, Math.round(height * ratio));
    }
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("ບໍ່ສາມາດສ້າງ canvas");
    ctx.drawImage(img, 0, 0, width, height);
    const dataUrl = canvas.toDataURL("image/jpeg", SLIP_JPEG_QUALITY);
    const commaIdx = dataUrl.indexOf(",");
    const base64 = commaIdx >= 0 ? dataUrl.slice(commaIdx + 1) : dataUrl;
    // base64 length × 3/4 ≈ raw byte size
    const size = Math.floor((base64.length * 3) / 4);
    return {
      id:
        typeof crypto !== "undefined" && "randomUUID" in crypto
          ? crypto.randomUUID()
          : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      fileName: file.name,
      mimeType: "image/jpeg",
      base64,
      previewUrl: dataUrl,
      size,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

const moneyFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

// dd-MM-yyyy HH:mm, 24-hour — the shop's format, same on every screen.
const dateTimeFmt = {
  format: (d: Date) => fmtDateTime(d),
};

type StatusFilter = "ALL" | CashierOrder["statusLabel"];

function statusFilterLabel(status: StatusFilter): string {
  if (status === "ALL") return "ທັງໝົດ";
  if (status === "COMPLETED") return "ຮັບເງິນສຳເລັດ";
  if (status === "CANCELLED") return "ຍົກເລີກ";
  if (status === "SCHEDULED") return "ຈັດຖ້ຽວ";
  if (status === "HELD") return "ພັກໄວ້";
  return "ລໍຖ້າຮັບເງິນ";
}

type TabKey = "orders" | "prices";

export default function CashierPage() {
  const [data, setData] = useState<{
    initialOrders: CashierOrder[];
    approvedPrices: ApprovedPrice[];
    currencyRates: Record<CurrencyCode, number>;
  } | null>(null);
  const [loading, setLoading] = useState(true);

  // Re-fetch the cashier data after a mutation (settle, delete, hold, …).
  // The page loads its data client-side via a server action, so
  // router.refresh() does NOT update the list — we must re-run
  // getCashierData() ourselves.
  const reload = useCallback(async () => {
    try {
      const res = await getCashierData();
      setData(res);
    } catch (err) {
      console.error("Failed to reload cashier data:", err);
    }
  }, []);

  useEffect(() => {
    let active = true;
    async function load() {
      try {
        const res = await getCashierData();
        if (active) {
          setData(res);
        }
      } catch (err) {
        console.error("Failed to load cashier initial data:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, []);

  if (loading || !data) {
    return (
      <div className="flex h-screen items-center justify-center bg-odoo-surface text-odoo-text">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-odoo-border border-t-odoo-primary" />
          <span className="text-sm font-semibold text-odoo-text-muted">ກຳລັງໂຫຼດຂໍ້ມູນ...</span>
        </div>
      </div>
    );
  }

  return (
    <CashierClientInner
      initialOrders={data.initialOrders}
      approvedPrices={data.approvedPrices}
      currencyRates={data.currencyRates}
      reload={reload}
    />
  );
}

function CashierClientInner({
  initialOrders,
  approvedPrices,
  currencyRates,
  reload,
}: {
  initialOrders: CashierOrder[];
  approvedPrices: ApprovedPrice[];
  currencyRates: Record<CurrencyCode, number>;
  reload: () => Promise<void>;
}) {
  const [tab, setTab] = useState<TabKey>("orders");
  const [query, setQuery] = useState("");
  // "ໃບສັ່ງຂາຍ" means orders still waiting to be billed. A settled one used
  // to stay in the list next to the ones still owing, which is exactly the
  // row a cashier must not pick up twice — it belongs under ໃບຮັບເງິນ now.
  // The status chips still reach the others when someone needs to look.
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("PENDING");
  const [selectedCart, setSelectedCart] = useState<string | null>(null);
  const [deletingCart, setDeletingCart] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<{
    docNo: string;
    change: number;
  } | null>(null);
  const [priceQuery, setPriceQuery] = useState("");
  // Toast shown when a new sale order arrives in the background. Stays
  // visible for a few seconds then auto-dismisses; clicking it scrolls/
  // opens the new order in the SettleForm.
  const [newOrderToast, setNewOrderToast] = useState<{
    cartNumber: string;
    customerName: string | null;
    totalAmount: number;
  } | null>(null);
  // Seen-cart-number set — survives polling cycles. Initialised from the
  // SSR-rendered list so the first poll doesn't double-fire notifications
  // for orders the cashier already had on screen.
  const seenCartsRef = useRef<Set<string>>(
    new Set(initialOrders.map((o) => o.cartNumber)),
  );

  const counts = useMemo(
    () => ({
      ALL: initialOrders.length,
      PENDING: initialOrders.filter((o) => o.statusLabel === "PENDING").length,
      HELD: initialOrders.filter((o) => o.statusLabel === "HELD").length,
      COMPLETED: initialOrders.filter((o) => o.statusLabel === "COMPLETED")
        .length,
      SCHEDULED: initialOrders.filter((o) => o.statusLabel === "SCHEDULED")
        .length,
      CANCELLED: initialOrders.filter((o) => o.statusLabel === "CANCELLED")
        .length,
    }),
    [initialOrders],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return initialOrders.filter((o) => {
      if (statusFilter !== "ALL" && o.statusLabel !== statusFilter) {
        return false;
      }
      if (q === "") return true;
      return (
        o.cartNumber.toLowerCase().includes(q) ||
        (o.customerName ?? "").toLowerCase().includes(q) ||
        (o.customerId ?? "").toLowerCase().includes(q) ||
        (o.customerPhone ?? "").toLowerCase().includes(q)
      );
    });
  }, [initialOrders, query, statusFilter]);

  const selected = useMemo(
    () => initialOrders.find((o) => o.cartNumber === selectedCart) ?? null,
    [initialOrders, selectedCart],
  );

  const filteredPrices = useMemo(() => {
    const q = priceQuery.trim().toLowerCase();
    if (!q) return approvedPrices;
    return approvedPrices.filter((p) =>
      [
        p.itemCode,
        p.itemName,
        p.customerCode,
        p.customerName,
        p.cartNumber,
        p.requestorName,
        p.approverName,
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [approvedPrices, priceQuery]);

  const totalSavings = useMemo(
    () =>
      approvedPrices.reduce(
        (sum, p) => sum + (p.originalPrice - p.approvedPrice),
        0,
      ),
    [approvedPrices],
  );

  // Keep the seen-set in sync with data reloads (reload()) so we
  // don't re-notify for orders that re-appear after a settle/delete.
  useEffect(() => {
    const seen = seenCartsRef.current;
    for (const o of initialOrders) seen.add(o.cartNumber);
  }, [initialOrders]);

  // Ask for browser-notification permission once. Most browsers gate this
  // behind a user gesture, but the modern Notification API allows the bare
  // prompt to fire on mount — if blocked we silently fall back to the
  // in-app toast only.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    if (Notification.permission === "default") {
      void Notification.requestPermission();
    }
  }, []);

  // Poll for new pending orders every 8s. When a cart number we have not
  // seen before shows up, fire a browser notification + in-app toast and
  // trigger reload() so the list updates without a manual reload.
  useEffect(() => {
    let cancelled = false;
    async function pollOnce() {
      try {
        const res = await fetch("/api/cashier/pending-orders", {
          cache: "no-store",
        });
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as Array<{
          cartNumber: string;
          customerName: string | null;
          totalAmount: number;
          statusLabel: string;
        }>;
        const seen = seenCartsRef.current;
        const fresh = data.filter(
          (o) =>
            o.statusLabel === "PENDING" && !seen.has(o.cartNumber),
        );
        if (fresh.length === 0) return;
        const newest = fresh[0];
        for (const o of fresh) seen.add(o.cartNumber);
        if (cancelled) return;
        // In-app toast.
        setNewOrderToast({
          cartNumber: newest.cartNumber,
          customerName: newest.customerName,
          totalAmount: newest.totalAmount,
        });
        // Native notification — only fires when permission is granted.
        if (
          typeof window !== "undefined" &&
          "Notification" in window &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification("ມີອໍເດີຂາຍໃໝ່", {
              body: `#${newest.cartNumber} · ${newest.customerName ?? "—"} · ${moneyFmt.format(newest.totalAmount)} ກີບ${fresh.length > 1 ? ` (+${fresh.length - 1})` : ""}`,
              tag: `cart-${newest.cartNumber}`,
            });
          } catch {
            // Some browsers throw on Notification() without a service
            // worker; ignore — in-app toast still shows.
          }
        }
        // Audible cue — small beep via WebAudio so we don't ship an MP3.
        try {
          const Ctor =
            (
              window as unknown as {
                AudioContext?: typeof AudioContext;
                webkitAudioContext?: typeof AudioContext;
              }
            ).AudioContext ??
            (
              window as unknown as {
                webkitAudioContext?: typeof AudioContext;
              }
            ).webkitAudioContext;
          if (Ctor) {
            const ctx = new Ctor();
            const o = ctx.createOscillator();
            const g = ctx.createGain();
            o.connect(g);
            g.connect(ctx.destination);
            o.frequency.value = 880;
            g.gain.value = 0.05;
            o.start();
            o.stop(ctx.currentTime + 0.18);
            o.onended = () => ctx.close();
          }
        } catch {
          // Audio is best-effort.
        }
        // Re-fetch data so the order shows up in the list.
        void reload();
      } catch {
        // Polling is best-effort — silently keep retrying.
      }
    }
    const id = window.setInterval(pollOnce, 8000);
    // Fire once shortly after mount too, in case there's already a new
    // order between SSR and the first poll tick.
    const initial = window.setTimeout(pollOnce, 1500);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      window.clearTimeout(initial);
    };
  }, [reload]);

  // Auto-dismiss the in-app toast after a few seconds.
  useEffect(() => {
    if (!newOrderToast) return;
    const id = window.setTimeout(() => setNewOrderToast(null), 6000);
    return () => window.clearTimeout(id);
  }, [newOrderToast]);

  async function holdOrder(order: CashierOrder) {
    if (order.statusLabel !== "PENDING") return;
    const reason = window.prompt(
      `ພັກບິນ #${order.cartNumber} ໄວ້? ໃສ່ເຫດຜົນ (ບໍ່ບັງຄັບ):`,
      "",
    );
    if (reason === null) return; // user cancelled
    const res = await fetch("/api/cashier/hold", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cartNumber: order.cartNumber,
        reason: reason.trim() || undefined,
      }),
    });
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      window.alert(data?.error ?? `ຂໍ້ຜິດພາດ ${res.status}`);
      return;
    }
    if (selectedCart === order.cartNumber) setSelectedCart(null);
    await reload();
  }

  async function resumeOrder(order: CashierOrder) {
    if (order.statusLabel !== "HELD") return;
    const res = await fetch(
      `/api/cashier/hold?cartNumber=${encodeURIComponent(order.cartNumber)}`,
      { method: "DELETE" },
    );
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      window.alert(data?.error ?? `ຂໍ້ຜິດພາດ ${res.status}`);
      return;
    }
    await reload();
  }

  async function deleteOrder(order: CashierOrder) {
    if (deletingCart) return;
    const isReceiptDelete = order.statusLabel === "COMPLETED";
    const ok = window.confirm(
      isReceiptDelete
        ? `ລົບໃບຮັບເງິນຂອງອໍເດີ #${order.cartNumber}? ອໍເດີຈະກັບໄປສະຖານະລໍຖ້າຮັບເງິນ.`
        : `ລົບອໍເດີຂາຍ #${order.cartNumber}? ລາຍການນີ້ຈະຖືກລົບອອກຈາກ ic_trans.`,
    );
    if (!ok) return;

    setDeletingCart(order.cartNumber);
    const res = await fetch(
      `/api/cashier/orders/${encodeURIComponent(order.cartNumber)}`,
      { method: "DELETE" },
    );
    setDeletingCart(null);
    if (!res.ok) {
      const data = await res.json().catch(() => null);
      window.alert(data?.error ?? `ຂໍ້ຜິດພາດ ${res.status}`);
      return;
    }
    if (selectedCart === order.cartNumber) setSelectedCart(null);
    await reload();
  }

  return (
    <div className="cashier-page px-4 py-5 sm:px-6 lg:px-8">
      <LowStockBanner />
      <header className="mb-4 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between">
        <div>
          <div className="odoo-label">ໜ້າຮັບເງິນ</div>
          <h1 className="mt-2 text-2xl font-bold text-odoo-text-strong">
            {tab === "orders" ? "ລາຍການອໍເດີຂາຍ" : "ລາຄາພິເສດທີ່ອະນຸມັດ"}
          </h1>
          <p className="mt-1 text-sm text-odoo-text">
            {tab === "orders"
              ? "ກວດສະຖານະ, ຮັບເງິນ ແລະ ລົບອໍເດີຮ່າງ"
              : "ກວດສອບລາຍການລາຄາພິເສດທີ່ຜູ້ຈັດການອະນຸມັດ — ປຽບທຽບລາຄາປົກກະຕິ ກັບ ລາຄາພິເສດ"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <a
            href="/orders/new?mode=counter"
            className="odoo-btn odoo-btn-primary"
            title="ສ້າງບິນຂາຍໃໝ່ທີ່ໜ້າຮ້ານ"
          >
            + ບິນໃໝ່
          </a>
          <button
            type="button"
            onClick={() => openCustomerDisplayWindow()}
            className="odoo-btn odoo-btn-secondary"
            title="ເປີດໜ້າຈໍລູກຄ້າ (ໜ້າຕ່າງໃໝ່)"
          >
            ໜ້າຈໍລູກຄ້າ
          </button>
          <button
            type="button"
            onClick={() => reload()}
            className="odoo-btn odoo-btn-secondary"
          >
            <RefreshIcon /> ໂຫຼດໃໝ່
          </button>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap gap-1 border-b border-odoo-border">
        <TabButton
          active={tab === "orders"}
          onClick={() => setTab("orders")}
          label="ອໍເດີຂາຍ"
          count={counts.ALL}
          icon={<CashIcon />}
        />
        <TabButton
          active={tab === "prices"}
          onClick={() => setTab("prices")}
          label="ລາຄາພິເສດທີ່ອະນຸມັດ"
          count={approvedPrices.length}
          icon={<TagIcon />}
        />
      </div>

      {tab === "prices" ? (
        <PricesView
          prices={filteredPrices}
          totalCount={approvedPrices.length}
          totalSavings={totalSavings}
          query={priceQuery}
          onQueryChange={setPriceQuery}
        />
      ) : (
        <OrdersView
          counts={counts}
          query={query}
          statusFilter={statusFilter}
          onQueryChange={setQuery}
          onStatusFilterChange={setStatusFilter}
          filtered={filtered}
          deletingCart={deletingCart}
          onSelectCart={setSelectedCart}
          onDeleteOrder={deleteOrder}
        />
      )}

      {selected && (
        <div className="cashier-settle-layer fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-0 backdrop-blur-sm sm:p-5">
          <button
            type="button"
            aria-label="ປິດໜ້າລາຍລະອຽດ"
            className="absolute inset-0 cursor-default"
            onClick={() => setSelectedCart(null)}
          />
          <aside className="cashier-modal relative flex h-dvh max-h-dvh w-full max-w-[1180px] flex-col overflow-hidden bg-odoo-surface sm:h-[92dvh] sm:max-h-[92dvh] sm:rounded-2xl sm:border sm:border-odoo-border-strong">
            <SettleForm
              order={selected}
              currencyRates={currencyRates}
              key={selected.cartNumber}
              onClose={() => setSelectedCart(null)}
              onSuccess={(success) => {
                setSelectedCart(null);
                setSuccessNotice(success);
              }}
              onDelete={() => deleteOrder(selected)}
              isDeleting={deletingCart === selected.cartNumber}
              onHold={() => holdOrder(selected)}
              onResume={() => resumeOrder(selected)}
              reload={reload}
            />
          </aside>
        </div>
      )}
      {successNotice ? (
        <SuccessModal
          success={successNotice}
          onClose={() => setSuccessNotice(null)}
        />
      ) : null}
      {newOrderToast ? (
        <button
          type="button"
          onClick={() => {
            setSelectedCart(newOrderToast.cartNumber);
            setNewOrderToast(null);
          }}
          className="fixed bottom-4 right-2 z-[70] flex w-[calc(100vw-1rem)] max-w-sm items-center gap-3 rounded-lg border border-odoo-primary bg-white px-4 py-3 text-left shadow-xl transition hover:bg-odoo-primary-50 sm:right-4 sm:w-auto"
        >
          <span className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-odoo-primary text-white">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="h-5 w-5"
            >
              <path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" />
              <path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" />
            </svg>
          </span>
          <div className="min-w-0">
            <div className="text-xs font-bold uppercase tracking-wide text-odoo-primary">
              ມີອໍເດີໃໝ່
            </div>
            <div className="mt-0.5 truncate text-sm font-semibold text-odoo-text-strong">
              #{newOrderToast.cartNumber} ·{" "}
              {newOrderToast.customerName ?? "—"}
            </div>
            <div className="font-mono text-xs text-odoo-text-muted">
              {moneyFmt.format(newOrderToast.totalAmount)} ກີບ
            </div>
          </div>
          <span
            onClick={(e) => {
              e.stopPropagation();
              setNewOrderToast(null);
            }}
            className="ml-auto cursor-pointer rounded-full p-1 text-odoo-text-muted hover:bg-odoo-surface-muted"
            aria-label="ປິດ"
          >
            ✕
          </span>
        </button>
      ) : null}
    </div>
  );
}

// One label out of an order's line-level codes: the single value when the
// lines agree, a count when they do not. Shared by the desktop table cells
// and the phone cards so the two never drift.
function orderWarehouseLabel(o: CashierOrder): string {
  const warehouses = new Map<string, string>();
  for (const it of o.items) {
    if (it.whCode) warehouses.set(it.whCode, it.whName ?? it.whCode);
  }
  return warehouses.size === 0
    ? (o.warehouseName ?? o.warehouseCode ?? "—")
    : warehouses.size === 1
      ? Array.from(warehouses.values())[0]
      : `ຫຼາຍສາງ (${warehouses.size})`;
}

function orderSalespersonLabel(o: CashierOrder): string {
  const salespeople = new Map<string, string>();
  for (const it of o.items) {
    if (it.saleCode) {
      salespeople.set(it.saleCode, it.salespersonName ?? it.saleCode);
    }
  }
  return salespeople.size === 0
    ? (o.salespersonName ?? o.userOwner ?? "—")
    : salespeople.size === 1
      ? Array.from(salespeople.values())[0]
      : `ຫຼາຍຄົນ (${salespeople.size})`;
}

function OrdersView({
  counts,
  query,
  statusFilter,
  onQueryChange,
  onStatusFilterChange,
  filtered,
  deletingCart,
  onSelectCart,
  onDeleteOrder,
}: {
  counts: {
    ALL: number;
    PENDING: number;
    HELD: number;
    COMPLETED: number;
    SCHEDULED: number;
    CANCELLED: number;
  };
  query: string;
  statusFilter: StatusFilter;
  onQueryChange: (v: string) => void;
  onStatusFilterChange: (v: StatusFilter) => void;
  filtered: CashierOrder[];
  deletingCart: string | null;
  onSelectCart: (cartNumber: string) => void;
  onDeleteOrder: (order: CashierOrder) => void;
}) {
  return (
    <>
      {/* The cards and the filter chips said the same numbers twice — a row
          of coloured counters to look at, then a row of grey chips to
          actually press. The cards ARE the filter now: press one to see
          that pile, press it again for everything.

          On a phone the cards are simply gone — five of them stacked two
          screens tall, and the owner had them taken out rather than
          shrunk. The active-filter chip by the search box still says what
          is in force and clears it. */}
      {(() => {
        const filterDefs = [
          ["PENDING", "ລໍຖ້າຮັບເງິນ", "amber"],
          ["HELD", "ພັກໄວ້", "slate"],
          ["COMPLETED", "ຮັບເງິນສຳເລັດ", "emerald"],
          ["SCHEDULED", "ຈັດຖ້ຽວ", "sky"],
          ["CANCELLED", "ຍົກເລີກ", "red"],
        ] as Array<
          [StatusFilter, string, "amber" | "slate" | "emerald" | "sky" | "red"]
        >;
        return (
          <>
            <div className="mb-4 hidden gap-3 sm:grid sm:grid-cols-5">
              {filterDefs.map(([status, label, tone]) => (
                <SummaryCard
                  key={status}
                  label={label}
                  value={counts[status]}
                  tone={tone}
                  active={statusFilter === status}
                  onClick={() =>
                    onStatusFilterChange(
                      statusFilter === status ? "ALL" : status,
                    )
                  }
                />
              ))}
            </div>
          </>
        );
      })()}

      <section className="odoo-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-odoo-border p-4">
          <div className="w-full sm:min-w-64 sm:flex-1">
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="ຄົ້ນຫາເລກກະຕ່າ / ລູກຄ້າ / ເບີໂທ..."
              className="odoo-input"
            />
          </div>
          {statusFilter !== "ALL" ? (
            <button
              type="button"
              onClick={() => onStatusFilterChange("ALL")}
              className="rounded-md bg-odoo-surface-muted px-2.5 py-1.5 text-xs font-semibold text-odoo-text hover:bg-odoo-border"
            >
              ✕ {statusFilterLabel(statusFilter)} — ເບິ່ງທັງໝົດ {counts.ALL}
            </button>
          ) : null}
        </div>

        {/* On a phone the table clipped at the customer column, which left
            the two things a cashier actually acts on — the total and the
            ຮັບຊຳລະ button — off the right edge of the screen. Below sm each
            order is a bill-shaped card instead: number and status on top,
            the total large, the action full-width under the thumb. */}
        <div className="sm:hidden">
          {filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-odoo-text-muted">
              ບໍ່ມີອໍເດີຂາຍ
            </p>
          ) : (
            <ul className="flex flex-col gap-2.5">
              {filtered.map((o) => {
                const clickable =
                  o.statusLabel === "PENDING" || o.statusLabel === "HELD";
                const cardTint =
                  o.statusLabel === "COMPLETED" || o.statusLabel === "SCHEDULED"
                    ? "border-emerald-200 bg-emerald-50/40"
                    : o.statusLabel === "CANCELLED"
                      ? "border-rose-200 bg-rose-50/40 opacity-70"
                      : o.statusLabel === "HELD"
                        ? "border-amber-200 bg-amber-50/40"
                        : "border-odoo-border bg-odoo-surface";
                return (
                  <li
                    key={o.cartNumber}
                    onClick={() => {
                      if (clickable) onSelectCart(o.cartNumber);
                    }}
                    className={`rounded-xl border p-3 ${cardTint}${clickable ? " cursor-pointer active:bg-odoo-surface-muted/60" : ""}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-mono text-[13px] font-bold">
                        {o.docNo}
                      </span>
                      <StatusBadge status={o.statusLabel} />
                    </div>
                    {o.receiptDocNo ? (
                      <a
                        href={`/cashier/receipts/${encodeURIComponent(o.receiptDocNo)}`}
                        className="mt-0.5 inline-block text-[11px] font-semibold text-odoo-primary"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {o.receiptDocNo} →
                      </a>
                    ) : null}
                    <div className="mt-1.5 flex items-baseline justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-semibold text-odoo-text-strong">
                          {o.customerName ?? o.customerId ?? "—"}
                        </div>
                        {o.customerPhone ? (
                          <div className="text-[11px] text-odoo-text-muted">
                            {o.customerPhone}
                          </div>
                        ) : null}
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-base font-bold">
                          {moneyFmt.format(o.totalAmount)}
                        </div>
                        {o.extraDiscount > 0 ? (
                          <div className="text-[10px] font-semibold text-odoo-danger">
                            −{moneyFmt.format(o.extraDiscount)}
                          </div>
                        ) : null}
                      </div>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-odoo-text-muted">
                      <span>{dateTimeFmt.format(new Date(o.createdAt))}</span>
                      <span>·</span>
                      <span>{orderWarehouseLabel(o)}</span>
                      <span>·</span>
                      <span>{orderSalespersonLabel(o)}</span>
                      <span>·</span>
                      <span>{moneyFmt.format(o.items.length)} ລາຍການ</span>
                    </div>
                    {o.statusLabel === "PENDING" ||
                    o.statusLabel === "HELD" ||
                    o.statusLabel === "CANCELLED" ||
                    o.statusLabel === "COMPLETED" ? (
                      <div
                        className="mt-2.5 flex gap-2"
                        onClick={(e) => e.stopPropagation()}
                      >
                        {clickable ? (
                          <button
                            type="button"
                            onClick={() => onSelectCart(o.cartNumber)}
                            className="odoo-btn odoo-btn-primary h-10 flex-1"
                          >
                            ຮັບຊຳລະ
                          </button>
                        ) : null}
                        <button
                          type="button"
                          disabled={deletingCart === o.cartNumber}
                          onClick={() => onDeleteOrder(o)}
                          className={`odoo-btn odoo-btn-danger h-10${clickable ? "" : " flex-1"}`}
                        >
                          {deletingCart === o.cartNumber
                            ? "ລົບ..."
                            : o.statusLabel === "COMPLETED"
                              ? "ລົບໃບຮັບ"
                              : "ລົບ"}
                        </button>
                      </div>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="hidden overflow-x-auto rounded-md border border-odoo-border bg-odoo-surface sm:block">
          <table className="w-full text-sm">
            <thead className="bg-odoo-surface-muted text-left text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
              <tr>
                <th className="px-3 py-2">ເລກບິນ</th>
                <th className="px-3 py-2">ວັນທີ</th>
                <th className="px-3 py-2">ສະຖານະ</th>
                <th className="px-3 py-2">ລູກຄ້າ</th>
                <th className="px-3 py-2">ສາງ</th>
                <th className="px-3 py-2">ຜູ້ຂາຍ</th>
                <th className="px-3 py-2 text-right">ລາຍການ</th>
                <th className="px-3 py-2 text-right">ລວມ (ກີບ)</th>
                <th className="px-3 py-2 text-right" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-3 py-6 text-center text-odoo-text-muted">
                    ບໍ່ມີອໍເດີຂາຍ
                  </td>
                </tr>
              ) : (
                filtered.map((o) => {
                  const clickable = o.statusLabel === "PENDING" || o.statusLabel === "HELD";
                  const rowTint =
                    o.statusLabel === "COMPLETED" || o.statusLabel === "SCHEDULED"
                      ? "bg-emerald-50/30"
                      : o.statusLabel === "CANCELLED"
                        ? "bg-rose-50/30 opacity-70"
                        : o.statusLabel === "HELD"
                          ? "bg-amber-50/30"
                          : "";
                  return (
                    <tr
                      key={o.cartNumber}
                      onClick={() => {
                        if (clickable) onSelectCart(o.cartNumber);
                      }}
                      className={
                        "border-t border-odoo-border " +
                        rowTint +
                        (clickable
                          ? " cursor-pointer hover:bg-odoo-surface-muted/50"
                          : "")
                      }
                    >
                      <td className="px-3 py-2 font-mono text-[12px] font-bold">
                        {o.docNo}
                        {o.receiptDocNo ? (
                          <a
                            href={`/cashier/receipts/${encodeURIComponent(o.receiptDocNo)}`}
                            className="ml-2 text-[10px] font-semibold text-odoo-primary hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {o.receiptDocNo} →
                          </a>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-[11px] text-odoo-text-muted whitespace-nowrap">
                        {dateTimeFmt.format(new Date(o.createdAt))}
                      </td>
                      <td className="px-3 py-2">
                        <StatusBadge status={o.statusLabel} />
                      </td>
                      <td className="px-3 py-2">
                        <div className="font-semibold text-odoo-text-strong">
                          {o.customerName ?? o.customerId ?? "—"}
                        </div>
                        {o.customerPhone ? (
                          <div className="text-[11px] text-odoo-text-muted">
                            {o.customerPhone}
                          </div>
                        ) : null}
                        {o.deliveryName ? (
                          <div className="mt-0.5 text-[10px] text-odoo-text-muted">
                            ສົ່ງ: {o.deliveryName}
                          </div>
                        ) : null}
                      </td>
                      {/* Warehouse, salesperson and the line count are
                          reference, not the decision — plain quiet text.
                          Boxed and coloured they competed with the two
                          things that ARE the decision: the total and the
                          button. */}
                      <td className="px-3 py-2.5 text-[12px] text-odoo-text-muted">
                        {orderWarehouseLabel(o)}
                      </td>
                      <td className="px-3 py-2.5 text-[12px] text-odoo-text-muted">
                        {orderSalespersonLabel(o)}
                      </td>
                      <td className="px-3 py-2.5 text-right text-[12px] text-odoo-text-muted">
                        {moneyFmt.format(o.items.length)}
                      </td>
                      <td className="px-3 py-2.5 text-right">
                        <div className="font-mono text-[14px] font-bold text-odoo-text-strong">
                          {moneyFmt.format(o.totalAmount)}
                        </div>
                        {o.extraDiscount > 0 ? (
                          <div className="text-[10px] font-semibold text-odoo-danger">
                            −{moneyFmt.format(o.extraDiscount)}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap" onClick={(e) => e.stopPropagation()}>
                        {o.statusLabel === "PENDING" || o.statusLabel === "HELD" ? (
                          <button
                            type="button"
                            onClick={() => onSelectCart(o.cartNumber)}
                            className="odoo-btn odoo-btn-primary"
                          >
                            ຮັບຊຳລະ
                          </button>
                        ) : null}
                        {o.statusLabel === "PENDING" ||
                          o.statusLabel === "CANCELLED" ||
                          o.statusLabel === "COMPLETED" ||
                          o.statusLabel === "HELD" ? (
                          <button
                            type="button"
                            disabled={deletingCart === o.cartNumber}
                            onClick={() => onDeleteOrder(o)}
                            className="odoo-btn odoo-btn-danger ml-1"
                          >
                            {deletingCart === o.cartNumber
                              ? "ລົບ..."
                              : o.statusLabel === "COMPLETED"
                                ? "ລົບໃບຮັບ"
                                : "ລົບ"}
                          </button>
                        ) : null}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function PricesView({
  prices,
  totalCount,
  totalSavings,
  query,
  onQueryChange,
}: {
  prices: ApprovedPrice[];
  totalCount: number;
  totalSavings: number;
  query: string;
  onQueryChange: (v: string) => void;
}) {
  return (
    <>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <SummaryCard label="ລາຍການອະນຸມັດ" value={totalCount} tone="emerald" />
        <SummaryCard label="ສະແດງ" value={prices.length} tone="slate" />
        <div className="rounded-md border border-odoo-success-border bg-odoo-success-bg px-4 py-3 text-odoo-success">
          <div className="text-xs font-semibold text-current/65">
            ສ່ວນຫຼຸດທີ່ໃຫ້ລວມ
          </div>
          <div className="mt-1 font-mono text-2xl font-bold">
            {moneyFmt.format(totalSavings)} <span className="text-sm font-semibold">ກີບ</span>
          </div>
        </div>
      </div>

      <section className="odoo-card overflow-hidden">
        <div className="flex flex-wrap items-center gap-3 border-b border-odoo-border p-4">
          <div className="w-full sm:min-w-64 sm:flex-1">
            <input
              value={query}
              onChange={(e) => onQueryChange(e.target.value)}
              placeholder="ຄົ້ນຫາ ສິນຄ້າ / ລູກຄ້າ / ກະຕ່າ / ພະນັກງານ..."
              className="odoo-input"
            />
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="bg-odoo-surface-muted text-left text-xs uppercase tracking-wide text-odoo-text-muted">
              <tr>
                <th className="px-4 py-3 font-semibold">ສິນຄ້າ</th>
                <th className="px-4 py-3 font-semibold">ລູກຄ້າ</th>
                <th className="px-4 py-3 text-right font-semibold">ລາຄາປົກກະຕິ</th>
                <th className="px-4 py-3 text-right font-semibold">ລາຄາພິເສດ</th>
                <th className="px-4 py-3 text-right font-semibold">ສ່ວນຫຼຸດ</th>
                <th className="px-4 py-3 font-semibold">ກະຕ່າ</th>
                <th className="px-4 py-3 font-semibold">ຜູ້ຂໍ</th>
                <th className="px-4 py-3 font-semibold">ຜູ້ອະນຸມັດ</th>
                <th className="px-4 py-3 font-semibold">ວັນທີອະນຸມັດ</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-odoo-border">
              {prices.length === 0 ? (
                <tr>
                  <td
                    colSpan={9}
                    className="px-4 py-14 text-center text-sm text-odoo-text-muted"
                  >
                    ບໍ່ມີລາຍການລາຄາພິເສດທີ່ອະນຸມັດ
                  </td>
                </tr>
              ) : (
                prices.map((p) => {
                  const discountAmount = p.originalPrice - p.approvedPrice;
                  return (
                    <tr
                      key={p.id}
                      className="text-odoo-text-strong transition hover:bg-odoo-surface-muted"
                      title={p.reason || p.approverNote || ""}
                    >
                      <td className="px-4 py-3">
                        <div className="font-semibold text-odoo-text-strong">
                          {p.itemName ?? "—"}
                        </div>
                        <div className="font-mono text-xs text-odoo-text-muted">
                          {p.itemCode}
                          {p.unitName ? ` · ${p.unitName}` : ""}
                        </div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-semibold text-odoo-text-strong">
                          {p.customerName ?? "—"}
                        </div>
                        {p.customerCode ? (
                          <div className="font-mono text-[10px] text-odoo-text-soft">
                            {p.customerCode}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-odoo-text">
                        <span className="line-through opacity-60">
                          {moneyFmt.format(p.originalPrice)}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-base font-bold text-odoo-success">
                        {moneyFmt.format(p.approvedPrice)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <div className="font-mono text-xs font-bold text-odoo-danger">
                          −{moneyFmt.format(discountAmount)}
                        </div>
                        <div className="text-[10px] text-odoo-text-muted">
                          −{p.savingsPct.toFixed(1)}%
                        </div>
                      </td>
                      <td className="px-4 py-3 font-mono text-xs text-odoo-text">
                        {p.cartNumber ? `#${p.cartNumber}` : "—"}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-semibold text-odoo-text-strong">
                          {p.requestorName ?? p.requestorCode}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <div className="font-semibold text-odoo-text-strong">
                          {p.approverName ?? p.approverCode ?? "—"}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-xs text-odoo-text-muted">
                        {p.decidedAt
                          ? dateTimeFmt.format(new Date(p.decidedAt))
                          : "—"}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

function TabButton({
  active,
  onClick,
  label,
  count,
  icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  count: number;
  icon: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        "inline-flex items-center gap-2 border-b-2 px-4 py-2.5 text-sm font-semibold transition " +
        (active
          ? "border-odoo-primary text-odoo-primary"
          : "border-transparent text-odoo-text-muted hover:text-odoo-text-strong")
      }
    >
      <span className={active ? "text-odoo-primary" : "text-odoo-text-soft"}>
        {icon}
      </span>
      {label}
      <span
        className={
          "rounded-full px-2 py-0.5 text-[10px] font-bold " +
          (active
            ? "bg-odoo-primary text-white"
            : "bg-odoo-surface-muted text-odoo-text-muted")
        }
      >
        {count}
      </span>
    </button>
  );
}

type BillDiscountStatus = "pending" | "approved" | "rejected" | "used";

type BillDiscountRequest = {
  id: string;
  originalAmount: number;
  discountedAmount: number;
  status: BillDiscountStatus;
  reason: string | null;
  approverCode: string | null;
  approverNote: string | null;
  requestedAt: string;
  decidedAt: string | null;
};

// Keyed "<currency>:<method>" → input string. Kept as strings so we don't
// fight the controlled-input UX (clearing a 0 to type a new amount, etc.).
type PaymentField = `${CurrencyCode}:${PayMethod}`;
const PAYMENT_FIELDS: PaymentField[] = ACCEPTED_CURRENCIES.flatMap(
  (c) =>
    (["cash", "transfer"] as const).map((m) => `${c}:${m}` as PaymentField),
);

function paymentKey(currency: CurrencyCode, method: PayMethod): PaymentField {
  return `${currency}:${method}`;
}

function SettleForm({
  order,
  currencyRates,
  onClose,
  onSuccess,
  onDelete,
  isDeleting,
  onHold,
  onResume,
  reload,
}: {
  order: CashierOrder;
  currencyRates: Record<CurrencyCode, number>;
  onClose: () => void;
  onSuccess: (success: { docNo: string; change: number }) => void;
  onDelete: () => void;
  isDeleting: boolean;
  onHold: () => void;
  onResume: () => void;
  reload: () => Promise<void>;
}) {
  // One input per (currency × method). Default: pay full bill in cash LAK.
  const [paymentInputs, setPaymentInputs] = useState<
    Record<PaymentField, string>
  >(() => {
    const init: Record<PaymentField, string> = {} as Record<
      PaymentField,
      string
    >;
    for (const k of PAYMENT_FIELDS) init[k] = "0";
    // Deliberately NOT pre-filled with the total.
    //
    // It used to open holding the whole bill, to save a tap on the common
    // cash sale. But the customer-facing screen reads the same numbers,
    // so it announced "ຮັບເງິນ 11,039,000 · ຍັງຄ້າງ 0" to someone who had
    // not handed over anything yet — and the cashier's own "ຍັງຂາດ" read
    // zero from the start, which is the figure the whole screen is built
    // around. The tap comes back as "ພໍດີ", which sits under the cash row
    // from the moment the bill opens.
    return init;
  });
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  // Coupons put on this bill. Several are allowed — a customer can hand over
  // more than one — and each is capped by its own remaining balance.
  const [coupons, setCoupons] = useState<
    Array<{ number: string; balance: number; amount: number }>
  >([]);
  const [couponInput, setCouponInput] = useState("");
  const [couponBusy, setCouponBusy] = useState(false);
  const [couponError, setCouponError] = useState<string | null>(null);
  // A transfer into another of the shop's accounts. The account is the whole
  // difference from the QR, so the line is not usable without one.
  const [otherAccount, setOtherAccount] = useState("");
  const [otherAmount, setOtherAmount] = useState("");
  // Which source-backed method is mid-add, so its one input shows.
  const [addingCoupon, setAddingCoupon] = useState(false);
  const [addingOther, setAddingOther] = useState(false);
  const [otherAccounts, setOtherAccounts] = useState<
    Array<{ code: string; name: string }>
  >([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/settings/payment-accounts")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) return;
        const list = Array.isArray(d.accounts) ? d.accounts : [];
        setOtherAccounts(
          list
            .map((a: { code?: string; name?: string }) => ({
              code: (a.code ?? "").trim(),
              name: (a.name ?? "").trim(),
            }))
            .filter((a: { code: string }) => a.code),
        );
      })
      .catch(() => {
        // A missing list only costs the picker; the rest of the till works.
      });
    return () => {
      alive = false;
    };
  }, []);
  // THB is the secondary currency — keep its inputs collapsed until needed so
  // the common LAK-only flow stays uncluttered.
  const [showThb, setShowThb] = useState(false);
  const [qrPaymentSelected, setQrPaymentSelected] = useState(false);
  // Test mode (per-device): when on, the BCEL transfer QR is generated for
  // 1 ກີບ instead of the real amount, so the transfer flow can be tested with
  // a real 1-kip transfer. The recorded bill amounts are unaffected.
  const [testTransfer, setTestTransfer] = useState(false);
  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      if (!mounted) return;
      try {
        if (window.localStorage.getItem("pos-test-transfer") === "1") {
          setTestTransfer(true);
        }
      } catch {
        // localStorage unavailable — stay off
      }
    });
    return () => {
      mounted = false;
    };
  }, []);
  const [slips, setSlips] = useState<AttachedSlip[]>([]);
  const [slipBusy, setSlipBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [isPending, startTransition] = useTransition();
  // Auto-confirm on OnePay payment: banner + guard so a single payment event
  // settles the bill exactly once.
  const [autoConfirming, setAutoConfirming] = useState(false);
  const autoHandledRef = useRef(false);

  // Bill-level discount approval flow: cashier types an amount → "Request
  // approval" creates an app_price_request → UI polls /active-bill-discount
  // until the manager decides.
  const [billDiscountInput, setBillDiscountInput] = useState("");
  const [billDiscountReason, setBillDiscountReason] = useState("");
  const [billDiscountReq, setBillDiscountReq] = useState<BillDiscountRequest | null>(
    null,
  );
  const [billDiscountBusy, setBillDiscountBusy] = useState(false);
  const [billDiscountError, setBillDiscountError] = useState<string | null>(null);

  // Loyalty redemption: cashier asks how many points the customer wants to
  // apply; server validates against balance + active config. Pulled once
  // when the drawer opens so we can render the customer's available points.
  const [redeemInput, setRedeemInput] = useState("");
  const [redeemInfo, setRedeemInfo] = useState<{
    isActive: boolean;
    redeemPointsPerKip: number;
    minRedeemPoints: number;
    pointName: string | null;
    pointBalance: number;
    customerCode: string | null;
  } | null>(null);
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await fetch(
          `/api/cashier/redeem-info?cartNumber=${encodeURIComponent(order.cartNumber)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (!abort) setRedeemInfo(data);
      } catch {
        // ignore — UI just stays hidden if the lookup fails
      }
    })();
    return () => {
      abort = true;
    };
  }, [order.cartNumber]);
  const redeemPointsRequested = Math.max(0, Math.floor(Number(redeemInput) || 0));
  const redeemKipValue = useMemo(() => {
    if (!redeemInfo || !redeemInfo.isActive || redeemInfo.redeemPointsPerKip <= 0) {
      return 0;
    }
    if (redeemPointsRequested <= 0) return 0;
    const rawKip = Math.floor(
      redeemPointsRequested / redeemInfo.redeemPointsPerKip,
    );
    // Cap at total before redeem so we never preview a negative balance.
    return Math.min(rawKip, order.totalAmount);
  }, [redeemInfo, redeemPointsRequested, order.totalAmount]);

  // Sum each input × its rate-to-LAK to get the running total in LAK.
  // Look the coupon up, then put it on the bill for the smaller of what it
  // holds and what the bill still owes — the common case being that it
  // covers part and something else covers the rest.
  async function addCoupon() {
    const number = couponInput.trim();
    if (!number) return;
    if (coupons.some((c) => c.number.toUpperCase() === number.toUpperCase())) {
      setCouponError("ໃບນີ້ຢູ່ໃນບິນແລ້ວ");
      return;
    }
    setCouponBusy(true);
    setCouponError(null);
    try {
      const res = await fetch(
        `/api/cashier/coupon?number=${encodeURIComponent(number)}`,
      );
      const data = await res.json().catch(() => null);
      if (!res.ok || !data) {
        setCouponError(data?.error ?? "ກວດ coupon ບໍ່ສຳເລັດ");
        return;
      }
      if (!data.usable) {
        setCouponError(data.problem ?? "ໃຊ້ໃບນີ້ບໍ່ໄດ້");
        return;
      }
      // Pre-filled with whatever it can actually cover. Most coupons are
      // worth less than the bill, so the usual answer is "all of it" and
      // the cashier types nothing. When cash is holding the whole total
      // the coupon comes off cash, the same as any other tender.
      const take = Math.min(Number(data.balance) || 0, fill);
      takeFromCash(take);
      setCoupons((prev) => [
        ...prev,
        {
          number: data.number as string,
          balance: Number(data.balance) || 0,
          amount: take,
        },
      ]);
      setCouponInput("");
      setAddingCoupon(false);
    } catch {
      setCouponError("ກວດ coupon ບໍ່ສຳເລັດ");
    } finally {
      setCouponBusy(false);
    }
  }

  const numericPayments = useMemo(() => {
    const list: Array<{
      currency: CurrencyCode;
      method: PayMethod;
      amount: number;
      inMain: number;
      couponNumber?: string;
      accountCode?: string;
    }> = [];
    for (const c of ACCEPTED_CURRENCIES) {
      for (const m of ["cash", "transfer"] as const) {
        const raw = paymentInputs[paymentKey(c, m)] ?? "0";
        const amount = Number(raw) || 0;
        if (amount <= 0) continue;
        const rate = currencyRates[c] ?? (c === MAIN_CURRENCY ? 1 : 0);
        list.push({ currency: c, method: m, amount, inMain: amount * rate });
      }
    }
    // Both of these are quoted in kip, like the bill.
    for (const c of coupons) {
      if (c.amount > 0) {
        list.push({
          currency: MAIN_CURRENCY,
          method: "coupon",
          amount: c.amount,
          inMain: c.amount,
          couponNumber: c.number,
        });
      }
    }
    const other = Number(otherAmount) || 0;
    if (other > 0 && otherAccount) {
      list.push({
        currency: MAIN_CURRENCY,
        method: "transfer_other",
        amount: other,
        inMain: other,
        accountCode: otherAccount,
      });
    }
    return list;
  }, [paymentInputs, currencyRates, coupons, otherAmount, otherAccount]);

  const paidInMain = numericPayments.reduce((s, p) => s + p.inMain, 0);
  const isApprovedBillDiscount = billDiscountReq?.status === "approved";
  const billDiscountAmount = isApprovedBillDiscount
    ? Math.max(
      0,
      billDiscountReq!.originalAmount - billDiscountReq!.discountedAmount,
    )
    : 0;
  const effectiveTotal = Math.max(
    0,
    order.totalAmount - billDiscountAmount - redeemKipValue,
  );
  const change = paidInMain - effectiveTotal;
  const changeDue = Math.max(0, change);
  const remainingDue = Math.max(0, -change);
  const canSettle =
    order.statusLabel === "PENDING" || order.statusLabel === "HELD";

  // ── The tender list ──────────────────────────────────────────────────
  // A view over the state that already exists, not a second copy of it:
  // the kip cash/transfer inputs, the coupons and the other-account line
  // are the same values the submit path reads. Rendering them as one list
  // is the whole change — the money math underneath is untouched.
  const TENDER_COLOUR = {
    cash: "#0f9d68",
    transfer: "#714B67",
    transfer_other: "#3f2a3a",
    coupon: "#d0384e",
  } as const;

  const cashKey = paymentKey(MAIN_CURRENCY, "cash");
  const qrKey = paymentKey(MAIN_CURRENCY, "transfer");
  const cashNow = Number(paymentInputs[cashKey] ?? "0") || 0;
  const qrNow = Number(paymentInputs[qrKey] ?? "0") || 0;
  const otherNow = Number(otherAmount) || 0;

  const setInput = (key: PaymentField, value: number) =>
    setPaymentInputs((prev) => ({ ...prev, [key]: String(Math.max(0, value)) }));

  // Digits append, the way a till does — 5, then 0, then 000 is 50,000.
  // Capped so a stuck key cannot produce a number nobody meant.
  const pressDigit = (d: string) => {
    const next = Number(`${cashNow || ""}${d}`);
    if (!Number.isFinite(next) || next > 99_999_999_999) return;
    setInput(cashKey, next);
  };
  const backspace = () =>
    setInput(cashKey, Math.floor((cashNow || 0) / 10));

  type TenderRow = {
    key: string;
    label: string;
    source?: string;
    amount: number;
    max?: number;
    colour: string;
    readOnly?: boolean;
    setAmount: (v: number) => void;
    remove: () => void;
  };

  const tenderRows: TenderRow[] = [];
  // Always present, at zero until it is counted: cash is the default way
  // to pay, and its quick-amounts are the fastest path off this screen.
  tenderRows.push({
    key: "cash",
    label: "ເງິນສົດ",
    colour: TENDER_COLOUR.cash,
    amount: cashNow,
    setAmount: (v) => setInput(cashKey, v),
    remove: () => setInput(cashKey, 0),
  });
  if (qrNow > 0) {
    tenderRows.push({
      key: "qr",
      label: "ໂອນ QR",
      source: qrPaymentSelected ? "ລໍຖ້າລູກຄ້າໂອນ" : undefined,
      colour: TENDER_COLOUR.transfer,
      amount: qrNow,
      // While a QR is live an effect keeps this equal to what is still
      // owed, so the field is not the cashier's to type into — the QR the
      // customer is looking at would no longer be for this number.
      readOnly: qrPaymentSelected,
      setAmount: (v) => setInput(qrKey, v),
      remove: () => cancelQrPayment(),
    });
  }
  for (let i = 0; i < coupons.length; i++) {
    const c = coupons[i];
    tenderRows.push({
      key: `coupon:${c.number}`,
      label: "Coupon",
      source: `${c.number} · ເຫຼືອ ${moneyFmt.format(c.balance)}`,
      colour: TENDER_COLOUR.coupon,
      amount: c.amount,
      max: c.balance,
      // Never more than the coupon holds; the server checks again under a
      // lock, but the counter should not be able to promise it either.
      setAmount: (v) =>
        setCoupons((prev) =>
          prev.map((x, j) =>
            j === i ? { ...x, amount: Math.min(c.balance, Math.max(0, v)) } : x,
          ),
        ),
      remove: () => setCoupons((prev) => prev.filter((_, j) => j !== i)),
    });
  }
  if (otherNow > 0 && otherAccount) {
    const acc = otherAccounts.find((a) => a.code === otherAccount);
    tenderRows.push({
      key: "other",
      label: "ໂອນບັນຊີອື່ນ",
      source: acc ? `${acc.code} · ${acc.name}` : otherAccount,
      colour: TENDER_COLOUR.transfer_other,
      amount: otherNow,
      setAmount: (v) => setOtherAmount(String(Math.max(0, v))),
      remove: () => {
        setOtherAmount("");
        setOtherAccount("");
        setAddingOther(false);
      },
    });
  }

  // What the next tender should be worth.
  //
  // A new bill opens with cash already holding the whole total, because
  // most bills are cash and that way they take no taps at all. But it
  // means nothing is unallocated, so a chip tapped afterwards would come
  // up zero — "actually they are paying by QR" would do nothing.
  //
  // So a chip takes what is still owed, and when nothing is owed because
  // cash is holding it, it takes it off cash. That is the move the cashier
  // is making: not adding money, but saying it arrives another way.
  const fill = remainingDue > 0 ? remainingDue : Math.min(cashNow, effectiveTotal);
  const takeFromCash = (amount: number) => {
    if (remainingDue > 0) return;
    setInput(cashKey, Math.max(0, cashNow - amount));
  };
  const tenderChips: Array<{
    key: string;
    label: string;
    colour: string;
    add: () => void;
  }> = [];

  if (qrNow <= 0) {
    tenderChips.push({
      key: "qr",
      label: "ໂອນ QR",
      colour: TENDER_COLOUR.transfer,
      // Not just an amount: this also opens the customer-facing display so
      // they have something to scan.
      add: () => {
        takeFromCash(fill);
        selectQrPayment();
      },
    });
  }
  if (!(otherNow > 0 && otherAccount)) {
    tenderChips.push({
      key: "other",
      label: "ໂອນບັນຊີອື່ນ",
      colour: TENDER_COLOUR.transfer_other,
      add: () => setAddingOther(true),
    });
    // The amount is filled once an account is picked, below.
  }
  tenderChips.push({
    key: "coupon",
    label: "Coupon",
    colour: TENDER_COLOUR.coupon,
    add: () => setAddingCoupon(true),
  });
  // Transfer-slip upload removed — QR payment replaces the manual slip, so the
  // section is hidden and settlement is never blocked on a slip.
  const needsSlip = false;
  const slipsMissing = false;
  const awaitingApproval = billDiscountReq?.status === "pending";
  const itemQuantity = useMemo(
    () => order.items.reduce((sum, item) => sum + item.quantity, 0),
    [order.items],
  );
  const itemSubtotal = useMemo(
    () => order.items.reduce((sum, item) => sum + item.amount, 0),
    [order.items],
  );
  const billDifference = order.totalAmount - itemSubtotal;
  // What the lines would have come to at list price, and what came off them.
  // item.unitPrice is ic_trans_detail.price_2 (the list price) while
  // item.amount is sum_amount_2 (after the line's own discount), so the
  // difference is the member rate and any approved special price.
  const grossListTotal = useMemo(
    () => order.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0),
    [order.items],
  );
  const lineDiscountTotal = Math.max(0, grossListTotal - itemSubtotal);
  const cashKipKey = paymentKey(MAIN_CURRENCY, "cash");
  const transferKipKey = paymentKey(MAIN_CURRENCY, "transfer");

  // Split cash + transfer: the QR (KIP transfer) only needs to cover whatever
  // the non-QR payments (cash KIP/THB, manual THB transfer) don't. So the
  // cashier types the cash first, and the transfer picks up the rest.
  const nonQrPaidInMain = numericPayments
    .filter((p) => !(p.currency === MAIN_CURRENCY && p.method === "transfer"))
    .reduce((s, p) => s + p.inMain, 0);
  const transferRemaining = Math.max(
    0,
    Math.round(effectiveTotal - nonQrPaidInMain),
  );

  // While QR is selected, keep the transfer amount equal to whatever the cash
  // (and other non-QR payments) don't cover — the "remaining". Recomputes live
  // as the cashier edits cash, a discount changes the balance, etc. Does NOT
  // wipe the cash the cashier already entered (that's what enables split
  // cash + transfer).
  useEffect(() => {
    if (!qrPaymentSelected) return;
    setTransferKipAmount(transferRemaining);
  }, [qrPaymentSelected, transferRemaining, transferKipKey]);

  // Total transfer in KIP (any currency) — drives the BCEL QR on the customer
  // screen.
  const transferInMain = numericPayments
    .filter((p) => p.method === "transfer")
    .reduce((s, p) => s + p.inMain, 0);
  // Amount actually encoded into the transfer QR (cashier + customer display).
  // Test mode forces it to 1 ກີບ; otherwise it's the real rounded transfer.
  const transferQrAmount =
    testTransfer && transferInMain > 0 ? 1 : Math.round(transferInMain);

  // Keep the THB inputs revealed whenever they already hold a value, so a
  // collapsed section never hides money the cashier entered.
  const thbHasValue =
    (Number(paymentInputs[paymentKey("01", "cash")]) || 0) > 0 ||
    (Number(paymentInputs[paymentKey("01", "transfer")]) || 0) > 0;
  const showThbInputs = showThb || thbHasValue;

  // Snapshot of the live bill for the customer-facing display window.
  const displaySnapshot = useMemo(
    () => ({
      cartNumber: order.cartNumber,
      customerName: order.customerName ?? null,
      items: order.items.map((it) => ({
        name: it.itemName ?? it.itemCode ?? "—",
        qty: it.quantity,
        amount: it.amount,
        unitPrice: it.unitPrice,
      })),
      total: effectiveTotal,
      paid: paidInMain,
      // A QR that has been put on screen is a request, not a receipt. The
      // customer display subtracts this so it never tells someone their
      // money has arrived while they are still being asked for it.
      pendingTransfer: qrPaymentSelected ? transferInMain : 0,
      // Everything the customer saved, and what the bill was before it.
      // itemSubtotal is the sum of the line amounts, which already carry
      // any member rate or approved special price, so the gross has to be
      // reconstructed from the bill total plus what came off it.
      // The list price of everything on the bill. The member discount is
      // taken off each line when the order is written, so order.totalAmount
      // is already net of it and the gross has to be rebuilt from the unit
      // prices — which is why the discount never reached this screen.
      grossTotal: grossListTotal,
      discount: lineDiscountTotal + billDiscountAmount,
      pointsUsed: redeemPointsRequested,
      pointsUsedValue: redeemKipValue,
      pointsEarned: order.earnedPoints,
      pointsBalance: redeemInfo?.pointBalance ?? 0,
      changeDue,
      remainingDue,
      transferAmount: transferQrAmount,
      qrSelected: qrPaymentSelected,
      updatedAt: Date.now(),
    }),
    [
      order,
      effectiveTotal,
      paidInMain,
      changeDue,
      remainingDue,
      transferQrAmount,
      transferInMain,
      qrPaymentSelected,
      billDiscountAmount,
      redeemPointsRequested,
      redeemKipValue,
      grossListTotal,
      lineDiscountTotal,
      redeemInfo,
    ],
  );

  // Mirror the bill onto the display window (if one is open) on every change.
  useEffect(() => {
    publishCustomerDisplay(displaySnapshot);
  }, [displaySnapshot]);

  // Answer a display window that just opened and asked for the current bill.
  const snapshotRef = useRef(displaySnapshot);
  snapshotRef.current = displaySnapshot;
  useEffect(() => {
    return subscribeCustomerDisplay({
      onHello: () => publishCustomerDisplay(snapshotRef.current),
    });
  }, []);

  // When the settle drawer closes, send the customer screen back to welcome.
  useEffect(() => {
    return () => publishCustomerDisplay(IDLE_DISPLAY_STATE);
  }, []);

  function openCustomerDisplay() {
    openCustomerDisplayWindow();
    // The fresh window mounts its listener async; re-publish shortly after so
    // it shows the current bill without waiting for the next edit.
    //
    // From the ref, not from `displaySnapshot`. The snapshot here is the one
    // from the render this was clicked in — and this is called by
    // selectQrPayment, so at that instant the QR has not been chosen and the
    // transfer is still zero. Publishing that captured value 900ms later
    // overwrote the correct state that had been sent in between: the
    // customer saw the QR appear, then vanish about a second afterwards,
    // and a refresh brought it back because the window then asks for the
    // current state and gets the real one.
    window.setTimeout(() => publishCustomerDisplay(snapshotRef.current), 900);
  }

  // Set just the KIP transfer field (leaves cash intact). Wrapped in a plain
  // function so the sync effect below drives it without an inline setState.
  function setTransferKipAmount(amount: number) {
    const next = String(amount);
    setPaymentInputs((prev) =>
      prev[transferKipKey] === next ? prev : { ...prev, [transferKipKey]: next },
    );
  }

  // Accept the remaining balance as a QR transfer. Keeps any cash already
  // entered; the effect above keeps the transfer synced to the remaining.
  //
  // Deliberately does NOT set the amount here. It used to, from
  // `transferRemaining` — a value derived from the render it was clicked
  // in, which is stale the moment the same click also moves money off the
  // cash row. It set zero, and the QR blinked out until the effect
  // corrected it a render later. Flipping the flag is enough: the effect
  // computes the amount from state that has actually settled.
  function selectQrPayment() {
    setQrPaymentSelected(true);
    openCustomerDisplay();
  }

  // Back out of the transfer (e.g. customer decides to pay all cash).
  function cancelQrPayment() {
    setQrPaymentSelected(false);
    setTransferKipAmount(0);
    autoHandledRef.current = false;
    setAutoConfirming(false);
  }

  async function handleSlipFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setError(null);
    setSlipBusy(true);
    try {
      const next: AttachedSlip[] = [];
      for (const file of Array.from(files)) {
        if (slips.length + next.length >= SLIP_MAX_COUNT) {
          setError(`ແນບໄດ້ສູງສຸດ ${SLIP_MAX_COUNT} ຮູບເທົ່ານັ້ນ`);
          break;
        }
        if (!file.type.startsWith("image/")) {
          setError(`"${file.name}" ບໍ່ແມ່ນຮູບ`);
          continue;
        }
        try {
          const slip = await compressToJpegBase64(file);
          if (slip.size > SLIP_MAX_BYTES) {
            setError(`"${file.name}" ຍັງໃຫຍ່ກວ່າທີ່ກຳນົດ ຫຼັງຈາກບີບອັດ`);
            continue;
          }
          next.push(slip);
        } catch (e) {
          setError(e instanceof Error ? e.message : "ບີບອັດຮູບບໍ່ສຳເລັດ");
        }
      }
      if (next.length > 0) setSlips((cur) => [...cur, ...next]);
    } finally {
      setSlipBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  function removeSlip(id: string) {
    setSlips((cur) => cur.filter((s) => s.id !== id));
  }

  // Fetch the latest bill-discount request for this cart so reopening the
  // settle drawer (or coming back from a different page) shows the right
  // status, not a stale "no request yet" state.
  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      try {
        const res = await fetch(
          `/api/price-requests/active-bill-discount?cartNumber=${encodeURIComponent(order.cartNumber)}`,
        );
        if (!res.ok) return;
        const data = await res.json();
        if (cancelled) return;
        setBillDiscountReq(data.request as BillDiscountRequest | null);
      } catch {
        // Silent — the UI just stays on its previous state.
      }
    };
    void refresh();
    // Poll while pending so the cashier sees the approval flip live.
    const interval = window.setInterval(() => {
      if (cancelled) return;
      setBillDiscountReq((cur) => {
        if (!cur || cur.status !== "pending") return cur;
        void refresh();
        return cur;
      });
    }, 5000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [order.cartNumber]);

  async function requestBillDiscount() {
    const discount = Math.max(0, Math.floor(Number(billDiscountInput) || 0));
    if (discount <= 0) {
      setBillDiscountError("ກະລຸນາໃສ່ຈຳນວນສ່ວນຫຼຸດ");
      return;
    }
    if (discount >= order.totalAmount) {
      setBillDiscountError("ສ່ວນຫຼຸດຕ້ອງໜ້ອຍກວ່າຍອດບິນ");
      return;
    }
    setBillDiscountError(null);
    setBillDiscountBusy(true);
    try {
      const res = await fetch("/api/price-requests/bill-discount", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cartNumber: order.cartNumber,
          originalAmount: order.totalAmount,
          discountedAmount: order.totalAmount - discount,
          reason: billDiscountReason.trim() || undefined,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setBillDiscountError(data?.error ?? `ຂໍ້ຜິດພາດ ${res.status}`);
        return;
      }
      setBillDiscountReq({
        id: String(data.id),
        originalAmount: Number(data.originalAmount),
        discountedAmount: Number(data.discountedAmount),
        status: data.status as BillDiscountStatus,
        reason: null,
        approverCode: null,
        approverNote: null,
        requestedAt: new Date().toISOString(),
        decidedAt: null,
      });
      setBillDiscountInput("");
      setBillDiscountReason("");
    } finally {
      setBillDiscountBusy(false);
    }
  }

  async function submit() {
    if (submitBusy || !canSettle) return;
    if (slipsMissing) {
      setError("ກະລຸນາແນບຮູບສະລິບການໂອນຢ່າງໜ້ອຍ 1 ຮູບ");
      return;
    }
    if (numericPayments.length === 0) {
      setError("ກະລຸນາໃສ່ຈຳນວນເງິນຮັບ");
      return;
    }
    setError(null);
    setSubmitBusy(true);
    try {
      const res = await fetch("/api/cashier/settle", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          cartNumber: order.cartNumber,
          payments: numericPayments.map((p) => ({
            currency: p.currency,
            method: p.method,
            amount: p.amount,
            // Only set on the tenders that have one; the server ignores the
            // rest. Without these a coupon line is unbookable and a
            // transfer to another account is indistinguishable from the QR.
            couponNumber: p.couponNumber,
            accountCode: p.accountCode,
          })),
          remark: remark.trim() || undefined,
          transferSlips: slips.map((s) => ({
            data: s.base64,
            mimeType: s.mimeType,
            fileName: s.fileName,
          })),
          billDiscountRequestId:
            isApprovedBillDiscount && billDiscountReq
              ? billDiscountReq.id
              : undefined,
          redeemPoints:
            redeemPointsRequested > 0 ? redeemPointsRequested : undefined,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setError(data?.error ?? `ຂໍ້ຜິດພາດ ${res.status}`);
        return;
      }
      const data = await res.json();
      onSuccess({ docNo: data.docNo, change: data.change });
      startTransition(() => {
        void reload();
      });
    } finally {
      setSubmitBusy(false);
      setAutoConfirming(false);
    }
  }

  // Pull a numeric amount out of the OnePay payment callback (field name varies
  // by BCEL payload), so we can match it against the QR amount before settling.
  function extractPaidAmount(info: unknown): number | null {
    if (!info || typeof info !== "object") return null;
    const o = info as Record<string, unknown>;
    for (const k of [
      "amount",
      "amt",
      "txnAmount",
      "trxAmount",
      "trxamount",
      "payAmount",
      "paidAmount",
      "total",
    ]) {
      const v = o[k];
      if (v != null && v !== "" && Number.isFinite(Number(v))) {
        return Math.round(Number(v));
      }
    }
    return null;
  }

  // A OnePay transfer landed while the QR was on screen → auto-confirm (settle).
  // If the callback carries an amount, it must match the QR amount so a payment
  // for another bill on the shared shop channel can't settle this one.
  function handleAutoPaid(info: unknown) {
    if (autoHandledRef.current) return;
    if (!canSettle || submitBusy) return;
    const paid = extractPaidAmount(info);
    if (
      paid != null &&
      transferQrAmount > 0 &&
      Math.abs(paid - transferQrAmount) > 1
    ) {
      return; // amount mismatch — not this bill
    }
    autoHandledRef.current = true;
    setAutoConfirming(true);
    void submit();
  }

  return (
    <div className="settle-drawer">
      <header className="settle-header">
        <div className="settle-header-identity">
          <div className="settle-header-mark">₭</div>
          <div className="min-w-0">
          <div className="settle-eyebrow">
            Sale Order {order.docNo}
            {order.receiptDocNo
              ? ` · ໃບຮັບ ${order.receiptDocNo}`
              : " · ລໍຖ້າຮັບເງິນ"}
            <StatusBadge status={order.statusLabel} />
          </div>
          <h2>{order.customerName ?? order.customerId ?? "—"}</h2>
          <p>
            {order.customerPhone ? `${order.customerPhone} · ` : ""}
            {order.salespersonName ?? order.userOwner ?? "—"}
          </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={openCustomerDisplay}
            className="odoo-btn odoo-btn-secondary"
            title="ເປີດໜ້າຈໍລູກຄ້າ (ໜ້າຕ່າງໃໝ່)"
          >
            ໜ້າຈໍລູກຄ້າ
          </button>
          <button type="button" onClick={onClose} className="odoo-btn odoo-btn-secondary">
            ✕ ປິດ
          </button>
        </div>
      </header>

      {!canSettle ? (
        <div className="settle-readonly">
          ອໍເດີນີ້ຢູ່ສະຖານະ {statusFilterLabel(order.statusLabel)}; ບໍ່ສາມາດຮັບເງິນຊ້ຳໄດ້.
        </div>
      ) : null}

      <div className="settle-layout">
        <section className="settle-left">
          <div className="settle-card">
            <div className="settle-card-title">
              <span>ລາຍລະອຽດບິນ</span>
              <strong>{order.docNo}</strong>
            </div>
            <div className="settle-detail-grid">
              <DetailRow label="ວັນທີ" value={dateTimeFmt.format(new Date(order.createdAt))} />
              <DetailRow label="ພະນັກງານຂາຍ" value={order.salespersonName ?? order.userOwner ?? "—"} />
              <DetailRow label="ລະຫັດລູກຄ້າ" value={order.customerId ?? "—"} mono={Boolean(order.customerId)} />
              <DetailRow label="ຈັດສົ່ງ" value={order.deliveryName ?? "—"} />
              <DetailRow label="ສາງ" value={order.warehouseCode ?? "—"} mono={Boolean(order.warehouseCode)} />
              <DetailRow label="ຊື່ສາງ" value={order.warehouseName ?? "—"} />
              <DetailRow label="ລາຍການ" value={moneyFmt.format(order.items.length)} mono />
              <DetailRow label="ຈຳນວນສິນຄ້າ" value={moneyFmt.format(itemQuantity)} mono />
              {order.extraDiscount > 0 ? (
                <DetailRow label="ສ່ວນຫຼຸດທ້າຍບິນ" value={`−${moneyFmt.format(order.extraDiscount)} ກີບ`} />
              ) : null}
              {order.note ? <DetailRow label="ໝາຍເຫດ" value={order.note} /> : null}
            </div>
          </div>

          <div className="settle-card settle-card--grow">
            <div className="settle-card-title">
              <span>ລາຍການສິນຄ້າ</span>
              <strong>{order.items.length}</strong>
            </div>
            <div className="settle-items">
              {order.items.map((it) => (
                <div key={it.id} className="settle-item-row">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div className="min-w-0">
                        <div className="settle-item-name">{it.itemName ?? "—"}</div>
                        <div className="settle-item-code">
                          {it.itemCode}
                          {it.unitCode ? ` · ${it.unitCode}` : ""}
                        </div>
                      </div>
                      <div className="flex shrink-0 items-center gap-3">
                        <div className="settle-item-qty">x{moneyFmt.format(it.quantity)}</div>
                        <div className="text-right">
                          {/* The line at list, and what came off it. The
                              member rate is applied per line when the order
                              is written, so the amount on its own gives the
                              cashier nothing to check the discount against
                              — or to answer a customer who asks. */}
                          {(() => {
                            const listTotal = it.unitPrice * it.quantity;
                            const off = Math.max(0, listTotal - it.amount);
                            return off > 0 ? (
                              <div className="text-[11px] font-semibold tabular-nums text-odoo-text-soft line-through">
                                {moneyFmt.format(listTotal)}
                              </div>
                            ) : null;
                          })()}
                          <div className="settle-item-amount">{moneyFmt.format(it.amount)}</div>
                        </div>
                      </div>
                    </div>
                    {(() => {
                      const listTotal = it.unitPrice * it.quantity;
                      const off = Math.max(0, listTotal - it.amount);
                      return (
                        <div className="mt-0.5 text-[10px] font-semibold tabular-nums text-odoo-text-muted">
                          {moneyFmt.format(it.unitPrice)} × {moneyFmt.format(it.quantity)}
                          {off > 0 ? (
                            <span className="ml-2 rounded bg-rose-50 px-1.5 py-0.5 font-bold text-odoo-danger">
                              ຫຼຸດ {moneyFmt.format(off)}
                            </span>
                          ) : null}
                        </div>
                      );
                    })()}
                    <div className="mt-0.5 flex flex-wrap gap-1 text-[10px] text-odoo-text-muted">
                      {it.whCode ? (
                        <span title={it.whName ?? ""}>
                          ສາງ: {it.whName ?? it.whCode}
                        </span>
                      ) : null}
                      {it.shelfCode ? (
                        <span title={it.shelfName ?? ""}>
                          · ທີ່ເກັບ: {it.shelfName ?? it.shelfCode}
                        </span>
                      ) : null}
                      {it.salespersonName || it.saleCode ? (
                        <span>· ຜູ້ຂາຍ: {it.salespersonName ?? it.saleCode}</span>
                      ) : null}
                    </div>
                    {it.setDetails.length > 0 ? (
                      <ul className="mt-1 ml-2 border-l-2 border-odoo-border pl-2">
                        {it.setDetails.map((sd) => (
                          <li
                            key={sd.itemCode}
                            className="flex items-start justify-between gap-2 py-0.5 text-[11px] text-odoo-text-muted"
                          >
                            <div className="min-w-0 break-words">
                              <span className="font-semibold text-odoo-text-strong">
                                {sd.itemName ?? sd.itemCode}
                              </span>
                              <span className="ml-1 font-mono">{sd.itemCode}</span>
                            </div>
                            <div className="shrink-0 font-mono font-semibold">
                              {moneyFmt.format(sd.quantity * it.quantity)}
                              {sd.unitCode ? ` ${sd.unitCode}` : ""}
                            </div>
                          </li>
                        ))}
                      </ul>
                    ) : null}
                  </div>
                </div>
              ))}
            </div>

            {/* What the bill came to, and how. The cashier is the one who
                has to answer "why is it this much" while the customer is
                standing there, so the arithmetic is on their screen too,
                not only on the customer's. */}
            <div className="settle-bill-sum">
              <div>
                <span>ລາຄາເຕັມ</span>
                <b>{moneyFmt.format(grossListTotal)}</b>
              </div>
              {lineDiscountTotal > 0 ? (
                <div className="is-off">
                  <span>ສ່ວນຫຼຸດ</span>
                  <b>−{moneyFmt.format(lineDiscountTotal)}</b>
                </div>
              ) : null}
              {billDiscountAmount > 0 ? (
                <div className="is-off">
                  <span>ຫຼຸດທ້າຍບິນ</span>
                  <b>−{moneyFmt.format(billDiscountAmount)}</b>
                </div>
              ) : null}
              {redeemKipValue > 0 ? (
                <div className="is-off">
                  <span>ໃຊ້ {moneyFmt.format(redeemPointsRequested)} ແຕ້ມ</span>
                  <b>−{moneyFmt.format(redeemKipValue)}</b>
                </div>
              ) : null}
              <div className="is-net">
                <span>ລາຄາຫຼັງສ່ວນຫຼຸດ</span>
                <b>{moneyFmt.format(effectiveTotal)}</b>
              </div>
            </div>

            {/* Points. The one the customer asks about is the last line. */}
            {order.earnedPoints > 0 || (redeemInfo?.pointBalance ?? 0) > 0 ? (
              <div className="settle-points-sum">
                <div>
                  <span>ແຕ້ມສະສົມເດີມ</span>
                  <b>{moneyFmt.format(redeemInfo?.pointBalance ?? 0)}</b>
                </div>
                <div className="is-plus">
                  <span>ແຕ້ມທີ່ໄດ້ຮັບ</span>
                  <b>+{moneyFmt.format(order.earnedPoints)}</b>
                </div>
                {redeemPointsRequested > 0 ? (
                  <div className="is-minus">
                    <span>ແຕ້ມທີ່ໃຊ້ໄປ</span>
                    <b>−{moneyFmt.format(redeemPointsRequested)}</b>
                  </div>
                ) : null}
                <div className="is-net">
                  <span>★ ລວມແຕ້ມທັງໝົດ</span>
                  <b>
                    {moneyFmt.format(
                      Math.max(
                        0,
                        (redeemInfo?.pointBalance ?? 0) +
                          order.earnedPoints -
                          redeemPointsRequested,
                      ),
                    )}
                  </b>
                </div>
              </div>
            ) : null}
          </div>
        </section>

        <aside
          className="settle-payment"
          // Enter settles, the way a till does — the cashier types the cash
          // they were handed and presses it. Only once the bill is actually
          // covered, and never while a coupon number is being entered,
          // where Enter already means "look this up".
          onKeyDown={(e) => {
            if (e.key !== "Enter" || e.shiftKey) return;
            if (addingCoupon) return;
            const el = e.target as HTMLElement | null;
            if (el && (el.tagName === "BUTTON" || el.tagName === "SELECT")) return;
            if (
              !canSettle ||
              submitBusy ||
              awaitingApproval ||
              paidInMain < effectiveTotal
            ) {
              return;
            }
            e.preventDefault();
            void submit();
          }}
        >
          <div className="settle-payment-summary">
            <div className="settle-total-card">
              <div className="settle-total-main">
                <span>ຍອດຕ້ອງຮັບ</span>
                <div>
                  <strong>{moneyFmt.format(effectiveTotal)}</strong>
                  <small>ກີບ</small>
                </div>
              </div>
              {billDiscountAmount > 0 ? (
                <p>ຫຼຸດອະນຸມັດ {moneyFmt.format(billDiscountAmount)} ກີບ ຈາກ {moneyFmt.format(order.totalAmount)}</p>
              ) : billDifference !== 0 ? (
                <p>ປັບຍອດ {moneyFmt.format(billDifference)} ກີບ</p>
              ) : null}
              {/* The running state, on the same block as the amount it is
                  running against. As its own red panel underneath, it was
                  a second coloured slab saying a number that only means
                  anything next to this one. */}
              <div className="settle-total-state">
                <span>
                  {remainingDue > 0
                    ? "ຍັງຂາດ"
                    : changeDue > 0
                      ? "ຕ້ອງທອນ"
                      : "ຮັບຄົບພໍດີ"}
                </span>
                <b className={remainingDue > 0 ? "is-short" : "is-ok"}>
                  {moneyFmt.format(remainingDue > 0 ? remainingDue : changeDue)}
                </b>
              </div>
            </div>


          </div>

          <div className="settle-payment-body">
          {/* ── Tenders ────────────────────────────────────────────
              The screen has one job: get "ຍັງຂາດ" to zero.

              Five methods laid out as five open boxes made a form long
              enough to scroll, and left the cashier adding up in their
              head what was still owed. Instead the methods that are in
              use are rows, the ones that are not are chips, and the
              figure at the top counts down as rows are added. Tapping a
              chip fills it with the whole remainder, because one method
              paying the lot is what usually happens — a split is the
              exception and only the exception has to be typed. */}
          <div className="settle-card">
            <div className="settle-card-title">
              <span className="flex items-center gap-2">
                <i className="settle-step">1</i>
                ຮັບເງິນ
              </span>
              {tenderRows.length > 1 ? (
                <strong className="settle-pay-curtag">
                  {tenderRows.length} ວິທີ
                </strong>
              ) : null}
            </div>

            {tenderRows.map((t) => (
              <div key={t.key} className="settle-tender-row">
                <i
                  className="settle-tender-dot"
                  style={{ background: t.colour }}
                  aria-hidden
                />
                <div className="settle-tender-who">
                  <b>{t.label}</b>
                  {t.source ? <small>{t.source}</small> : null}
                </div>
                <input
                  type="number"
                  inputMode="numeric"
                  min={0}
                  max={t.max}
                  step={1000}
                  value={t.amount || ""}
                  placeholder="0"
                  disabled={!canSettle || t.readOnly}
                  onChange={(e) => t.setAmount(Number(e.target.value) || 0)}
                />
                <button
                  type="button"
                  className="settle-tender-x"
                  disabled={!canSettle}
                  onClick={() => t.remove()}
                  aria-label="ເອົາອອກ"
                >
                  ✕
                </button>
              </div>
            ))}

            {/* The keypad. Counting cash into a small number field is the
                slowest and most error-prone thing on this screen, and the
                one done most often — on a touchscreen till especially. It
                types into cash, because that is the tender you count; the
                others arrive as whole amounts. */}
            <div className="settle-pad-wrap">
            <div className="settle-pad-col">
            <div className="settle-pad-head">
              <span>ເງິນສົດທີ່ຮັບ</span>
              <b>{moneyFmt.format(cashNow)}</b>
              <i>ກີບ</i>
            </div>
            <div className="settle-pad">
              {["7", "8", "9", "4", "5", "6", "1", "2", "3"].map((d) => (
                <button
                  key={d}
                  type="button"
                  disabled={!canSettle}
                  onClick={() => pressDigit(d)}
                >
                  {d}
                </button>
              ))}
              <button
                type="button"
                className="is-util"
                disabled={!canSettle}
                onClick={() => pressDigit("000")}
              >
                000
              </button>
              <button
                type="button"
                disabled={!canSettle}
                onClick={() => pressDigit("0")}
              >
                0
              </button>
              <button
                type="button"
                className="is-util is-clear"
                disabled={!canSettle}
                onClick={backspace}
              >
                ⌫
              </button>
            </div>
            </div>

            {/* Counting cash out of a customer's hand is where the typing
                actually happens. "ພໍດີ" is the common case; the round-ups
                are what someone hands over when they do not have it exact,
                and each one is the smallest note-sized figure that covers
                what is left — so the change works itself out. */}
            {remainingDue + cashNow > 0 ? (
              <div className="settle-cash-quick">
                {(() => {
                  // What cash still has to cover, ignoring what is already
                  // typed into it.
                  const need = Math.max(0, remainingDue + cashNow - 0);
                  const steps = [10000, 100000, 1000000];
                  const opts: Array<{ label: string; value: number }> = [
                    // Named and figured: on its own the word read as a
                    // heading over the round-ups rather than the first of
                    // them.
                    { label: `ພໍດີ ${moneyFmt.format(need)}`, value: need },
                  ];
                  for (const step of steps) {
                    const up = Math.ceil(need / step) * step;
                    // Only worth a button if it is actually more than the
                    // exact figure and not a repeat of a smaller step.
                    if (up > need && !opts.some((o) => o.value === up)) {
                      opts.push({ label: moneyFmt.format(up), value: up });
                    }
                  }
                  return opts.slice(0, 4).map((o) => (
                    <button
                      key={o.value}
                      type="button"
                      className={
                        "settle-cash-quick-btn" +
                        (cashNow === o.value ? " is-on" : "")
                      }
                      disabled={!canSettle}
                      onClick={() => setInput(cashKey, o.value)}
                    >
                      {o.label}
                    </button>
                  ));
                })()}
              </div>
            ) : null}
            </div>

            {/* Only the methods not already on the bill. Cash is always
                offered — it is the one that can absorb an overpayment. */}
            <div className="settle-tender-chips">
              {tenderChips.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  className="settle-tender-chip"
                  disabled={!canSettle}
                  onClick={c.add}
                >
                  <i style={{ background: c.colour }} aria-hidden />
                  {c.label}
                </button>
              ))}
            </div>

            {/* Coupon and other-account need their source before they can
                carry an amount, so they get one line of input each — shown
                only while that method is being added. */}
            {addingCoupon ? (
              <div className="settle-tender-add">
                <input
                  type="text"
                  autoFocus
                  value={couponInput}
                  disabled={couponBusy}
                  placeholder="ເລກ coupon — ພິມ ຫຼື ສະແກນ"
                  onChange={(e) => setCouponInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      void addCoupon();
                    }
                  }}
                />
                <button
                  type="button"
                  className="odoo-btn odoo-btn-secondary"
                  disabled={couponBusy || !couponInput.trim()}
                  onClick={() => void addCoupon()}
                >
                  {couponBusy ? "ກຳລັງກວດ..." : "ກວດ"}
                </button>
                <button
                  type="button"
                  className="settle-tender-x"
                  onClick={() => {
                    setAddingCoupon(false);
                    setCouponError(null);
                    setCouponInput("");
                  }}
                  aria-label="ຍົກເລີກ"
                >
                  ✕
                </button>
              </div>
            ) : null}
            {couponError ? (
              <div className="settle-tender-err">{couponError}</div>
            ) : null}

            {addingOther ? (
              <div className="settle-tender-add">
                <select
                  autoFocus
                  value={otherAccount}
                  onChange={(e) => {
                    setOtherAccount(e.target.value);
                    if (e.target.value && !Number(otherAmount)) {
                      setOtherAmount(String(fill));
                      takeFromCash(fill);
                    }
                  }}
                >
                  <option value="">— ເລືອກບັນຊີ —</option>
                  {otherAccounts.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.code} · {a.name}
                    </option>
                  ))}
                </select>
                <button
                  type="button"
                  className="settle-tender-x"
                  onClick={() => {
                    setAddingOther(false);
                    setOtherAccount("");
                    setOtherAmount("");
                  }}
                  aria-label="ຍົກເລີກ"
                >
                  ✕
                </button>
              </div>
            ) : null}

            {/* THB stays a footnote: it is the same cash, counted in the
                other currency, and most bills never touch it. */}
            <button
              type="button"
              className="settle-thb-toggle"
              onClick={() => setShowThb((v) => !v)}
            >
              {showThb ? "▾" : "▸"} ຮັບເປັນເງິນບາດ (THB)
              {currencyRates["01"] ? (
                <em>1 ฿ ≈ {moneyFmt.format(currencyRates["01"])} ກີບ</em>
              ) : null}
            </button>
            {showThbInputs
              ? (["cash", "transfer"] as const).map((m) => (
                  <div key={m} className="settle-tender-add">
                    <span className="settle-tender-thb-label">
                      {m === "cash" ? "ສົດ ບາດ" : "ໂອນ ບາດ"}
                    </span>
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      value={paymentInputs[paymentKey("01", m)] ?? "0"}
                      disabled={!canSettle}
                      onChange={(e) =>
                        setPaymentInputs((prev) => ({
                          ...prev,
                          [paymentKey("01", m)]: e.target.value,
                        }))
                      }
                    />
                  </div>
                ))
              : null}
          </div>

          {qrPaymentSelected || transferInMain > 0 ? (
            <div className="settle-card settle-qr-card">
              {/* The code itself belongs on the customer's screen — that
                  is the screen they scan. A second copy here was taking a
                  third of the cashier's panel to show them something they
                  never look at; what the cashier needs is the amount and
                  whether the money has landed. */}
              <div className="settle-card-title">
                <span className="flex items-center gap-2">
                  <i className="settle-step">2</i>
                  ລູກຄ້າໂອນ — QR ຢູ່ໜ້າຈໍລູກຄ້າ
                </span>
                <strong className="settle-pay-curtag">
                  {moneyFmt.format(transferQrAmount)} ₭
                </strong>
              </div>
              {transferQrAmount > 0 ? null : (
                // Cash is covering the whole bill, so there is nothing
                // left to transfer. Say so — and the card stays put rather
                // than vanishing and taking the payment listener with it.
                <p className="settle-qr-none">
                  ບໍ່ມີຍອດຕ້ອງໂອນ — ເງິນສົດຄຸ້ມທັງບິນແລ້ວ
                </p>
              )}
              {/* Listen for the OnePay payment push while this QR is on screen. */}
              <OnePayWatcher
                active={qrPaymentSelected && transferInMain > 0 && canSettle}
                onPaid={handleAutoPaid}
              />
              {autoConfirming ? (
                <div className="mt-2 flex items-center justify-center gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-sm font-bold text-emerald-700">
                  <span className="h-2.5 w-2.5 animate-ping rounded-full bg-emerald-500" />
                  ✓ ລູກຄ້າໂອນສຳເລັດ — ກຳລັງຢືນຢັນອັດຕະໂນມັດ...
                </div>
              ) : (
                <>
                  <p className="mt-1 text-center text-xs text-odoo-text-muted">
                    ⏳ ລໍຖ້າການໂອນ · ລະບົບຈະຢືນຢັນໃຫ້ອັດຕະໂນມັດເມື່ອລູກຄ້າໂອນສຳເລັດ
                  </p>
                  {testTransfer ? (
                    <p className="mt-1 text-center text-[11px] font-bold text-odoo-danger">
                      ⚠ ໂໝດທົດສອບ: QR = 1 ກີບ (ຍອດຈິງ {moneyFmt.format(Math.round(transferInMain))} ₭) · ປິດໄດ້ທີ່ ຕັ້ງຄ່າ › ໂໝດທົດສອບ
                    </p>
                  ) : (
                    <p className="mt-1 text-center text-xs text-odoo-text-muted">
                      ໃຫ້ລູກຄ້າສະແກນຈາກໜ້າຈໍລູກຄ້າ
                    </p>
                  )}
                </>
              )}
            </div>
          ) : null}

          <BillDiscountPanel
            canSettle={canSettle}
            totalAmount={order.totalAmount}
            input={billDiscountInput}
            setInput={setBillDiscountInput}
            reasonInput={billDiscountReason}
            setReasonInput={setBillDiscountReason}
            request={billDiscountReq}
            busy={billDiscountBusy}
            error={billDiscountError}
            onRequest={() => void requestBillDiscount()}
          />

          {POINTS_REDEEM_ENABLED &&
          canSettle &&
          redeemInfo &&
          redeemInfo.isActive &&
          redeemInfo.customerCode ? (
            <div className="settle-card">
              <div className="settle-card-title">
                <span>ໃຊ້{redeemInfo.pointName ?? "ແຕ້ມສະສົມ"}</span>
                <strong>ມີ {redeemInfo.pointBalance.toLocaleString("en-US")} ແຕ້ມ</strong>
              </div>
              <div className="settle-simple-row">
                <label className="settle-simple-field">
                  <span>ແຕ້ມທີ່ໃຊ້</span>
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    max={redeemInfo.pointBalance}
                    step={1}
                    value={redeemInput}
                    onChange={(e) => setRedeemInput(e.target.value)}
                    placeholder="0"
                    className="odoo-input"
                  />
                </label>
                <div className="settle-simple-field">
                  <span>ສ່ວນຫຼຸດ (ກີບ)</span>
                  <div className="settle-simple-value">
                    {moneyFmt.format(redeemKipValue)}
                  </div>
                </div>
              </div>
              <div className="settle-simple-hint">
                ອັດຕາ {redeemInfo.redeemPointsPerKip.toLocaleString("en-US")} ແຕ້ມ = 1 ກີບ
                {redeemInfo.minRedeemPoints > 0
                  ? ` · ຂັ້ນຕ່ຳ ${redeemInfo.minRedeemPoints.toLocaleString("en-US")} ແຕ້ມ`
                  : ""}
              </div>
            </div>
          ) : null}

          {canSettle && needsSlip ? (
            <div className="settle-card">
              <div className="settle-card-title">
                <span className="flex items-center gap-2">
                  <i className="settle-step">3</i>
                  ສະລິບການໂອນ
                </span>
                <strong>{slips.length}/{SLIP_MAX_COUNT}</strong>
              </div>
              <button
                type="button"
                disabled={slipBusy || slips.length >= SLIP_MAX_COUNT}
                onClick={() => fileInputRef.current?.click()}
                className="settle-upload"
              >
                {slipBusy ? "ກຳລັງປະມວນຜົນ..." : "+ ເພີ່ມຮູບສະລິບ"}
              </button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                multiple
                className="hidden"
                onChange={(e) => void handleSlipFiles(e.target.files)}
              />
              {slips.length === 0 ? (
                <div className={slipsMissing ? "settle-slip-empty settle-slip-required" : "settle-slip-empty"}>
                  ກະລຸນາແນບຮູບສະລິບການໂອນຢ່າງໜ້ອຍ 1 ຮູບ
                </div>
              ) : (
                <div className="settle-slip-grid">
                  {slips.map((s) => (
                    <div key={s.id} className="settle-slip">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={s.previewUrl} alt={s.fileName} />
                      <button type="button" onClick={() => removeSlip(s.id)} aria-label={`ລົບ ${s.fileName}`}>×</button>
                      <span>{Math.round(s.size / 1024)} KB</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          ) : null}

          <label className="settle-note">
            <span>ໝາຍເຫດ</span>
            <input
              type="text"
              value={remark}
              disabled={!canSettle}
              onChange={(e) => setRemark(e.target.value)}
              placeholder="ບໍ່ບັງຄັບ"
            />
          </label>

          {error ? <div className="odoo-alert-danger px-3 py-2 text-sm">{error}</div> : null}

          </div>

          {/* Outside the scroll pane on purpose. As the last item
              inside it — pinned with position:sticky over a
              translucent background — every row above scrolled
              underneath and read through it, so the discount line
              appeared to sit on top of the buttons. A footer is a
              region of the panel, not an item in the list above it. */}
          <div className="settle-actions">
            <button
              type="button"
              disabled={isDeleting || isPending || submitBusy}
              onClick={onDelete}
              className="odoo-btn odoo-btn-danger"
            >
              {isDeleting ? "ກຳລັງລົບ..." : "ລົບອໍເດີຂາຍ"}
            </button>
            {canSettle ? (
              <button
                type="button"
                disabled={isPending || submitBusy}
                onClick={onHold}
                className="odoo-btn"
                title="ພັກບິນໄວ້ ໃຫ້ກັບມາຄິດເງິນພາຍຫຼັງ"
              >
                ພັກບິນ
              </button>
            ) : order.statusLabel === "HELD" ? (
              <button
                type="button"
                disabled={isPending || submitBusy}
                onClick={onResume}
                className="odoo-btn"
                title="ກັບສະຖານະປົກກະຕິ"
              >
                ກັບເຮັດຕໍ່
              </button>
            ) : null}
            <button
              type="button"
              disabled={
                !canSettle ||
                isPending ||
                submitBusy ||
                slipBusy ||
                slipsMissing ||
                awaitingApproval ||
                paidInMain < effectiveTotal
              }
              onClick={submit}
              className="odoo-btn odoo-btn-primary"
            >
              {submitBusy
                ? "ກຳລັງບັນທຶກ..."
                : awaitingApproval
                  ? "ລໍຖ້າອະນຸມັດສ່ວນຫຼຸດ..."
                  : remainingDue > 0
                    ? // A greyed-out button with no reason on it is a
                      // dead end. Say what is missing.
                      `ຍັງຂາດ ${moneyFmt.format(remainingDue)}`
                    : changeDue > 0
                      ? `ຮັບເງິນ · ທອນ ${moneyFmt.format(changeDue)}`
                      : "ບັນທຶກ ແລະ ຮັບເງິນ"}
            </button>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BillDiscountPanel({
  canSettle,
  totalAmount,
  input,
  setInput,
  reasonInput,
  setReasonInput,
  request,
  busy,
  error,
  onRequest,
}: {
  canSettle: boolean;
  totalAmount: number;
  input: string;
  setInput: (v: string) => void;
  reasonInput: string;
  setReasonInput: (v: string) => void;
  request: BillDiscountRequest | null;
  busy: boolean;
  error: string | null;
  onRequest: () => void;
}) {
  const status = request?.status;
  const banner = (() => {
    if (!request) return null;
    if (status === "pending") {
      return (
        <div className="odoo-alert mt-2 rounded-md border border-odoo-warning-border bg-odoo-warning-bg px-3 py-2 text-xs text-odoo-warning">
          ⏳ ສົ່ງຄຳຂໍແລ້ວ ({moneyFmt.format(request.originalAmount - request.discountedAmount)} ກີບ) — ລໍຖ້າຜູ້ຈັດການອະນຸມັດ.
        </div>
      );
    }
    if (status === "approved") {
      return (
        <div className="odoo-alert-success mt-2 rounded-md px-3 py-2 text-xs">
          ✓ ອະນຸມັດ {moneyFmt.format(request.originalAmount - request.discountedAmount)} ກີບ
          {request.approverNote ? ` — ${request.approverNote}` : ""}
        </div>
      );
    }
    if (status === "rejected") {
      return (
        <div className="odoo-alert-danger mt-2 rounded-md px-3 py-2 text-xs">
          ✗ ປະຕິເສດ{request.approverNote ? `: ${request.approverNote}` : ""}
        </div>
      );
    }
    if (status === "used") {
      return (
        <div className="mt-2 rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-2 text-xs text-odoo-text-muted">
          ສ່ວນຫຼຸດທີ່ອະນຸມັດ ({moneyFmt.format(request.originalAmount - request.discountedAmount)} ກີບ) ໄດ້ໃຊ້ແລ້ວໃນບິນນີ້.
        </div>
      );
    }
    return null;
  })();

  const showInputs =
    canSettle && (!status || status === "rejected");

  return (
    <div className="sm:col-span-2 rounded-md border border-dashed border-odoo-border bg-white p-3">
      <div className="flex items-center justify-between gap-2">
        <label className="text-xs font-semibold text-odoo-text">
          ສ່ວນຫຼຸດທ້າຍບິນ (ຕ້ອງອະນຸມັດ)
        </label>
        <span className="text-[10px] text-odoo-text-muted">
          ບິນ: {moneyFmt.format(totalAmount)} ກີບ
        </span>
      </div>
      {showInputs ? (
        <div className="mt-2 grid gap-2 sm:grid-cols-[1fr_2fr_auto]">
          <input
            type="number"
            min={0}
            step={1000}
            inputMode="decimal"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="ຈຳນວນ (ກີບ)"
            className="odoo-input text-right font-mono"
          />
          <input
            type="text"
            value={reasonInput}
            onChange={(e) => setReasonInput(e.target.value)}
            placeholder="ເຫດຜົນ (ສຳລັບຜູ້ຈັດການ)"
            className="odoo-input"
          />
          <button
            type="button"
            disabled={busy || !input.trim()}
            onClick={onRequest}
            className="odoo-btn odoo-btn-secondary"
          >
            {busy ? "ສົ່ງ..." : "ສົ່ງຄຳຂໍ"}
          </button>
        </div>
      ) : null}
      {error ? (
        <div className="mt-1 text-[11px] text-odoo-danger">{error}</div>
      ) : null}
      {banner}
    </div>
  );
}

function SummaryCard({
  label,
  value,
  tone,
  active,
  onClick,
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "emerald" | "red" | "sky";
  /** With onClick the card IS the filter; active marks the one in force. */
  active?: boolean;
  onClick?: () => void;
}) {
  const styles = {
    slate:
      "border-slate-200 bg-white text-slate-800",
    amber:
      "border-amber-200 bg-amber-50/50 text-amber-700",
    emerald:
      "border-emerald-200 bg-emerald-50/50 text-emerald-700",
    red: "border-rose-200 bg-rose-50/50 text-rose-700",
    sky: "border-sky-200 bg-sky-50/50 text-sky-700",
  };
  const body = (
    <>
      <div className="text-xs font-semibold text-current/65">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold">
        {moneyFmt.format(value)}
      </div>
    </>
  );
  const frame = `rounded-xl border p-4 shadow-sm transition-all duration-300 ${styles[tone]}`;
  if (!onClick) return <div className={frame}>{body}</div>;
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${frame} text-left hover:shadow-md ${
        active
          ? "ring-2 ring-current/40 shadow-md"
          : "opacity-90 hover:opacity-100"
      }`}
    >
      {body}
    </button>
  );
}

function SuccessModal({
  success,
  onClose,
}: {
  success: { docNo: string; change: number };
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="ປິດ modal"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-md border border-odoo-success-border bg-white p-6 text-center shadow-xl">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-md bg-odoo-success text-white">
          <CheckIcon />
        </div>
        <h2 className="mt-4 text-lg font-bold text-odoo-success">
          ຮັບເງິນສຳເລັດ
        </h2>
        <div className="mt-3 text-sm text-odoo-text">
          ເລກທີເອກະສານ
          <span className="ml-2 font-mono text-base font-bold text-odoo-text-strong">
            {success.docNo}
          </span>
        </div>
        {success.change > 0 ? (
          <div className="mt-1 text-sm text-odoo-success">
            ເງິນທອນ{" "}
            <span className="font-mono font-bold">
              {moneyFmt.format(success.change)} ກີບ
            </span>
          </div>
        ) : null}
        {/* Taking the money is not the last step — handing over the receipt
            is. settle already returns the CAKAP number this modal is
            showing, and /cashier/receipts/[docNo] renders and prints it,
            but the only way in was a 10px link in the queue table that
            appears after the fact. Opening in a new tab leaves the queue
            where it is, ready for the next customer. */}
        <div className="mt-5 flex items-center gap-2">
          <button
            type="button"
            onClick={onClose}
            className="odoo-btn flex-1 justify-center"
          >
            ຕົກລົງ
          </button>
          <a
            href={`/cashier/receipts/${encodeURIComponent(success.docNo)}`}
            target="_blank"
            rel="noopener"
            className="odoo-btn odoo-btn-primary flex-1 justify-center gap-2"
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
              <path d="M6 9V3h12v6" />
              <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
              <path d="M6 14h12v7H6z" />
            </svg>
            ພິມໃບຮັບເງິນ
          </a>
        </div>
      </div>
    </div>
  );
}

function DetailRow({
  label,
  value,
  mono = false,
  valueClass,
}: {
  label: string;
  value: string;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className="flex items-start justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-xs font-semibold text-odoo-text-muted">
        {label}
      </span>
      <span
        className={
          valueClass ??
          ("text-right font-semibold text-odoo-text-strong" +
            (mono ? " font-mono" : ""))
        }
      >
        {value}
      </span>
    </div>
  );
}

function StatusBadge({ status }: { status: CashierOrder["statusLabel"] }) {
  const style =
    status === "COMPLETED"
      ? "odoo-pill-success"
      : status === "CANCELLED"
        ? "odoo-pill-danger"
        : status === "SCHEDULED"
          ? "odoo-pill-info"
          : status === "HELD"
            ? "odoo-pill-muted"
            : "odoo-pill-warning";
  const label =
    status === "COMPLETED"
      ? "ຮັບເງິນສຳເລັດ"
      : status === "CANCELLED"
        ? "ຍົກເລີກ"
        : status === "SCHEDULED"
          ? "ຈັດຖ້ຽວ"
          : status === "HELD"
            ? "ພັກໄວ້"
            : "ລໍຖ້າຮັບເງິນ";

  return (
    <span className={`odoo-pill ${style}`}>
      {label}
    </span>
  );
}

function RefreshIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-4 w-4"
    >
      <path d="M3 12a9 9 0 1 0 3-6.7" />
      <polyline points="3 4 3 10 9 10" />
    </svg>
  );
}

function CashIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <rect x="2" y="6" width="20" height="12" rx="2" />
      <circle cx="12" cy="12" r="2.5" />
      <path d="M6 10v.01M18 14v.01" />
    </svg>
  );
}

function TagIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
      <circle cx="7" cy="7" r="1.2" />
    </svg>
  );
}

function CheckIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="h-7 w-7"
    >
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}
