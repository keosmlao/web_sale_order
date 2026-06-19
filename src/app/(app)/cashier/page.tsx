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
import ShiftBar from "./ShiftBar";
import LowStockBanner from "./LowStockBanner";
import {
  publishCustomerDisplay,
  openCustomerDisplayWindow,
  subscribeCustomerDisplay,
  IDLE_DISPLAY_STATE,
} from "@/lib/customer-display";
import TransferQr from "@/components/TransferQr";
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

const dateTimeFmt = new Intl.DateTimeFormat("en-GB", {
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
});

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
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("ALL");
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
    <div className="px-4 py-5 sm:px-6 lg:px-8">
      <ShiftBar />
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
        <div className="fixed inset-0 z-50 flex justify-end bg-black/40 backdrop-blur-sm">
          <button
            type="button"
            aria-label="ປິດໜ້າລາຍລະອຽດ"
            className="absolute inset-0 cursor-default"
            onClick={() => setSelectedCart(null)}
          />
          <aside className="cashier-drawer relative flex h-dvh max-h-dvh w-full max-w-[1180px] flex-col overflow-hidden border-l border-odoo-border bg-odoo-surface">
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
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard label="ລໍຖ້າຮັບເງິນ" value={counts.PENDING} tone="amber" />
        <SummaryCard label="ຮັບເງິນສຳເລັດ" value={counts.COMPLETED} tone="emerald" />
        <SummaryCard label="ຈັດຖ້ຽວ" value={counts.SCHEDULED} tone="slate" />
        <SummaryCard label="ຍົກເລີກ" value={counts.CANCELLED} tone="red" />
      </div>

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
          <div className="flex flex-wrap gap-2">
            {(["ALL", "PENDING", "HELD", "COMPLETED", "SCHEDULED", "CANCELLED"] as StatusFilter[]).map(
              (status) => (
                <button
                   key={status}
                   type="button"
                   onClick={() => onStatusFilterChange(status)}
                   className={
                     "rounded-md px-2.5 py-1.5 text-xs font-semibold transition " +
                     (statusFilter === status
                       ? "bg-odoo-primary text-white"
                       : "bg-odoo-surface-muted text-odoo-text hover:bg-odoo-border")
                   }
                >
                  {statusFilterLabel(status)} {counts[status]}
                </button>
              ),
            )}
          </div>
        </div>

        <div className="overflow-x-auto rounded-md border border-odoo-border bg-odoo-surface">
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
                      <td className="px-3 py-2 text-[12px]">
                        {(() => {
                          const warehouses = new Map<string, string>();
                          for (const it of o.items) {
                            if (it.whCode) {
                              warehouses.set(it.whCode, it.whName ?? it.whCode);
                            }
                          }
                          const label = warehouses.size === 0
                            ? (o.warehouseName ?? o.warehouseCode ?? "—")
                            : warehouses.size === 1
                              ? Array.from(warehouses.values())[0]
                              : `ຫຼາຍສາງ (${warehouses.size})`;
                          const titleText = Array.from(warehouses.values()).join(", ");
                          return (
                            <span className="inline-flex items-center gap-1 rounded bg-indigo-50 border border-indigo-150 px-2 py-0.5 text-[11px] font-semibold text-indigo-700" title={titleText}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><path d="M3 9 12 4l9 5-9 5-9-5Z" /><path d="M3 9v6l9 5 9-5V9" /></svg>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-[12px]">
                        {(() => {
                          const salespeople = new Map<string, string>();
                          for (const it of o.items) {
                            if (it.saleCode) {
                              salespeople.set(it.saleCode, it.salespersonName ?? it.saleCode);
                            }
                          }
                          const label = salespeople.size === 0
                            ? (o.salespersonName ?? o.userOwner ?? "—")
                            : salespeople.size === 1
                              ? Array.from(salespeople.values())[0]
                              : `ຫຼາຍຄົນ (${salespeople.size})`;
                          const titleText = Array.from(salespeople.values()).join(", ");
                          return (
                            <span className="inline-flex items-center gap-1 rounded bg-slate-150 border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-700" title={titleText}>
                              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="h-3 w-3"><circle cx="12" cy="8" r="4" /><path d="M4 20c0-3 4-5 8-5s8 2 8 5" /></svg>
                              {label}
                            </span>
                          );
                        })()}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <span className="inline-flex items-center justify-center rounded-full bg-violet-600 px-2 py-0.5 text-[10px] font-bold text-white shadow-sm">
                          {moneyFmt.format(o.items.length)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-right">
                        <div className="font-mono font-bold">
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
    init[paymentKey(MAIN_CURRENCY, "cash")] = String(order.totalAmount);
    return init;
  });
  const [remark, setRemark] = useState("");
  const [error, setError] = useState<string | null>(null);
  // THB is the secondary currency — keep its inputs collapsed until needed so
  // the common LAK-only flow stays uncluttered.
  const [showThb, setShowThb] = useState(false);
  const [qrPaymentSelected, setQrPaymentSelected] = useState(false);
  const [slips, setSlips] = useState<AttachedSlip[]>([]);
  const [slipBusy, setSlipBusy] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [submitBusy, setSubmitBusy] = useState(false);
  const [isPending, startTransition] = useTransition();

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
  const numericPayments = useMemo(() => {
    const list: Array<{
      currency: CurrencyCode;
      method: PayMethod;
      amount: number;
      inMain: number;
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
    return list;
  }, [paymentInputs, currencyRates]);

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
  const cashKipKey = paymentKey(MAIN_CURRENCY, "cash");
  const transferKipKey = paymentKey(MAIN_CURRENCY, "transfer");
  const cashKipInput = paymentInputs[cashKipKey] ?? "0";
  const transferKipInput = paymentInputs[transferKipKey] ?? "0";

  // QR transfer is always the exact bill balance. If a discount or points
  // redemption changes the balance after QR was selected, refresh the amount
  // automatically so the cashier never has to type or correct it.
  useEffect(() => {
    if (!qrPaymentSelected) return;
    resetPayments({ [transferKipKey]: String(effectiveTotal) });
  }, [effectiveTotal, qrPaymentSelected, transferKipKey]);

  // Total transfer in KIP (any currency) — drives the BCEL QR on the customer
  // screen.
  const transferInMain = numericPayments
    .filter((p) => p.method === "transfer")
    .reduce((s, p) => s + p.inMain, 0);

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
      })),
      total: effectiveTotal,
      paid: paidInMain,
      changeDue,
      remainingDue,
      transferAmount: Math.round(transferInMain),
      updatedAt: Date.now(),
    }),
    [
      order,
      effectiveTotal,
      paidInMain,
      changeDue,
      remainingDue,
      transferInMain,
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
    window.setTimeout(() => publishCustomerDisplay(displaySnapshot), 900);
  }

  function resetPayments(next: Partial<Record<PaymentField, string>>) {
    const reset: Record<PaymentField, string> = {} as Record<PaymentField, string>;
    for (const k of PAYMENT_FIELDS) reset[k] = "0";
    setPaymentInputs({ ...reset, ...next });
  }

  function selectQrPayment() {
    setQrPaymentSelected(true);
    resetPayments({ [transferKipKey]: String(effectiveTotal) });
    openCustomerDisplay();
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
    }
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
                        <div className="settle-item-amount">{moneyFmt.format(it.amount)}</div>
                      </div>
                    </div>
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
          </div>
        </section>

        <aside className="settle-payment">
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
            </div>

            <div className="settle-paid-grid">
              <div className={paidInMain < effectiveTotal ? "settle-paid-danger" : "settle-paid-ok"}>
                <span>ຮັບຈິງ</span>
                <strong>{moneyFmt.format(paidInMain)}</strong>
              </div>
              <div className={remainingDue > 0 ? "settle-paid-danger" : changeDue > 0 ? "settle-paid-ok" : "settle-paid-neutral"}>
                <span>{remainingDue > 0 ? "ຍັງຂາດ" : "ຕ້ອງທອນ"}</span>
                <strong>{moneyFmt.format(remainingDue > 0 ? remainingDue : changeDue)}</strong>
              </div>
            </div>
          </div>

          <div className="settle-payment-body">
          <div className="settle-card">
            <div className="settle-card-title">
              <span className="flex items-center gap-2">
                <i className="settle-step">1</i>
                ເລືອກວິທີຮັບເງິນ
              </span>
              <strong className="settle-pay-curtag">ກີບ · ບາດ</strong>
            </div>

            {/* ກີບ — ສະກຸນຫຼັກ. ປຸ່ມ “ຄົບ” ຕື່ມຍອດເຕັມໃຫ້ທັນທີ. */}
            <div className="settle-pay-grid">
              <label className="settle-pay-field settle-method-card">
                <span className="settle-pay-label">ເງິນສົດ <b>ກີບ</b></span>
                <div className="settle-money-input">
                  <input
                    type="number"
                    inputMode="numeric"
                    min={0}
                    step={1000}
                    value={cashKipInput}
                    disabled={!canSettle}
                    onChange={(e) => {
                      setQrPaymentSelected(false);
                      setPaymentInputs((prev) => ({
                        ...prev,
                        [cashKipKey]: e.target.value,
                      }));
                    }}
                  />
                  <button
                    type="button"
                    className="settle-exact"
                    disabled={!canSettle}
                    onClick={() => {
                      setQrPaymentSelected(false);
                      resetPayments({ [cashKipKey]: String(effectiveTotal) });
                    }}
                  >
                    ຄົບ
                  </button>
                </div>
              </label>
              <div className="settle-pay-field">
                <span className="settle-pay-label">ເງິນໂອນ <b>ຜ່ານ QR</b></span>
                <button
                  type="button"
                  disabled={!canSettle}
                  onClick={selectQrPayment}
                  className={
                    "settle-qr-method " +
                    (qrPaymentSelected
                      ? "settle-qr-method--active"
                      : "")
                  }
                >
                  <span>
                    <strong className="block text-sm">
                      {qrPaymentSelected ? "✓ ເລືອກ QR ແລ້ວ" : "▦ ເລືອກໂອນຜ່ານ QR"}
                    </strong>
                    <small className="text-[10px] opacity-70">ບໍ່ຕ້ອງປ້ອນຈຳນວນເງິນ</small>
                  </span>
                  <strong className="font-mono text-lg">
                    {moneyFmt.format(qrPaymentSelected ? Number(transferKipInput) : effectiveTotal)} ₭
                  </strong>
                </button>
              </div>
            </div>

            {/* ບາດ — ເປີດເມື່ອລູກຄ້າຈ່າຍເປັນເງິນບາດ */}
            <button
              type="button"
              className="settle-thb-toggle"
              onClick={() => setShowThb((v) => !v)}
              aria-expanded={showThbInputs}
            >
              <span>{showThbInputs ? "▾" : "▸"} ຮັບເປັນເງິນບາດ (THB)</span>
              {currencyRates["01"] ? (
                <em>1 ฿ ≈ {moneyFmt.format(currencyRates["01"])} ກີບ</em>
              ) : null}
            </button>
            {showThbInputs ? (
              <div className="settle-pay-grid">
                <label className="settle-pay-field">
                  <span className="settle-pay-label">ເງິນສົດ <b>ບາດ</b></span>
                  <div className="settle-money-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={paymentInputs[paymentKey("01", "cash")] ?? "0"}
                      disabled={!canSettle}
                      onChange={(e) => {
                        setQrPaymentSelected(false);
                        setPaymentInputs((prev) => ({
                          ...prev,
                          [paymentKey("01", "cash")]: e.target.value,
                        }));
                      }}
                    />
                    <em className="settle-unit">฿</em>
                  </div>
                </label>
                <label className="settle-pay-field">
                  <span className="settle-pay-label">ເງິນໂອນ <b>ບາດ</b></span>
                  <div className="settle-money-input">
                    <input
                      type="number"
                      inputMode="numeric"
                      min={0}
                      step={1}
                      value={paymentInputs[paymentKey("01", "transfer")] ?? "0"}
                      disabled={!canSettle}
                      onChange={(e) => {
                        setQrPaymentSelected(false);
                        setPaymentInputs((prev) => ({
                          ...prev,
                          [paymentKey("01", "transfer")]: e.target.value,
                        }));
                      }}
                    />
                    <em className="settle-unit">฿</em>
                  </div>
                </label>
              </div>
            ) : null}

            <div className="settle-simple-hint">
              ເລືອກ QR ແລ້ວລະບົບຈະໃສ່ຍອດເຕັມ ແລະເປີດໜ້າ QR ໃຫ້ອັດຕະໂນມັດ.
            </div>
          </div>

          {transferInMain > 0 ? (
            <div className="settle-card settle-qr-card">
              <div className="settle-card-title">
                <span className="flex items-center gap-2">
                  <i className="settle-step">2</i>
                  ໃຫ້ລູກຄ້າສະແກນ QR
                </span>
                <strong className="settle-pay-curtag">
                  {moneyFmt.format(Math.round(transferInMain))} ₭
                </strong>
              </div>
              <div className="flex justify-center py-1">
                <TransferQr amount={Math.round(transferInMain)} size={210} />
              </div>
              <p className="mt-1 text-center text-xs text-odoo-text-muted">
                ໃຫ້ລູກຄ້າສະແກນເພື່ອໂອນ · QR ດຽວກັນສະແດງຢູ່ໜ້າຈໍລູກຄ້າ
              </p>
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

          {canSettle && redeemInfo && redeemInfo.isActive && redeemInfo.customerCode ? (
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
                  : "ບັນທຶກ ແລະ ຮັບເງິນ"}
            </button>
          </div>
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
}: {
  label: string;
  value: number;
  tone: "slate" | "amber" | "emerald" | "red";
}) {
  const styles = {
    slate:
      "border-slate-200 bg-white text-slate-800",
    amber:
      "border-amber-200 bg-amber-50/50 text-amber-700",
    emerald:
      "border-emerald-200 bg-emerald-50/50 text-emerald-700",
    red: "border-rose-200 bg-rose-50/50 text-rose-700",
  };

  return (
    <div className={`rounded-xl border p-4 shadow-sm hover:scale-[1.015] hover:shadow-md transition-all duration-300 ${styles[tone]}`}>
      <div className="text-xs font-semibold text-current/65">{label}</div>
      <div className="mt-1 font-mono text-2xl font-bold">
        {moneyFmt.format(value)}
      </div>
    </div>
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
        <button
          type="button"
          onClick={onClose}
          className="odoo-btn odoo-btn-primary mt-5 w-full justify-center"
        >
          ຕົກລົງ
        </button>
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
