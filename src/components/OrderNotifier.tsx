"use client";

import { useCallback, useEffect, useState } from "react";

// Subscribes to /api/orders/stream and fires a Chrome desktop
// notification on every "new-order" event. The component renders an
// in-page fallback banner whenever the browser hasn't granted
// notification permission yet so the user can opt in without digging
// into site settings — even if they accidentally dismissed the prompt.
//
// Self-filter intentionally disabled: ops often have the web open
// under the same account that's also driving the mobile app for
// testing, and suppressing those events made it look broken. Easy
// to add back by comparing payload.salespersonCode to selfEmployeeCode.

type Props = {
  selfEmployeeCode: string | null;
};

const STREAM_URL = "/api/orders/stream";

type NewOrder = {
  cartNumber?: string;
  docNo?: string | null;
  total?: number | null;
  customerName?: string | null;
  salespersonCode?: string | null;
  salespersonName?: string | null;
};

function formatKip(value: number | null | undefined): string | null {
  if (value == null || !Number.isFinite(value)) return null;
  try {
    return `${value.toLocaleString("en-US")} ກີບ`;
  } catch {
    return `${value} ກີບ`;
  }
}

function fireNotification(payload: NewOrder) {
  if (typeof window === "undefined") return;
  if (!("Notification" in window)) return;
  if (Notification.permission !== "granted") return;

  const title = `ມີອໍເດີໃໝ່ #${payload.cartNumber ?? ""}`.trim();
  const lines = [
    payload.customerName ? `ລູກຄ້າ: ${payload.customerName}` : null,
    formatKip(payload.total ?? null),
    payload.salespersonName ? `ໂດຍ ${payload.salespersonName}` : null,
  ].filter((s): s is string => Boolean(s && s.length));

  try {
    const n = new Notification(title, {
      body: lines.join(" · ") || undefined,
      tag: `order-${payload.cartNumber ?? Date.now()}`,
    });
    n.onclick = () => {
      window.focus();
      n.close();
    };
  } catch (e) {
    // Browser rejected (insecure context, etc) — log so we can see why
    // when debugging.
    console.warn("[OrderNotifier] Notification rejected:", e);
  }
}

type PermissionState = "unsupported" | "default" | "granted" | "denied";

function readPermission(): PermissionState {
  if (typeof window === "undefined") return "unsupported";
  if (!("Notification" in window)) return "unsupported";
  return Notification.permission as PermissionState;
}

export default function OrderNotifier(_props: Props) {
  const [perm, setPerm] = useState<PermissionState>("unsupported");
  const [toast, setToast] = useState<NewOrder | null>(null);

  // Initial permission read happens client-side only.
  useEffect(() => {
    const current = readPermission();
    Promise.resolve().then(() => {
      setPerm(current);
    });
  }, []);

  // EventSource lifecycle. Independent of permission so we can show the
  // in-page toast even when desktop notifications are blocked.
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("EventSource" in window)) return;

    const es = new EventSource(STREAM_URL, { withCredentials: true });
    console.info("[OrderNotifier] subscribed to", STREAM_URL);

    es.onmessage = (ev) => {
      let data: unknown;
      try {
        data = JSON.parse(ev.data);
      } catch {
        return;
      }
      if (
        !data ||
        typeof data !== "object" ||
        (data as { type?: unknown }).type !== "new-order"
      ) {
        return;
      }
      const payload = data as NewOrder;
      console.info("[OrderNotifier] new-order event:", payload);

      fireNotification(payload);
      setToast(payload);
      // Auto-dismiss the in-page toast.
      window.setTimeout(() => {
        setToast((current) =>
          current?.cartNumber === payload.cartNumber ? null : current,
        );
      }, 6000);
    };

    es.onerror = (e) => {
      console.warn("[OrderNotifier] EventSource error (will retry):", e);
    };

    return () => {
      es.close();
    };
  }, []);

  const askPermission = useCallback(() => {
    if (typeof window === "undefined") return;
    if (!("Notification" in window)) return;
    Notification.requestPermission()
      .then((result) => setPerm(result as PermissionState))
      .catch(() => {
        /* ignore */
      });
  }, []);

  // Render: permission opt-in banner (if not granted) + transient toast
  // for the latest new-order event (visible regardless of OS notification
  // permission, so the user always has a signal something happened).
  return (
    <>
      {perm === "default" && (
        <button
          type="button"
          onClick={askPermission}
          className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-900 shadow-md transition hover:bg-emerald-100"
        >
          🔔 ເປີດການແຈ້ງເຕືອນອໍເດີໃໝ່
        </button>
      )}
      {toast && (
        <div className="fixed right-4 top-4 z-50 max-w-xs rounded-lg border border-emerald-300 bg-white p-3 shadow-lg">
          <div className="text-sm font-bold text-emerald-700">
            ມີອໍເດີໃໝ່ #{toast.cartNumber ?? ""}
          </div>
          <div className="mt-1 text-xs text-slate-700">
            {[
              toast.customerName ? `ລູກຄ້າ: ${toast.customerName}` : null,
              formatKip(toast.total ?? null),
              toast.salespersonName ? `ໂດຍ ${toast.salespersonName}` : null,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>
      )}
    </>
  );
}
