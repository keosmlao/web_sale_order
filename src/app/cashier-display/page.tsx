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
      <main className="relative flex h-screen overflow-hidden bg-[#071426] text-white">
        <div className="absolute -left-40 -top-40 h-[520px] w-[520px] rounded-full bg-cyan-400/10 blur-3xl" />
        <div className="absolute -bottom-56 -right-28 h-[620px] w-[620px] rounded-full bg-blue-500/20 blur-3xl" />
        <div className="relative m-auto flex flex-col items-center px-8 text-center">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src="/odm.png"
            alt="ODIEN Mall"
            className="h-32 w-56 object-contain drop-shadow-[0_20px_35px_rgba(34,211,238,0.18)]"
          />
          <div className="mt-6 rounded-full border border-white/10 bg-white/5 px-5 py-2 text-base font-bold tracking-[0.2em] text-cyan-200 backdrop-blur">
            ODIEN MALL
          </div>
          <h1 className="mt-6 text-4xl font-black leading-tight">
            ຍິນດີຕ້ອນຮັບ
          </h1>
          <p className="mt-3 text-xl text-slate-300">
            ຂອບໃຈທີ່ເລືອກຊື້ສິນຄ້າກັບພວກເຮົາ
          </p>
          <div className="mt-8 flex items-center gap-3 text-base text-slate-400">
            <span className="h-2 w-2 animate-pulse rounded-full bg-emerald-400" />
            ພ້ອມໃຫ້ບໍລິການ
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="flex h-screen overflow-hidden bg-[#eef3f8] text-slate-900">
      <section className="flex min-w-0 flex-1 flex-col">
        <header className="flex min-h-[84px] items-center justify-between bg-[#071426] px-6 text-white shadow-xl">
          <div className="flex items-center gap-4">
            <div className="flex h-14 w-24 items-center justify-center rounded-xl bg-white p-1.5">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src="/odm.png" alt="ODIEN Mall" className="h-full w-full object-contain" />
            </div>
            <div>
              <div className="text-2xl font-black">ODIEN MALL</div>
              <div className="mt-0.5 text-sm text-cyan-200">ລາຍການສິນຄ້າຂອງທ່ານ</div>
            </div>
          </div>
          <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-2 text-right">
            <div className="text-xs font-bold text-slate-300">ເລກບິນ</div>
            <div className="font-mono text-xl font-black">#{state.cartNumber}</div>
            {state.customerName ? (
              <div className="mt-0.5 text-sm font-bold text-cyan-200">{state.customerName}</div>
            ) : null}
          </div>
        </header>

        <div className="flex items-center justify-between border-b border-blue-200 bg-gradient-to-r from-blue-50 to-cyan-50 px-6 py-3 shadow-sm">
          <div>
            <div className="text-sm font-bold text-blue-600">
              {state.items.length} ລາຍການ
            </div>
            <div className="mt-0.5 text-2xl font-black">ລວມຍອດທັງໝົດ</div>
          </div>
          <div className="text-right">
            <span className="text-4xl font-black leading-none tabular-nums text-blue-700">
              {kip.format(state.total)}
            </span>
            <span className="ml-2 text-2xl font-black text-blue-700">₭</span>
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          <div className="mb-2 grid grid-cols-[1fr_90px_170px] gap-3 px-4 text-sm font-black text-slate-500">
            <span>ລາຍການສິນຄ້າ</span>
            <span className="text-center">ຈຳນວນ</span>
            <span className="text-right">ມູນຄ່າ</span>
          </div>
          <table className="w-full border-separate border-spacing-y-2 text-lg">
            <tbody>
              {state.items.map((it, i) => (
                <tr key={i} className="bg-white shadow-sm">
                  <td className="rounded-l-xl border-y border-l border-slate-200 px-4 py-3 font-bold">
                    <span className="mr-3 inline-flex h-7 w-7 items-center justify-center rounded-full bg-blue-50 text-sm font-black text-blue-600">
                      {i + 1}
                    </span>
                    {it.name}
                  </td>
                  <td className="w-[90px] border-y border-slate-200 py-3 text-center">
                    <span className="inline-flex min-w-12 justify-center rounded-lg bg-slate-100 px-2 py-1.5 font-black text-slate-700">
                      {kip.format(it.qty)}
                    </span>
                  </td>
                  <td className="w-[170px] rounded-r-xl border-y border-r border-slate-200 px-4 py-3 text-right text-xl font-black tabular-nums">
                    {kip.format(it.amount)} <span className="text-base text-slate-500">₭</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <footer className="border-t border-slate-200 bg-white px-6 py-4 shadow-[0_-12px_35px_rgba(15,23,42,0.08)]">
          {(state.paid > 0 || state.changeDue > 0 || state.remainingDue > 0) ? (
            <div className="grid grid-cols-3 gap-3 text-lg">
              <DisplayTotal label="ຮັບເງິນ" value={state.paid} tone="slate" />
              <DisplayTotal label="ຍັງຄ້າງ" value={state.remainingDue} tone="red" />
              <DisplayTotal label="ເງິນທອນ" value={state.changeDue} tone="green" />
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
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      setStatus("loading");
      setDataUrl(null);
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
          width: 400,
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
    <aside className="relative flex w-[430px] shrink-0 flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#0b1e37] to-[#071426] px-8 text-white">
      <div className="absolute -right-40 -top-36 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-1.5 text-base font-black text-cyan-200">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" />
          BCEL OnePay
        </div>
        <div className="mt-4 text-lg font-bold text-slate-300">ຈຳນວນທີ່ຕ້ອງໂອນ</div>
        <div className="mt-1.5 text-4xl font-black tabular-nums text-white">{amountLabel} ₭</div>
      </div>
      <div className="relative mt-6 flex h-[350px] w-[350px] items-center justify-center rounded-[28px] bg-white p-4 shadow-[0_28px_65px_rgba(0,0,0,0.4)]">
        <span className="absolute -left-2 -top-2 h-12 w-12 rounded-tl-[24px] border-l-8 border-t-8 border-cyan-400" />
        <span className="absolute -right-2 -top-2 h-12 w-12 rounded-tr-[24px] border-r-8 border-t-8 border-cyan-400" />
        <span className="absolute -bottom-2 -left-2 h-12 w-12 rounded-bl-[24px] border-b-8 border-l-8 border-cyan-400" />
        <span className="absolute -bottom-2 -right-2 h-12 w-12 rounded-br-[24px] border-b-8 border-r-8 border-cyan-400" />
        {status === "ok" && dataUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="BCEL transfer QR" className="h-full w-full" />
        ) : status === "loading" ? (
          <span className="text-lg text-slate-500">ກຳລັງສ້າງ QR...</span>
        ) : status === "unconfigured" ? (
          <span className="px-4 text-center text-lg text-amber-600">
            ຍັງບໍ່ໄດ້ຕັ້ງຄ່າ BCEL QR (BCEL_QR_PAYLOAD)
          </span>
        ) : (
          <span className="text-lg text-rose-500">ສ້າງ QR ບໍ່ສຳເລັດ</span>
        )}
      </div>
      <p className="relative mt-6 max-w-md text-center text-lg leading-relaxed text-slate-300">
        ເປີດແອັບທະນາຄານ ແລ້ວສະແກນ QR
        <br />
        <strong className="text-white">ຈຳນວນເງິນຖືກໃສ່ໄວ້ແລ້ວ</strong>
      </p>
    </aside>
  );
}

function DisplayTotal({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "slate" | "red" | "green";
}) {
  const color =
    tone === "green"
      ? "text-emerald-600"
      : tone === "red"
        ? "text-rose-600"
        : "text-slate-700";
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-2.5">
      <span className="block text-xs font-bold text-slate-500">{label}</span>
      <strong className={`mt-0.5 block font-mono text-xl tabular-nums ${color}`}>
        {kip.format(value)} ₭
      </strong>
    </div>
  );
}
