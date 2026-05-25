"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";

type Shift = {
  id: string;
  cashierCode: string;
  branchCode: string | null;
  openedAt: string;
  openingCash: number;
  status: string;
};

const moneyFmt = new Intl.NumberFormat("en-US");

export default function ShiftBar() {
  const router = useRouter();
  const [shift, setShift] = useState<Shift | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/cashier/shift/current");
      if (!res.ok) return;
      const data = await res.json();
      setShift(data.shift ?? null);
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function openShift() {
    const raw = window.prompt(
      "ເງິນສົດເລີ່ມຕົ້ນຂອງກະ (ກີບ):",
      "0",
    );
    if (raw === null) return;
    const openingCash = Number(raw);
    if (!Number.isFinite(openingCash) || openingCash < 0) {
      window.alert("ຍອດເງິນບໍ່ຖືກຕ້ອງ");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/cashier/shift/open", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openingCash }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert(data?.error ?? `Error ${res.status}`);
        return;
      }
      await refresh();
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  async function closeShift() {
    if (!shift) return;
    const raw = window.prompt(
      "ນັບເງິນສົດໃນລິ້ນຊັກໝົດ (ກີບ):",
      "0",
    );
    if (raw === null) return;
    const countedCash = Number(raw);
    if (!Number.isFinite(countedCash) || countedCash < 0) {
      window.alert("ຍອດເງິນບໍ່ຖືກຕ້ອງ");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/cashier/shift/close", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shiftId: shift.id, countedCash }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert(data?.error ?? `Error ${res.status}`);
        return;
      }
      const variance = Number(data.variance ?? 0);
      window.alert(
        `ປິດກະສຳເລັດ.\nຄາດໝາຍ: ${moneyFmt.format(Number(data.expectedCash ?? 0))} ກີບ` +
          `\nນັບໄດ້: ${moneyFmt.format(Number(data.countedCash ?? 0))} ກີບ` +
          `\nສ່ວນຕ່າງ: ${variance >= 0 ? "+" : ""}${moneyFmt.format(variance)} ກີບ`,
      );
      const closedId = shift.id;
      setShift(null);
      router.push(`/cashier/shift/${closedId}`);
    } finally {
      setBusy(false);
    }
  }

  async function addMovement(type: "drop" | "payout" | "adjustment") {
    if (!shift) return;
    const label =
      type === "drop"
        ? "ດຶງເງິນຈາກລິ້ນຊັກ"
        : type === "payout"
          ? "ຈ່າຍຄ່າໃຊ້ຈ່າຍ"
          : "ປັບແຕ່ງຍອດ (ໃສ່ + ຫຼື −)";
    const amountRaw = window.prompt(`${label} — ຈຳນວນ (ກີບ):`, "0");
    if (amountRaw === null) return;
    const amount = Number(amountRaw);
    if (!Number.isFinite(amount) || amount === 0) {
      window.alert("ຈຳນວນບໍ່ຖືກຕ້ອງ");
      return;
    }
    const reason = window.prompt("ເຫດຜົນ:", "");
    if (reason === null || !reason.trim()) {
      window.alert("ຕ້ອງໃສ່ເຫດຜົນ");
      return;
    }
    setBusy(true);
    try {
      const res = await fetch("/api/cashier/shift/movement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shiftId: shift.id,
          type,
          amount,
          reason: reason.trim(),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        window.alert(data?.error ?? `Error ${res.status}`);
        return;
      }
      window.alert("ບັນທຶກສຳເລັດ");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  if (!shift) {
    return (
      <div className="mb-3 flex items-center justify-between gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
        <span>⚠ ຍັງບໍ່ໄດ້ເປີດກະ — ກົດເພື່ອເລີ່ມ</span>
        <button
          type="button"
          disabled={busy}
          onClick={openShift}
          className="odoo-btn odoo-btn-primary"
        >
          ເປີດກະ
        </button>
      </div>
    );
  }

  return (
    <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-800">
      <span>
        ✓ ກະເປີດ ·{" "}
        <Link
          href={`/cashier/shift/${shift.id}`}
          className="underline hover:no-underline"
        >
          #{shift.id}
        </Link>
        {" · "}ເງິນສົດເລີ່ມຕົ້ນ {moneyFmt.format(shift.openingCash)} ກີບ
        {" · "}ເປີດເມື່ອ {new Date(shift.openedAt).toLocaleTimeString()}
      </span>
      <div className="flex items-center gap-1">
        <button
          type="button"
          disabled={busy}
          onClick={() => addMovement("drop")}
          className="odoo-btn"
          title="ດຶງເງິນອອກຈາກລິ້ນຊັກ"
        >
          ດຶງເງິນ
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => addMovement("payout")}
          className="odoo-btn"
          title="ຈ່າຍຄ່າໃຊ້ຈ່າຍ"
        >
          ຈ່າຍຄ່າ
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => addMovement("adjustment")}
          className="odoo-btn"
        >
          ປັບແຕ່ງ
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={closeShift}
          className="odoo-btn odoo-btn-danger"
        >
          ປິດກະ
        </button>
      </div>
    </div>
  );
}
