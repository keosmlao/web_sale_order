"use client";

import { useEffect, useState } from "react";

// Per-device flag read by the cashier settle screen. When on, the BCEL
// transfer QR is generated for 1 ກີບ so the transfer flow can be tested with a
// real 1-kip transfer. Recorded bill/receipt amounts are unaffected.
const STORAGE_KEY = "pos-test-transfer";

export default function TestModePage() {
  const [testTransfer, setTestTransfer] = useState(false);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let mounted = true;
    Promise.resolve().then(() => {
      if (!mounted) return;
      try {
        setTestTransfer(window.localStorage.getItem(STORAGE_KEY) === "1");
      } catch {
        // localStorage unavailable — treat as off
      }
      setReady(true);
    });
    return () => {
      mounted = false;
    };
  }, []);

  const toggle = () => {
    setTestTransfer((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
      } catch {
        // ignore persistence failure
      }
      return next;
    });
  };

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ໂໝດທົດສອບ ໂອນເງິນ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ເມື່ອເປີດ, QR ໂອນເງິນ (ທັງໜ້າແຄຊເຢຍ ແລະ ໜ້າຈໍລູກຄ້າ) ຈະເປັນ 1 ກີບ
          ເພື່ອທົດສອບການໂອນຈິງ. ຍອດບິນ/ໃບຮັບເງິນ ຍັງບັນທຶກຕາມຍອດຈິງ.
          ຄ່ານີ້ບັນທຶກໄວ້ໃນເຄື່ອງນີ້ເທົ່ານັ້ນ (per-device).
        </p>
      </header>

      <div className="max-w-xl rounded-md border border-odoo-border bg-odoo-surface">
        <div className="flex items-center justify-between gap-4 px-4 py-4">
          <div className="min-w-0">
            <div className="text-sm font-bold text-odoo-text-strong">
              ໂອນທຸກຍອດເປັນ 1 ກີບ (ທົດສອບ)
            </div>
            <div className="mt-0.5 text-xs text-odoo-text-muted">
              ສະຖານະ:{" "}
              {ready
                ? testTransfer
                  ? "ເປີດ (ທົດສອບ 1 ກີບ)"
                  : "ປິດ (ໃຊ້ຍອດຈິງ)"
                : "..."}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={testTransfer}
            aria-label="ໂໝດທົດສອບ ໂອນເງິນ"
            onClick={toggle}
            className={
              "relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition " +
              (testTransfer ? "bg-odoo-primary" : "bg-slate-300")
            }
          >
            <span
              className={
                "inline-block h-5 w-5 transform rounded-full bg-white shadow transition " +
                (testTransfer ? "translate-x-6" : "translate-x-1")
              }
            />
          </button>
        </div>
        {testTransfer ? (
          <div className="mx-4 mb-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
            ⚠ ໂໝດທົດສອບເປີດຢູ່ — QR ໂອນຈະເປັນ 1 ກີບ. ຢ່າລືມປິດກ່ອນໃຊ້ງານຈິງ.
          </div>
        ) : null}
      </div>
    </div>
  );
}
