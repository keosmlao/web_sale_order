"use client";

import { useEffect, useState } from "react";

type Account = { code: string; name: string };

type Slot = {
  currencyCode: string;
  payMethod: string;
  label: string;
  accountCode: string;
};

export default function PaymentAccountsClient({
  canManage,
}: {
  canManage: boolean;
}) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/payment-accounts");
        if (!res.ok) throw new Error(`payment-accounts ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        setAccounts((data.accounts ?? []) as Account[]);
        setSlots((data.slots ?? []) as Slot[]);
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "ໂຫລດບໍ່ສຳເລັດ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  function setSlotAccount(currencyCode: string, payMethod: string, code: string) {
    if (!canManage || saving) return;
    setSlots((prev) =>
      prev.map((s) =>
        s.currencyCode === currencyCode && s.payMethod === payMethod
          ? { ...s, accountCode: code }
          : s,
      ),
    );
    setSaved(false);
  }

  async function save() {
    if (!canManage || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/payment-accounts", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          entries: slots.map((s) => ({
            currencyCode: s.currencyCode,
            payMethod: s.payMethod,
            accountCode: s.accountCode,
          })),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `ບັນທຶກຜິດພາດ ${res.status}`);
        return;
      }
      setAccounts((data.accounts ?? []) as Account[]);
      setSlots((data.slots ?? []) as Slot[]);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-6">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">
          ບັນຊີຮັບເງິນ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ກຳນົດເລກບັນຊີ (GL) ທີ່ເງິນສົດ/ເງິນໂອນ ແຕ່ລະສະກຸນຈະເຂົ້າ. ໃຊ້ຕອນບັນທຶກ
          ໃບຮັບເງິນ (cb_trans_detail) ສຳລັບການກະທົບຍອດທະນາຄານໃນ SML.
        </p>
      </header>

      {!canManage ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          ສະຖານະອ່ານຢ່າງດຽວ — ສະເພາະຫົວໜ້າ/ຜູ້ຈັດການ ສາມາດແກ້ໄຂໄດ້.
        </div>
      ) : null}

      <div className="rounded-md border border-odoo-border bg-odoo-surface">
        <div className="flex items-center justify-between border-b border-odoo-border px-4 py-3">
          <div className="text-sm font-bold text-odoo-text-strong">
            ບັນຊີຮັບເງິນຕາມສະກຸນ ແລະ ຮູບແບບ
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!canManage || saving}
            className="odoo-btn odoo-btn-primary w-auto"
          >
            {saving ? "ກຳລັງບັນທຶກ..." : "ບັນທຶກ"}
          </button>
        </div>

        {error ? (
          <div className="mx-4 mt-4 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
            {error}
          </div>
        ) : null}
        {saved ? (
          <div className="mx-4 mt-4 rounded-md border border-emerald-300 bg-emerald-50 px-3 py-2 text-[13px] font-semibold text-emerald-700">
            ບັນທຶກບັນຊີຮັບເງິນສຳເລັດ
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-[480px] w-full text-sm">
            <thead className="bg-odoo-surface-muted text-left text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
              <tr>
                <th className="px-4 py-3">ສະກຸນ · ຮູບແບບ</th>
                <th className="px-4 py-3">ບັນຊີ (GL)</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={2} className="px-4 py-8 text-center text-odoo-text-muted">
                    ກຳລັງໂຫລດ...
                  </td>
                </tr>
              ) : (
                slots.map((s) => (
                  <tr
                    key={`${s.currencyCode}:${s.payMethod}`}
                    className="border-t border-odoo-border"
                  >
                    <td className="px-4 py-3 font-bold text-odoo-text-strong">
                      {s.label}
                    </td>
                    <td className="px-4 py-3">
                      <select
                        value={s.accountCode}
                        disabled={!canManage || saving}
                        onChange={(e) =>
                          setSlotAccount(s.currencyCode, s.payMethod, e.target.value)
                        }
                        className="w-full max-w-[420px] rounded-md border border-odoo-border bg-odoo-surface px-2 py-2 text-sm disabled:opacity-60"
                      >
                        {/* keep the saved code selectable even if it's not in the list */}
                        {accounts.some((a) => a.code === s.accountCode) ? null : (
                          <option value={s.accountCode}>{s.accountCode}</option>
                        )}
                        {accounts.map((a) => (
                          <option key={a.code} value={a.code}>
                            {a.code} — {a.name}
                          </option>
                        ))}
                      </select>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
