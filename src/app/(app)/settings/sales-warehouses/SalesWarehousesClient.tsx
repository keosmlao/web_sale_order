"use client";

import { useEffect, useMemo, useState } from "react";

type Warehouse = {
  code: string;
  name: string;
  branchCode: string | null;
  odCode: string | null;
  isSalesWarehouse: boolean;
};

export default function SalesWarehousesClient({
  canManage,
}: {
  canManage: boolean;
}) {
  const [items, setItems] = useState<Warehouse[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/settings/sales-warehouses");
        if (!res.ok) throw new Error(`warehouses ${res.status}`);
        const data = await res.json();
        if (cancelled) return;
        const rows = (data.items ?? []) as Warehouse[];
        setItems(rows);
        setSelected(
          new Set(rows.filter((row) => row.isSalesWarehouse).map((row) => row.code)),
        );
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "ໂຫລດສາງບໍ່ສຳເລັດ");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedList = useMemo(() => [...selected].sort(), [selected]);

  function toggle(code: string) {
    if (!canManage || saving) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(code)) next.delete(code);
      else next.add(code);
      return next;
    });
    setSaved(false);
  }

  async function save() {
    if (!canManage || saving) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch("/api/settings/sales-warehouses", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ warehouseCodes: selectedList }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `ບັນທຶກຜິດພາດ ${res.status}`);
        return;
      }
      const rows = (data.items ?? []) as Warehouse[];
      setItems(rows);
      setSelected(
        new Set(rows.filter((row) => row.isSalesWarehouse).map((row) => row.code)),
      );
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
          ສາງຂາຍ
        </h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ເລືອກສາງທີ່ POS ແລະ app ນຳໄປໃຊ້ເປັນ stock ສຳລັບການຂາຍ.
        </p>
      </header>

      {!canManage ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          ສະຖານະອ່ານຢ່າງດຽວ — ສະເພາະຫົວໜ້າ/ຜູ້ຈັດການ ສາມາດແກ້ໄຂໄດ້.
        </div>
      ) : null}

      <div className="rounded-md border border-odoo-border bg-odoo-surface">
        <div className="flex items-center justify-between gap-3 border-b border-odoo-border px-4 py-3">
          <div>
            <div className="text-sm font-bold text-odoo-text-strong">
              ສາງທີ່ເລືອກ {selected.size} ສາງ
            </div>
            <div className="mt-0.5 text-xs text-odoo-text-muted">
              {selectedList.length ? selectedList.join(", ") : "ຍັງບໍ່ໄດ້ເລືອກ"}
            </div>
          </div>
          <button
            type="button"
            onClick={save}
            disabled={!canManage || saving || selected.size === 0}
            className="odoo-btn odoo-btn-primary"
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
            ບັນທຶກສາງຂາຍສຳເລັດ
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <table className="min-w-full text-sm">
            <thead className="bg-odoo-surface-muted text-left text-xs font-bold uppercase tracking-wider text-odoo-text-muted">
              <tr>
                <th className="px-4 py-3">ໃຊ້ຂາຍ</th>
                <th className="px-4 py-3">ສາງ</th>
                <th className="px-4 py-3">ສາຂາ</th>
                <th className="px-4 py-3">OD</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-odoo-text-muted">
                    ກຳລັງໂຫລດ...
                  </td>
                </tr>
              ) : (
                items.map((row) => {
                  const checked = selected.has(row.code);
                  return (
                    <tr key={row.code} className="border-t border-odoo-border">
                      <td className="px-4 py-3">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={checked}
                          disabled={!canManage || saving}
                          onClick={() => toggle(row.code)}
                          className={
                            "inline-flex h-7 w-12 items-center rounded-full border p-1 transition disabled:opacity-60 " +
                            (checked
                              ? "justify-end border-emerald-600 bg-emerald-600"
                              : "justify-start border-odoo-border bg-odoo-surface-muted")
                          }
                        >
                          <span className="h-5 w-5 rounded-full bg-white shadow-sm" />
                        </button>
                      </td>
                      <td className="px-4 py-3">
                        <div className="font-bold text-odoo-text-strong">{row.code}</div>
                        <div className="text-xs text-odoo-text-muted">{row.name}</div>
                      </td>
                      <td className="px-4 py-3 text-odoo-text-muted">{row.branchCode ?? "—"}</td>
                      <td className="px-4 py-3 text-odoo-text-muted">{row.odCode ?? "—"}</td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
