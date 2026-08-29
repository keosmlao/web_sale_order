"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

const moneyFmt = new Intl.NumberFormat("en-US");

type Item = {
  lineNumber: number;
  itemCode: string;
  itemName: string | null;
  qty: number;
  priceKip: number;
};

// ຄືນເຄື່ອງບາງລາຍການ — pick the lines and quantities coming back, give the
// reason, and a manager signs it with their PIN. The API raises a CTPL for
// just those lines; the bill itself stays standing.
export default function ReturnButton({
  docNo,
  items,
}: {
  docNo: string;
  items: Item[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [qtys, setQtys] = useState<Record<number, number>>({});
  const [reason, setReason] = useState("");
  const [managerCode, setManagerCode] = useState("");
  const [managerPin, setManagerPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const lines = items
    .map((it) => ({ lineNumber: it.lineNumber, qty: qtys[it.lineNumber] ?? 0 }))
    .filter((l) => l.qty > 0);
  const refundKip = items.reduce(
    (a, it) => a + (qtys[it.lineNumber] ?? 0) * it.priceKip,
    0,
  );

  async function submit() {
    setError(null);
    if (lines.length === 0) {
      setError("ເລືອກຈຳນວນທີ່ຈະຄືນກ່ອນ");
      return;
    }
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
          lines,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `Error ${res.status}`);
        return;
      }
      window.alert(
        `ຄືນເຄື່ອງສຳເລັດ. ເລກໃບຄືນ: ${data.voidDocNo}\nຄືນເງິນສົດ ≈ ${moneyFmt.format(refundKip)} ກີບ`,
      );
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
        className="odoo-btn odoo-btn-secondary"
      >
        ຄືນເຄື່ອງ
      </button>
      {open ? (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 px-4">
          <button
            type="button"
            aria-label="ປິດ"
            className="absolute inset-0 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="relative max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-4 shadow-xl">
            <h2 className="text-base font-black text-odoo-text-strong">
              ຄືນເຄື່ອງບາງລາຍການ — {docNo}
            </h2>
            <ul className="mt-3 divide-y divide-odoo-border">
              {items.map((it) => {
                const chosen = qtys[it.lineNumber] ?? 0;
                return (
                  <li
                    key={it.lineNumber}
                    className="flex items-center gap-2 py-2"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-sm font-semibold">
                        {it.itemName ?? it.itemCode}
                      </div>
                      <div className="text-[11px] text-odoo-text-muted">
                        ຂາຍ {moneyFmt.format(it.qty)} ×{" "}
                        {moneyFmt.format(it.priceKip)} ກີບ
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        disabled={chosen <= 0}
                        onClick={() =>
                          setQtys((p) => ({
                            ...p,
                            [it.lineNumber]: Math.max(0, chosen - 1),
                          }))
                        }
                        className="h-9 w-9 rounded-lg border border-odoo-border font-bold disabled:opacity-40"
                      >
                        −
                      </button>
                      <span className="w-8 text-center font-mono font-bold">
                        {chosen}
                      </span>
                      <button
                        type="button"
                        disabled={chosen >= it.qty}
                        onClick={() =>
                          setQtys((p) => ({
                            ...p,
                            [it.lineNumber]: Math.min(it.qty, chosen + 1),
                          }))
                        }
                        className="h-9 w-9 rounded-lg border border-odoo-border font-bold disabled:opacity-40"
                      >
                        +
                      </button>
                    </div>
                  </li>
                );
              })}
            </ul>

            <div className="mt-2 flex items-baseline justify-between border-t border-odoo-border pt-2">
              <span className="text-sm font-semibold text-odoo-text-muted">
                ຄືນເງິນສົດ (ປະມານ)
              </span>
              <b className="font-mono text-lg text-odoo-primary">
                {moneyFmt.format(refundKip)} ກີບ
              </b>
            </div>

            <input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="ເຫດຜົນຄືນເຄື່ອງ"
              className="odoo-input mt-3 w-full"
            />
            <div className="mt-2 grid grid-cols-2 gap-2">
              <input
                type="text"
                value={managerCode}
                onChange={(e) => setManagerCode(e.target.value)}
                placeholder="ລະຫັດຜູ້ຈັດການ"
                className="odoo-input"
              />
              <input
                type="password"
                value={managerPin}
                onChange={(e) => setManagerPin(e.target.value)}
                placeholder="PIN"
                className="odoo-input"
              />
            </div>
            {error ? (
              <p className="mt-2 text-sm font-semibold text-odoo-danger">
                {error}
              </p>
            ) : null}
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="odoo-btn odoo-btn-secondary"
              >
                ຍົກເລີກ
              </button>
              <button
                type="button"
                disabled={busy || lines.length === 0}
                onClick={() => void submit()}
                className="odoo-btn odoo-btn-primary"
              >
                {busy ? "ກຳລັງບັນທຶກ…" : "ຢືນຢັນຄືນເຄື່ອງ"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
