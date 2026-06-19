"use client";

import { useEffect, useMemo, useState } from "react";
import QRCode from "qrcode";
import {
  subscribeCustomerDisplay,
  requestCustomerDisplayState,
  IDLE_DISPLAY_STATE,
  type CustomerDisplayState,
} from "@/lib/customer-display";

const kip = new Intl.NumberFormat("en-US");

export default function CustomerDisplayPage() {
  const [state, setState] = useState<CustomerDisplayState>(IDLE_DISPLAY_STATE);

  // Subscribe to the cashier's broadcasts, then ask for the current bill so we
  // populate even if this window opened after the cashier hit "receive money".
  useEffect(() => {
    const unsubscribe = subscribeCustomerDisplay({ onState: setState });
    requestCustomerDisplayState();
    return unsubscribe;
  }, []);

  const hasBill = state.cartNumber !== null && state.items.length > 0;

  if (!hasBill) {
    return (
      <main className="flex h-screen flex-col items-center justify-center bg-slate-900 text-white">
        <div className="text-5xl font-black tracking-tight">ODG</div>
        <p className="mt-4 text-xl text-slate-300">ຍິນດີຕ້ອນຮັບ · Welcome</p>
      </main>
    );
  }

  return (
    <main className="flex h-screen bg-slate-100 text-slate-900">
      {/* Items + totals */}
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-baseline justify-between bg-slate-900 px-8 py-5 text-white">
          <div className="text-3xl font-black">ODG</div>
          <div className="text-right">
            <div className="text-sm text-slate-300">ບິນ #{state.cartNumber}</div>
            {state.customerName ? (
              <div className="text-lg font-bold">{state.customerName}</div>
            ) : null}
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-8 py-4">
          <table className="w-full text-lg">
            <tbody>
              {state.items.map((it, i) => (
                <tr key={i} className="border-b border-slate-200">
                  <td className="py-3 pr-3 font-semibold">{it.name}</td>
                  <td className="w-20 py-3 text-right text-slate-500">
                    x{kip.format(it.qty)}
                  </td>
                  <td className="w-40 py-3 text-right font-bold tabular-nums">
                    {kip.format(it.amount)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="border-t-4 border-slate-900 bg-white px-8 py-5">
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-bold">ລວມທັງໝົດ</span>
            <span className="text-4xl font-black tabular-nums">
              {kip.format(state.total)} ₭
            </span>
          </div>
          <div className="mt-2 flex items-baseline justify-between text-lg">
            <span className="text-slate-500">ຮັບເງິນ</span>
            <span className="tabular-nums">{kip.format(state.paid)} ₭</span>
          </div>
          {state.changeDue > 0 ? (
            <div className="mt-1 flex items-baseline justify-between text-lg text-emerald-600">
              <span>ເງິນທອນ</span>
              <span className="tabular-nums">{kip.format(state.changeDue)} ₭</span>
            </div>
          ) : null}
          {state.remainingDue > 0 ? (
            <div className="mt-1 flex items-baseline justify-between text-lg text-rose-600">
              <span>ຍັງຄ້າງ</span>
              <span className="tabular-nums">{kip.format(state.remainingDue)} ₭</span>
            </div>
          ) : null}
        </footer>
      </section>

      {/* BCEL transfer QR */}
      {state.transferAmount > 0 ? (
        <TransferQrPanel amount={state.transferAmount} />
      ) : null}
    </main>
  );
}

function TransferQrPanel({ amount }: { amount: number }) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ok" | "unconfigured" | "error">(
    "loading",
  );
  const amountLabel = useMemo(() => kip.format(amount), [amount]);

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
          width: 360,
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
  }, [amount]);

  return (
    <aside className="flex w-[420px] flex-col items-center justify-center gap-5 border-l border-slate-200 bg-white px-8">
      <div className="text-center">
        <div className="text-xl font-bold text-slate-500">ໂອນຜ່ານ BCEL One</div>
        <div className="mt-1 text-4xl font-black tabular-nums">{amountLabel} ₭</div>
      </div>
      <div className="flex h-[360px] w-[360px] items-center justify-center rounded-2xl border-4 border-slate-900 bg-white p-3">
        {status === "ok" && dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="BCEL transfer QR" className="h-full w-full" />
        ) : status === "loading" ? (
          <span className="text-slate-400">ກຳລັງສ້າງ QR...</span>
        ) : status === "unconfigured" ? (
          <span className="px-4 text-center text-sm text-amber-600">
            ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ BCEL QR (BCEL_QR_PAYLOAD)
          </span>
        ) : (
          <span className="text-rose-500">ສ້າງ QR ບໍ່ສຳເລັດ</span>
        )}
      </div>
      <p className="text-center text-sm text-slate-500">
        ສະແກນດ້ວຍແອັບທະນາຄານ ເພື່ອໂອນຕາມຈຳນວນຂ້າງເທິງ
      </p>
    </aside>
  );
}
