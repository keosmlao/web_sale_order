"use client";

import { useEffect, useMemo, useState } from "react";
import {
  CONFIGURABLE_ROLES,
  MENU_REGISTRY,
  ROLE_LABELS,
} from "@/lib/menu-registry";
import type { AppRole } from "@/lib/roles";

// Hidden cells are tracked as a flat Set of "role:key" strings.
function cellKey(role: AppRole, key: string) {
  return `${role}:${key}`;
}

export default function MenuVisibilityClient() {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [initial, setInitial] = useState<Set<string>>(new Set());
  const [canManage, setCanManage] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // Group the registry by section for rendering.
  const sections = useMemo(() => {
    const order: string[] = [];
    const bySection = new Map<string, typeof MENU_REGISTRY>();
    for (const item of MENU_REGISTRY) {
      if (!bySection.has(item.section)) {
        bySection.set(item.section, []);
        order.push(item.section);
      }
      bySection.get(item.section)!.push(item);
    }
    return order.map((name) => ({ name, items: bySection.get(name)! }));
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const res = await fetch("/api/settings/menu-visibility");
        if (!res.ok) return;
        const data = (await res.json()) as {
          canManage: boolean;
          hidden: Record<string, string[]>;
        };
        setCanManage(data.canManage);
        const set = new Set<string>();
        for (const [role, keys] of Object.entries(data.hidden ?? {})) {
          for (const k of keys) set.add(`${role}:${k}`);
        }
        setHidden(set);
        setInitial(new Set(set));
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const dirty = useMemo(() => {
    if (hidden.size !== initial.size) return true;
    for (const c of hidden) if (!initial.has(c)) return true;
    return false;
  }, [hidden, initial]);

  function toggleCell(role: AppRole, key: string) {
    if (!canManage) return;
    setHidden((cur) => {
      const next = new Set(cur);
      const c = cellKey(role, key);
      if (next.has(c)) next.delete(c);
      else next.add(c);
      return next;
    });
  }

  // Toggle a whole role column (hide-all / show-all).
  function toggleColumn(role: AppRole, hideAll: boolean) {
    if (!canManage) return;
    setHidden((cur) => {
      const next = new Set(cur);
      for (const item of MENU_REGISTRY) {
        const c = cellKey(role, item.key);
        if (hideAll) next.add(c);
        else next.delete(c);
      }
      return next;
    });
  }

  async function save() {
    if (!canManage || !dirty) return;
    setSaving(true);
    setMessage(null);
    try {
      const byRole: Record<string, string[]> = {};
      for (const c of hidden) {
        const idx = c.indexOf(":");
        const role = c.slice(0, idx);
        const key = c.slice(idx + 1);
        (byRole[role] ??= []).push(key);
      }
      const res = await fetch("/api/settings/menu-visibility", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: byRole }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setMessage({ kind: "err", text: data?.error ?? `Error ${res.status}` });
        return;
      }
      setInitial(new Set(hidden));
      setMessage({ kind: "ok", text: "ບັນທຶກສຳເລັດ" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <header className="mb-4">
        <div className="text-[11px] font-bold uppercase tracking-widest text-odoo-text-muted">
          ການຕັ້ງຄ່າ
        </div>
        <h1 className="mt-1 text-2xl font-black text-odoo-text-strong">ການສະແດງເມນູ</h1>
        <p className="mt-1 text-sm text-odoo-text-muted">
          ກຳນົດວ່າແຕ່ລະສິດ (role) ເຫັນເມນູໃດແດ່. ໝາຍຕິກ = ສະແດງ, ເອົາຕິກອອກ = ເຊື່ອງ.
          ໝາຍເຫດ: ການເຊື່ອງເມນູເປັນພຽງການສະແດງຜົນ ບໍ່ໄດ້ປ້ອງກັນການເຂົ້າເຖິງໂດຍ URL.
        </p>
      </header>

      {!loading && !canManage ? (
        <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-[13px] font-semibold text-amber-800">
          ສະຖານະອ່ານຢ່າງດຽວ — ສະເພາະຜູ້ຈັດການ ສາມາດແກ້ໄຂໄດ້
        </div>
      ) : null}

      {message ? (
        <div
          className={`mb-4 rounded-md px-3 py-2 text-[13px] font-semibold ${
            message.kind === "ok"
              ? "border border-emerald-300 bg-emerald-50 text-emerald-800"
              : "border border-red-300 bg-red-50 text-red-700"
          }`}
        >
          {message.text}
        </div>
      ) : null}

      {loading ? (
        <div className="text-sm text-odoo-text-muted">ກຳລັງໂຫຼດ…</div>
      ) : (
        <div className="overflow-x-auto rounded-md border border-odoo-border bg-odoo-surface">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-odoo-border bg-odoo-surface-muted">
                <th className="px-3 py-2 text-left font-bold text-odoo-text-strong">ເມນູ</th>
                {CONFIGURABLE_ROLES.map((role) => (
                  <th key={role} className="px-3 py-2 text-center font-bold text-odoo-text-strong">
                    <div>{ROLE_LABELS[role]}</div>
                    {canManage ? (
                      <div className="mt-1 flex justify-center gap-1 text-[10px] font-normal">
                        <button
                          type="button"
                          onClick={() => toggleColumn(role, false)}
                          className="rounded border border-odoo-border px-1.5 py-0.5 hover:bg-white"
                          title="ສະແດງທັງໝົດ"
                        >
                          ✓ ໝົດ
                        </button>
                        <button
                          type="button"
                          onClick={() => toggleColumn(role, true)}
                          className="rounded border border-odoo-border px-1.5 py-0.5 hover:bg-white"
                          title="ເຊື່ອງທັງໝົດ"
                        >
                          ✕ ໝົດ
                        </button>
                      </div>
                    ) : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {sections.map((section) => (
                <SectionRows
                  key={section.name}
                  name={section.name}
                  items={section.items}
                  hidden={hidden}
                  canManage={canManage}
                  onToggle={toggleCell}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}

      {canManage ? (
        <div className="mt-4 flex items-center gap-3">
          <button
            type="button"
            onClick={save}
            disabled={!dirty || saving}
            className="rounded-md bg-blue-700 px-5 py-2 text-sm font-bold text-white shadow-sm transition hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {saving ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກ"}
          </button>
          {dirty ? (
            <span className="text-[13px] font-semibold text-amber-700">ມີການປ່ຽນແປງທີ່ຍັງບໍ່ໄດ້ບັນທຶກ</span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function SectionRows({
  name,
  items,
  hidden,
  canManage,
  onToggle,
}: {
  name: string;
  items: typeof MENU_REGISTRY;
  hidden: Set<string>;
  canManage: boolean;
  onToggle: (role: AppRole, key: string) => void;
}) {
  return (
    <>
      <tr className="border-b border-odoo-border bg-odoo-surface-muted/60">
        <td
          colSpan={1 + CONFIGURABLE_ROLES.length}
          className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wide text-odoo-text-muted"
        >
          {name}
        </td>
      </tr>
      {items.map((item) => (
        <tr key={item.key} className="border-b border-odoo-border last:border-b-0">
          <td className="px-3 py-2 text-odoo-text-strong">
            {item.label}
            <span className="ml-2 font-mono text-[11px] text-odoo-text-muted">{item.key}</span>
          </td>
          {CONFIGURABLE_ROLES.map((role) => {
            const isHidden = hidden.has(`${role}:${item.key}`);
            return (
              <td key={role} className="px-3 py-2 text-center">
                <input
                  type="checkbox"
                  className="h-4 w-4"
                  checked={!isHidden}
                  disabled={!canManage}
                  onChange={() => onToggle(role, item.key)}
                  title={isHidden ? "ເຊື່ອງ" : "ສະແດງ"}
                />
              </td>
            );
          })}
        </tr>
      ))}
    </>
  );
}
