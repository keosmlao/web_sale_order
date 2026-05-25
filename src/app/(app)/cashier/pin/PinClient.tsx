"use client";

import { useState } from "react";

export default function PinClient({ employeeName }: { employeeName: string }) {
  const [currentPin, setCurrentPin] = useState("");
  const [newPin, setNewPin] = useState("");
  const [confirmPin, setConfirmPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(
    null,
  );

  async function save() {
    setMsg(null);
    if (!/^[\d]{4,12}$/.test(newPin)) {
      setMsg({ kind: "err", text: "PIN ໃໝ່ຕ້ອງເປັນຕົວເລກ 4-12 ໂຕ" });
      return;
    }
    if (newPin !== confirmPin) {
      setMsg({ kind: "err", text: "PIN ໃໝ່ສອງຄັ້ງບໍ່ກົງກັນ" });
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/me/pos-pin", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin, newPin }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ kind: "err", text: data?.error ?? `Error ${res.status}` });
        return;
      }
      setMsg({ kind: "ok", text: "ບັນທຶກ PIN ສຳເລັດ" });
      setCurrentPin("");
      setNewPin("");
      setConfirmPin("");
    } finally {
      setBusy(false);
    }
  }

  async function clearPin() {
    setMsg(null);
    if (!currentPin) {
      setMsg({ kind: "err", text: "ໃສ່ PIN ປະຈຸບັນກ່ອນ" });
      return;
    }
    if (!window.confirm("ລົບ PIN ນີ້? ຫຼັງລົບແລ້ວ ຕ້ອງໃຊ້ລະຫັດ login ແທນ.")) {
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/me/pos-pin", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPin }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMsg({ kind: "err", text: data?.error ?? `Error ${res.status}` });
        return;
      }
      setMsg({ kind: "ok", text: "ລົບ PIN ສຳເລັດ" });
      setCurrentPin("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto max-w-md px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          Cashier
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ຕັ້ງ PIN ສຳລັບອະນຸມັດສ່ວນຫຼຸດ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          {employeeName} —
          ຕັ້ງ PIN ສຳລັບອະນຸມັດສ່ວນຫຼຸດທີ່ໜ້າຮ້ານ.
          ຄັ້ງທຳອິດໃຫ້ໃສ່ລະຫັດ login ໃນຊ່ອງ PIN ປະຈຸບັນ.
        </p>
      </header>

      <div className="rounded-md border border-odoo-border bg-odoo-surface p-4">
        <label className="grid gap-1">
          <span className="odoo-label">PIN ປະຈຸບັນ (ຫຼື ລະຫັດ login ຄັ້ງທຳອິດ)</span>
          <input
            type="password"
            inputMode="numeric"
            value={currentPin}
            onChange={(e) => setCurrentPin(e.target.value)}
            disabled={busy}
            className="odoo-input"
            autoComplete="current-password"
          />
        </label>
        <label className="mt-3 grid gap-1">
          <span className="odoo-label">PIN ໃໝ່ (4-12 ໂຕເລກ)</span>
          <input
            type="password"
            inputMode="numeric"
            value={newPin}
            onChange={(e) => setNewPin(e.target.value)}
            disabled={busy}
            className="odoo-input"
            autoComplete="new-password"
          />
        </label>
        <label className="mt-3 grid gap-1">
          <span className="odoo-label">ຢືນຢັນ PIN ໃໝ່</span>
          <input
            type="password"
            inputMode="numeric"
            value={confirmPin}
            onChange={(e) => setConfirmPin(e.target.value)}
            disabled={busy}
            className="odoo-input"
            autoComplete="new-password"
          />
        </label>

        {msg ? (
          <div
            className={
              "mt-3 rounded-md px-3 py-2 text-[13px] font-semibold " +
              (msg.kind === "ok"
                ? "border border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border border-rose-300 bg-rose-50 text-odoo-danger")
            }
          >
            {msg.text}
          </div>
        ) : null}

        <div className="mt-4 flex items-center justify-between gap-2">
          <button
            type="button"
            onClick={clearPin}
            disabled={busy}
            className="odoo-btn"
          >
            ລົບ PIN
          </button>
          <button
            type="button"
            onClick={save}
            disabled={busy}
            className="odoo-btn odoo-btn-primary"
          >
            {busy ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກ"}
          </button>
        </div>
      </div>
    </div>
  );
}
