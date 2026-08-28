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
  // What has actually arrived, and what is actually still owed. The
  // cashier's own screen counts a requested transfer as paid so the till
  // can be balanced against it; the customer must not be told their money
  // is in while the QR is still in front of them.
  const received = Math.max(0, state.paid - state.pendingTransfer);
  // Everything that came off the bill, however it came off.
  const savings = Math.max(0, state.discount) + Math.max(0, state.pointsUsedValue);
  // What they walk out holding.
  const pointsAfter = Math.max(
    0,
    state.pointsBalance + state.pointsEarned - state.pointsUsed,
  );
  const stillOwed = Math.max(0, state.total - received);

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

        {/* The list. It carries the detail, so it stays quiet — the two
            things a customer checks here are "is that my basket" and
            "what do I owe", and the second one belongs at the end, where
            reading stops. */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          <div className="mb-3 grid grid-cols-[1fr_100px_200px] gap-4 px-5 text-base font-black uppercase tracking-wide text-slate-400">
            <span>ລາຍການສິນຄ້າ</span>
            <span className="text-center">ຈຳນວນ</span>
            <span className="text-right">ມູນຄ່າ</span>
          </div>
          <table className="w-full border-separate border-spacing-y-2.5">
            <tbody>
              {state.items.map((it, i) => (
                <tr key={i} className="bg-white shadow-sm">
                  <td className="rounded-l-2xl border-y border-l border-slate-200 px-5 py-4 text-xl font-bold">
                    <span className="mr-4 inline-flex h-9 w-9 items-center justify-center rounded-full bg-blue-50 text-base font-black text-blue-600">
                      {i + 1}
                    </span>
                    {it.name}
                  </td>
                  <td className="w-[100px] border-y border-slate-200 py-4 text-center">
                    <span className="inline-flex min-w-14 justify-center rounded-xl bg-slate-100 px-3 py-2 text-xl font-black tabular-nums text-slate-700">
                      {kip.format(it.qty)}
                    </span>
                  </td>
                  <td className="w-[200px] rounded-r-2xl border-y border-r border-slate-200 px-5 py-4 text-right text-2xl font-black tabular-nums">
                    {kip.format(it.amount)}
                    <span className="ml-1 text-lg text-slate-400">₭</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* The total, and only what is true about the payment so far.
            "ຮັບເງິນ" counts money that has actually arrived — a QR the
            customer is still being asked to scan is a request, not a
            receipt, so it is subtracted before this is shown. */}
        <footer className="border-t border-slate-200 bg-white px-8 py-6 shadow-[0_-16px_45px_rgba(15,23,42,0.10)]">
          {/* What came off the bill, before the figure it came off. A
              discount the customer is never shown is a discount they
              cannot check — and one they will not remember was given. */}
          {savings > 0 ? (
            <div className="mb-5 border-b border-dashed border-slate-300 pb-4">
              <div className="grid gap-2 text-2xl">
                <div className="flex items-baseline justify-between">
                  <span className="font-bold text-slate-500">ລາຄາເຕັມ</span>
                  <span className="font-bold tabular-nums text-slate-500">
                    {kip.format(state.grossTotal)} ₭
                  </span>
                </div>
                {state.discount > 0 ? (
                  <div className="flex items-baseline justify-between">
                    <span className="font-bold text-rose-500">ສ່ວນຫຼຸດ</span>
                    <span className="font-black tabular-nums text-rose-600">
                      −{kip.format(state.discount)} ₭
                    </span>
                  </div>
                ) : null}
                {state.pointsUsedValue > 0 ? (
                  <div className="flex items-baseline justify-between">
                    <span className="font-bold text-violet-500">
                      ໃຊ້ແຕ້ມ {kip.format(state.pointsUsed)} ແຕ້ມ
                    </span>
                    <span className="font-black tabular-nums text-violet-600">
                      −{kip.format(state.pointsUsedValue)} ₭
                    </span>
                  </div>
                ) : null}
                <div className="mt-1 flex items-baseline justify-between border-t border-slate-200 pt-2">
                  <span className="font-black text-emerald-700">
                    ລາຄາຫຼັງສ່ວນຫຼຸດ
                  </span>
                  <span className="text-3xl font-black tabular-nums text-emerald-700">
                    {kip.format(state.total)} ₭
                  </span>
                </div>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end justify-between gap-6">
            <div>
              <div className="text-lg font-bold text-slate-400">
                {state.items.length} ລາຍການ
              </div>
              <div className="text-3xl font-black text-slate-500">
                ລວມຍອດທັງໝົດ
              </div>
              {/* Earned points sit under the total, where the customer is
                  already looking, rather than competing with it. */}
              {state.pointsEarned > 0 || state.pointsBalance > 0 ? (
                <div className="mt-3 inline-grid gap-1 rounded-2xl bg-amber-50 px-5 py-3 text-lg font-bold text-amber-800">
                  <div className="flex items-baseline justify-between gap-8">
                    <span>ແຕ້ມສະສົມເດີມ</span>
                    <span className="tabular-nums">
                      {kip.format(state.pointsBalance)}
                    </span>
                  </div>
                  <div className="flex items-baseline justify-between gap-8">
                    <span>ແຕ້ມທີ່ໄດ້ຮັບ</span>
                    <span className="tabular-nums text-emerald-700">
                      +{kip.format(state.pointsEarned)}
                    </span>
                  </div>
                  {state.pointsUsed > 0 ? (
                    <div className="flex items-baseline justify-between gap-8">
                      <span>ແຕ້ມທີ່ໃຊ້ໄປ</span>
                      <span className="tabular-nums text-rose-600">
                        −{kip.format(state.pointsUsed)}
                      </span>
                    </div>
                  ) : null}
                  <div className="mt-1 flex items-baseline justify-between gap-8 border-t border-amber-200 pt-2 text-xl font-black">
                    <span>★ ລວມແຕ້ມທັງໝົດ</span>
                    <span className="tabular-nums">
                      {kip.format(pointsAfter)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
            <div className="text-right leading-none">
              <span className="text-[64px] font-black tabular-nums text-[#0b2f5c]">
                {kip.format(state.total)}
              </span>
              <span className="ml-3 text-3xl font-black text-[#0b2f5c]">₭</span>
            </div>
          </div>

          {received > 0 || state.changeDue > 0 ? (
            <div className="mt-5 grid grid-cols-3 gap-4 border-t border-slate-100 pt-5">
              <DisplayTotal label="ຮັບເງິນແລ້ວ" value={received} tone="slate" />
              <DisplayTotal label="ຍັງຄ້າງ" value={stillOwed} tone="red" />
              <DisplayTotal label="ເງິນທອນ" value={state.changeDue} tone="green" />
            </div>
          ) : null}
        </footer>
      </section>

      {/* BCEL transfer QR */}
      {state.qrSelected || state.transferAmount > 0 ? (
        <TransferQrPanel amount={state.transferAmount} paid={received > 0} />
      ) : null}
    </main>
  );
}

function TransferQrPanel({
  amount,
  paid,
}: {
  amount: number;
  paid: boolean;
}) {
  const [dataUrl, setDataUrl] = useState<string | null>(null);
  const [status, setStatus] = useState<
    "idle" | "loading" | "ok" | "unconfigured" | "error"
  >("loading");
  const amountLabel = useMemo(() => kip.format(amount), [amount]);

  useEffect(() => {
    let cancelled = false;
    // Nothing to transfer yet — the cashier is still moving money between
    // tenders. Hold the panel and say so; do not fetch a code for zero.
    if (!(amount > 0)) {
      setStatus("idle");
      return () => {
        cancelled = true;
      };
    }
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      // Deliberately NOT clearing dataUrl here.
      //
      // Every change to the amount refetches, and blanking first meant the
      // customer watched the code vanish and rebuild each time the cashier
      // touched another tender — which reads as "it broke", right at the
      // moment they are being asked to scan it. The old code stays up
      // until the new one is ready to replace it.
      setStatus((prev) => (prev === "ok" ? "ok" : "loading"));
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
    <aside className="relative flex w-[460px] shrink-0 flex-col items-center justify-center overflow-hidden bg-gradient-to-b from-[#0b1e37] to-[#071426] px-8 text-white">
      <div className="absolute -right-40 -top-36 h-96 w-96 rounded-full bg-cyan-400/10 blur-3xl" />
      <div className="relative text-center">
        <div className="inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-4 py-1.5 text-base font-black text-cyan-200">
          <span
            className={
              "h-2.5 w-2.5 rounded-full " +
              (paid ? "bg-emerald-400" : "animate-pulse bg-amber-400")
            }
          />
          BCEL OnePay
        </div>
        {/* The instruction leads, because until they have scanned it this
            panel is a thing to do, not a thing to read. */}
        <div className="mt-5 text-2xl font-black text-white">
          {paid ? "ຮັບເງິນແລ້ວ ຂອບໃຈ" : "ສະແກນເພື່ອຈ່າຍ"}
        </div>
        <div className="mt-4 text-base font-bold text-slate-400">
          ຈຳນວນທີ່ຕ້ອງໂອນ
        </div>
        <div className="mt-1 text-5xl font-black leading-none tabular-nums text-cyan-200">
          {amountLabel}
          <span className="ml-2 text-2xl">₭</span>
        </div>
      </div>
      <div className="relative mt-6 flex h-[350px] w-[350px] items-center justify-center rounded-[28px] bg-white p-4 shadow-[0_28px_65px_rgba(0,0,0,0.4)]">
        <span className="absolute -left-2 -top-2 h-12 w-12 rounded-tl-[24px] border-l-8 border-t-8 border-cyan-400" />
        <span className="absolute -right-2 -top-2 h-12 w-12 rounded-tr-[24px] border-r-8 border-t-8 border-cyan-400" />
        <span className="absolute -bottom-2 -left-2 h-12 w-12 rounded-bl-[24px] border-b-8 border-l-8 border-cyan-400" />
        <span className="absolute -bottom-2 -right-2 h-12 w-12 rounded-br-[24px] border-b-8 border-r-8 border-cyan-400" />
        {dataUrl && (status === "ok" || status === "loading") ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={dataUrl} alt="BCEL transfer QR" className="h-full w-full" />
        ) : status === "idle" ? (
          <span className="px-4 text-center text-lg text-slate-500">
            ລໍຖ້າພະນັກງານກຳນົດຍອດໂອນ
          </span>
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
    <div className="rounded-2xl bg-slate-50 px-5 py-4">
      <span className="block text-base font-bold text-slate-500">{label}</span>
      <strong className={`mt-1 block text-3xl font-black tabular-nums ${color}`}>
        {kip.format(value)}
        <span className="ml-1.5 text-xl text-slate-400">₭</span>
      </strong>
    </div>
  );
}
