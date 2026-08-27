"use client";

import { useState } from "react";
import Link from "next/link";

// Paste a price sheet, check what it resolved to, then commit it.
//
// Promotions run off a spreadsheet with a three-day window. Entering them
// one form at a time is why, across a year of running them, exactly two
// promotions were ever created in this system and both were tests. The
// sheet is the input now.

type Row = {
  line: number;
  itemCode: string;
  itemName: string | null;
  specialPrice: number | null;
  catalogPrice: number | null;
  giftText: string | null;
  giftMatches: Array<{ code: string; name: string }>;
  giftCode: string | null;
  kind: "fixed_price_period" | "bogo" | null;
  status: "ok" | "needs-gift" | "no-item" | "no-price";
  message: string | null;
};

const money = new Intl.NumberFormat("en-US");

export default function ImportClient() {
  const [text, setText] = useState("");
  const [name, setName] = useState("");
  const [startAt, setStartAt] = useState("");
  const [endAt, setEndAt] = useState("");
  const [rows, setRows] = useState<Row[] | null>(null);
  const [skippedLines, setSkippedLines] = useState(0);
  const [giftChoices, setGiftChoices] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);

  async function check() {
    setBusy(true);
    setError(null);
    setDone(null);
    try {
      const res = await fetch("/api/promotions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text, giftChoices, dryRun: true }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setRows(data.rows as Row[]);
      setSkippedLines(data.skippedLines ?? 0);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function commit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/promotions/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text,
          giftChoices,
          name,
          startAt,
          endAt,
          dryRun: false,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error ?? `HTTP ${res.status}`);
      setDone(
        `ສ້າງ ${data.created} ໂປຣແລ້ວ` +
          (data.skippedRows ? ` · ຂ້າມ ${data.skippedRows} ແຖວ` : ""),
      );
      setRows(null);
      setText("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const ready = rows?.filter((r) => r.status === "ok").length ?? 0;
  const blocked = rows ? rows.length - ready : 0;
  const canCommit =
    ready > 0 && name.trim() !== "" && startAt !== "" && endAt !== "" && !busy;

  return (
    <div className="mx-auto w-full max-w-[980px] px-5 py-8">
      <div className="mb-6">
        <Link
          href="/promotions"
          className="text-[12px] font-bold text-odoo-text-muted hover:text-odoo-primary"
        >
          ← ໂປຣໂມຊັນ
        </Link>
        <h1 className="mt-2 text-[24px] font-black text-odoo-text-strong">
          ນຳເຂົ້າຈາກໃບລາຄາ
        </h1>
        <p className="mt-2 max-w-[62ch] text-[13.5px] leading-relaxed text-odoo-text-muted">
          copy ແຖວຈາກ Excel ມາວາງລຸ່ມນີ້ — ລະຫັດສິນຄ້າ, ລາຄາປົກກະຕິ,
          ລາຄາພິເສດ ແລະ ຄໍລຳໂປຣໂມຊັ້ນ. ກົດກວດເບິ່ງກ່ອນ ຈຶ່ງສ້າງ.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            ຊື່ໃບໂປຣ
          </span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="ໂປຣເຄື່ອງໃຊ້ໄຟຟ້າ ສ.ຫ. 28-31/8"
            className="h-10 rounded-lg border border-odoo-border bg-white px-3 text-[13.5px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            ເລີ່ມ
          </span>
          <input
            type="date"
            value={startAt}
            onChange={(e) => setStartAt(e.target.value)}
            className="h-10 rounded-lg border border-odoo-border bg-white px-3 text-[13.5px]"
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-wider text-odoo-text-muted">
            ສິ້ນສຸດ
          </span>
          <input
            type="date"
            value={endAt}
            onChange={(e) => setEndAt(e.target.value)}
            className="h-10 rounded-lg border border-odoo-border bg-white px-3 text-[13.5px]"
          />
        </label>
      </div>

      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={9}
        placeholder={"110104-0580\tຈັກຊັກເຄື່ອງ\tHitachi\t8\tTop load\tLTL 08Moo GG\t6,070,000\t4,850,000\t-"}
        className="mt-4 w-full rounded-xl border border-odoo-border bg-white p-3 font-mono text-[12px] leading-relaxed"
      />

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={check}
          disabled={busy || text.trim() === ""}
          className="h-10 rounded-lg bg-odoo-surface-muted px-4 text-[13px] font-black text-odoo-text-strong disabled:opacity-40"
        >
          {busy ? "ກຳລັງກວດ…" : "ກວດເບິ່ງ"}
        </button>
        {rows ? (
          <button
            type="button"
            onClick={commit}
            disabled={!canCommit}
            className="h-10 rounded-lg bg-odoo-primary px-5 text-[13px] font-black text-white disabled:opacity-40"
          >
            ສ້າງ {ready} ໂປຣ
          </button>
        ) : null}
        {rows ? (
          <span className="text-[12.5px] text-odoo-text-muted">
            ພ້ອມ {ready}
            {blocked ? ` · ຄ້າງ ${blocked}` : ""}
            {skippedLines ? ` · ຂ້າມແຖວຫົວ ${skippedLines}` : ""}
          </span>
        ) : null}
      </div>

      {error ? (
        <p className="mt-4 rounded-lg bg-rose-50 px-4 py-3 text-[13px] font-semibold text-rose-700">
          {error}
        </p>
      ) : null}
      {done ? (
        <p className="mt-4 rounded-lg bg-emerald-50 px-4 py-3 text-[13px] font-semibold text-emerald-700">
          {done}
        </p>
      ) : null}

      {rows ? (
        <div className="mt-6 overflow-x-auto rounded-xl border border-odoo-border bg-white">
          <table className="w-full min-w-[760px] border-collapse text-[13px]">
            <thead>
              <tr className="border-b border-odoo-border text-[11px] uppercase tracking-wider text-odoo-text-muted">
                <th className="px-3 py-2 text-left font-bold">ສິນຄ້າ</th>
                <th className="px-3 py-2 text-right font-bold">ລາຄາປັດຈຸບັນ</th>
                <th className="px-3 py-2 text-right font-bold">ລາຄາພິເສດ</th>
                <th className="px-3 py-2 text-left font-bold">ຂອງແຖມ</th>
                <th className="px-3 py-2 text-left font-bold">ສະຖານະ</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.line} className="border-b border-odoo-border/60">
                  <td className="px-3 py-2.5 align-top">
                    <div className="font-mono text-[11.5px] text-odoo-text-muted">
                      {r.itemCode}
                    </div>
                    <div className="font-semibold text-odoo-text-strong">
                      {r.itemName ?? "—"}
                    </div>
                  </td>
                  <td className="px-3 py-2.5 text-right align-top tabular-nums text-odoo-text-muted">
                    {r.catalogPrice ? money.format(r.catalogPrice) : "—"}
                  </td>
                  <td className="px-3 py-2.5 text-right align-top font-black tabular-nums text-odoo-text-strong">
                    {r.specialPrice ? money.format(r.specialPrice) : "—"}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    {r.giftText ? (
                      r.giftMatches.length > 1 || r.status === "needs-gift" ? (
                        <select
                          value={giftChoices[r.itemCode] ?? ""}
                          onChange={(e) =>
                            setGiftChoices((prev) => ({
                              ...prev,
                              [r.itemCode]: e.target.value,
                            }))
                          }
                          className="w-full max-w-[280px] rounded-md border border-amber-300 bg-amber-50 px-2 py-1 text-[12px]"
                        >
                          <option value="">— ເລືອກຂອງແຖມ —</option>
                          {r.giftMatches.map((m) => (
                            <option key={m.code} value={m.code}>
                              {m.name}
                            </option>
                          ))}
                        </select>
                      ) : (
                        <span className="text-[12.5px] text-odoo-text">
                          {r.giftText}
                        </span>
                      )
                    ) : (
                      <span className="text-odoo-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-3 py-2.5 align-top">
                    <span
                      className={
                        "rounded-full px-2.5 py-1 text-[11px] font-black " +
                        (r.status === "ok"
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-amber-50 text-amber-700")
                      }
                    >
                      {r.status === "ok"
                        ? r.kind === "bogo"
                          ? "ຊື້ແຖມ"
                          : "ລາຄາພິເສດ"
                        : (r.message ?? "ຄ້າງ")}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}

      {rows ? (
        <p className="mt-4 text-[12px] leading-relaxed text-odoo-text-muted">
          ສ້າງແລ້ວ ໂປຣເກົ່າຂອງສິນຄ້າດຽວກັນຈະຖືກປິດອັດຕະໂນມັດ — ສອງໂປຣ
          ພ້ອມກັນໃນສິນຄ້າດຽວແມ່ນສອງລາຄາ.
        </p>
      ) : null}
    </div>
  );
}
