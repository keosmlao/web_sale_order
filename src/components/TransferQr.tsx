"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";

// Renders a BCEL One (Lao QR) image for a transfer amount. Fetches the dynamic
// payload from /api/cashier/customer-qr (built server-side from the merchant's
// BCEL_QR_PAYLOAD) and draws it client-side. Shared by the cashier settle
// drawer and the customer display.
export default function TransferQr({
  amount,
  size = 220,
}: {
  amount: number;
  size?: number;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "loading" | "ok" | "unconfigured" | "error"
  >("loading");

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setDataUrl(null);
    (async () => {
      try {
        const res = await fetch(
          `/api/cashier/customer-qr?amount=${encodeURIComponent(amount)}`,
        );
        const data = await res.json().catch(() => null);
        if (cancelled) return;
        if (!res.ok || !data) {
          setStatus("error");
          return;
        }
        if (!data.configured || !data.payload) {
          setStatus("unconfigured");
          return;
        }
        const url = await QRCode.toDataURL(data.payload as string, {
          width: size,
          margin: 1,
        });
        if (!cancelled) {
          setDataUrl(url);
          setStatus("ok");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amount, size]);

  return (
    <div
      className="flex items-center justify-center rounded-2xl border-4 border-slate-900 bg-white p-3"
      style={{ width: size, height: size }}
    >
      {status === "ok" && dataUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={dataUrl} alt="BCEL transfer QR" className="h-full w-full" />
      ) : status === "loading" ? (
        <span className="text-sm text-slate-400">ກຳລັງສ້າງ QR...</span>
      ) : status === "unconfigured" ? (
        <span className="px-3 text-center text-xs text-amber-600">
          ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ BCEL QR (BCEL_QR_PAYLOAD)
        </span>
      ) : (
        <span className="text-sm text-rose-500">ສ້າງ QR ບໍ່ສຳເລັດ</span>
      )}
    </div>
  );
}
