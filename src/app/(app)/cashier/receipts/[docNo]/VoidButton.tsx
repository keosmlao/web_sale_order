"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export default function VoidButton({ docNo }: { docNo: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [managerCode, setManagerCode] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit() {
    setError(null);
    if (!reason.trim()) {
      setError("ກະລຸນາໃສ່ເຫດຜົນ");
      return;
    }
    if (!managerCode.trim() || !managerPin) {
      setError("ໃສ່ລະຫັດ ແລະ PIN ຂອງຜູ້ຈັດການ");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/cashier/void", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docNo,
          reason: reason.trim(),
          managerCode: managerCode.trim(),
          managerPin,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      window.alert(`ຍົກເລີກສຳເລັດ. ເລກອ້າງອີງ: ${data.voidDocNo}`);
      setOpen(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="odoo-btn odoo-btn-danger"
      >
        ຍົກເລີກບິນ
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 print:hidden">
          <div className="w-full max-w-md rounded-md border border-odoo-border bg-odoo-surface p-5 shadow-xl">
            <h3 className="mb-3 text-lg font-bold text-odoo-text-strong">
              ຍົກເລີກບິນ {docNo}?
            </h3>
            <p className="mb-3 text-[12px] text-odoo-text-muted">
              ການຍົກເລີກຈະສ້າງເອກະສານສົ່ງຄືນ (CTPL) ໃໝ່ ແລະ ຄືນເງິນ + ສ້າງ stock
              ກັບ ແລະ ຄືນຄະແນນລູກຄ້າ. ຕ້ອງມີ PIN ຂອງຜູ້ຈັດການ.
            </p>
            <label className="grid gap-1">
              <span className="odoo-label">ເຫດຜົນ</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                rows={2}
                disabled={busy}
                className="odoo-input"
                placeholder="ເຊັ່ນ: ສິນຄ້າຊຳລຸດ, ລູກຄ້າຄືນ, ບິນຜິດ"
              />
            </label>
            <label className="mt-3 grid gap-1">
              <span className="odoo-label">ລະຫັດຜູ້ຈັດການ</span>
              <input
                type="text"
                value={managerCode}
                onChange={(e) => setManagerCode(e.target.value)}
                disabled={busy}
                className="odoo-input"
                autoComplete="off"
              />
            </label>
            <label className="mt-3 grid gap-1">
              <span className="odoo-label">PIN ຜູ້ຈັດການ</span>
              <input
                type="password"
                inputMode="numeric"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                disabled={busy}
                className="odoo-input"
                autoComplete="off"
              />
            </label>
            {error ? (
              <div className="mt-3 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
                {error}
              </div>
            ) : null}
            <div className="mt-4 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                disabled={busy}
                className="odoo-btn"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={busy}
                className="odoo-btn odoo-btn-danger"
              >
                {busy ? "ກຳລັງສົ່ງ…" : "ຍົກເລີກບິນ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
