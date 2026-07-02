"use client";

import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Same shape the POS screen uses; the created customer is handed back to the
// POS through sessionStorage (pos.newCustomer) when we came from there.
type Customer = {
  id: string;
  name: string;
  phone: string | null;
  groupCode: string | null;
  groupName: string | null;
  discountPct: number;
  pointBalance: number;
};

type LocationOption = { code: string; name: string };
type AmperOption = LocationOption & { province: string | null };

// Bottom-sheet option picker: tap the field, search, tap a row. Far easier
// than a native <select> when the list runs to hundreds of villages.
function OptionPicker({
  label,
  value,
  options,
  placeholder,
  disabled = false,
  loading = false,
  onPick,
}: {
  label: string;
  value: string;
  options: LocationOption[];
  placeholder: string;
  disabled?: boolean;
  loading?: boolean;
  onPick: (code: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const selected = options.find((o) => o.code === value);
  const filtered = q.trim()
    ? options.filter((o) => o.name.toLowerCase().includes(q.trim().toLowerCase()))
    : options;

  return (
    <div className="grid gap-1">
      <span className="text-[11px] font-semibold text-odoo-text-muted">
        {label}
        {loading ? <span className="ml-1 text-[10px] font-normal">(ກຳລັງໂຫລດ…)</span> : null}
      </span>
      <button
        type="button"
        disabled={disabled || loading}
        onClick={() => {
          setQ("");
          setOpen(true);
        }}
        className={
          "flex min-h-11 w-full items-center justify-between gap-2 rounded-xl border bg-white px-3 py-2.5 text-left text-sm transition disabled:opacity-50 " +
          (selected ? "border-odoo-border font-bold text-odoo-text-strong" : "border-odoo-border text-odoo-text-muted")
        }
      >
        <span className="truncate">{selected ? selected.name : placeholder}</span>
        <span className="shrink-0 text-odoo-text-muted">▾</span>
      </button>

      {open ? (
        <div className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4">
          <button type="button" aria-label="ປິດ" className="absolute inset-0 cursor-default" onClick={() => setOpen(false)} />
          <div className="relative flex max-h-[85dvh] w-full max-w-md flex-col overflow-hidden rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl">
            <div className="flex items-center justify-between gap-3 border-b border-odoo-border px-4 py-3">
              <div className="text-sm font-black text-odoo-text-strong">{label}</div>
              <button type="button" onClick={() => setOpen(false)} className="odoo-btn odoo-btn-secondary">
                ປິດ
              </button>
            </div>
            <div className="border-b border-odoo-border p-3">
              <input
                type="search"
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder={`ຄົ້ນຫາ${label}…`}
                autoFocus
                className="odoo-input w-full"
              />
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-2">
              {filtered.length === 0 ? (
                <div className="py-10 text-center text-sm text-odoo-text-muted">ບໍ່ພົບ “{q}”</div>
              ) : (
                <div className="grid gap-1.5">
                  {filtered.map((o) => (
                    <button
                      key={o.code}
                      type="button"
                      onClick={() => {
                        onPick(o.code);
                        setOpen(false);
                      }}
                      className={
                        "flex min-h-11 items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left text-sm font-semibold transition " +
                        (o.code === value
                          ? "border-odoo-primary bg-odoo-primary/10 text-odoo-primary"
                          : "border-odoo-border bg-white text-odoo-text-strong hover:bg-odoo-surface-muted")
                      }
                    >
                      <span className="truncate">{o.name}</span>
                      {o.code === value ? <span className="shrink-0">✓</span> : null}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function NewMemberClient() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const returnToPos = searchParams.get("return") === "pos";

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // ປະເພດສະມາຊິກ: "general" = ສະມາຊິກທົ່ວໄປ (ບໍ່ມີສ່ວນຫຼຸດ),
  // "line_oa" = ສະມາຊິກ LINE O.A (Gold + ສ່ວນຫຼຸດ 3%).
  const [memberType, setMemberType] = useState<"general" | "line_oa">("general");
  const [provinceCode, setProvinceCode] = useState("");
  const [amperCode, setAmperCode] = useState("");
  const [tambonCode, setTambonCode] = useState("");
  const [provinces, setProvinces] = useState<LocationOption[]>([]);
  const [ampers, setAmpers] = useState<AmperOption[]>([]);
  const [tambons, setTambons] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [loadingTambons, setLoadingTambons] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Provinces (~20) + ampers (~149) ship up front; tambons (~10k) load on
  // demand once a district is picked.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/locations");
        if (!res.ok) throw new Error(`locations ${res.status}`);
        const data = (await res.json()) as {
          provinces?: LocationOption[];
          ampers?: AmperOption[];
        };
        if (cancelled) return;
        setProvinces(data.provinces ?? []);
        setAmpers(data.ampers ?? []);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : "ໂຫລດຂໍ້ມູນທີ່ຢູ່ຜິດພາດ");
      } finally {
        if (!cancelled) setLoadingLocations(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!amperCode) return;
    let cancelled = false;
    (async () => {
      if (!cancelled) setLoadingTambons(true);
      try {
        const res = await fetch(`/api/locations?amper=${encodeURIComponent(amperCode)}`);
        if (!res.ok) throw new Error(`tambons ${res.status}`);
        const data = (await res.json()) as { tambons?: LocationOption[] };
        if (cancelled) return;
        setTambons(data.tambons ?? []);
      } catch {
        if (!cancelled) setTambons([]);
      } finally {
        if (!cancelled) setLoadingTambons(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amperCode]);

  const filteredAmpers = provinceCode ? ampers.filter((a) => a.province === provinceCode) : [];

  function nameByCode(list: LocationOption[], code: string) {
    return list.find((it) => it.code === code)?.name ?? "";
  }

  // Same prefix/length rule as the Flutter app; the server rechecks on POST.
  function validatePhone(p: string): string | null {
    if (!p) return "ກະລຸນາໃສ່ເບີໂທ";
    if (/^20\d{8}$/.test(p)) return null;
    if (/^30\d{7}$/.test(p)) return null;
    return "ເບີໂທຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ 20 (10 ຕົວ) ຫຼື 30 (9 ຕົວ)";
  }

  function goBack() {
    if (returnToPos) router.push("/orders/new");
    else router.push("/members");
  }

  async function submit() {
    if (submitting) return;
    setError(null);
    const trimmedName = name.trim();
    const digitPhone = phone.replace(/\D+/g, "");
    if (!trimmedName) {
      setError("ກະລຸນາໃສ່ຊື່ລູກຄ້າ");
      return;
    }
    const phoneError = validatePhone(digitPhone);
    if (phoneError) {
      setError(phoneError);
      return;
    }
    setSubmitting(true);
    try {
      // Compose "ບ້ານ X, ເມືອງ Y, ແຂວງ Z" from the picker labels so
      // ar_customer.address stays one readable string.
      const provinceName = nameByCode(provinces, provinceCode);
      const amperName = nameByCode(filteredAmpers, amperCode);
      const tambonName = nameByCode(tambons, tambonCode);
      const parts: string[] = [];
      if (tambonName) parts.push(`ບ້ານ ${tambonName}`);
      if (amperName) parts.push(`ເມືອງ ${amperName}`);
      if (provinceName) parts.push(`ແຂວງ ${provinceName}`);
      const composedAddress = parts.join(", ");
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          phone: digitPhone,
          address: composedAddress || undefined,
          memberType,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError((data as { error?: string } | null)?.error ?? `ຜິດພາດ ${res.status}`);
        setSubmitting(false);
        return;
      }
      const customer = data as Customer;
      if (returnToPos) {
        // Hand the fresh member back to the POS, which attaches them to the
        // bill and moves the wizard on to products.
        try {
          sessionStorage.setItem("pos.newCustomer", JSON.stringify(customer));
        } catch {
          /* storage full/blocked — POS just won't auto-attach */
        }
        router.push("/orders/new");
      } else {
        router.push("/members");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ");
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 pb-28 pt-5 sm:px-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={goBack}
          aria-label="ກັບຄືນ"
          className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-odoo-border bg-white text-lg font-black text-odoo-text-strong shadow-sm"
        >
          ←
        </button>
        <div>
          <h1 className="text-xl font-black tracking-tight text-odoo-text-strong">ສ້າງລູກຄ້າໃໝ່</h1>
          <p className="text-xs text-odoo-text-muted">
            {returnToPos ? "ບັນທຶກແລ້ວຈະຕິດລູກຄ້າໃສ່ບິນ POS ໃຫ້ເລີຍ" : "ລົງທະບຽນສະມາຊິກໃໝ່"}
          </p>
        </div>
      </div>

      <div className="mt-5 grid gap-4">
        {/* ປະເພດສະມາຊິກ */}
        <div className="grid gap-2">
          <span className="odoo-label">ປະເພດສະມາຊິກ *</span>
          <div className="grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setMemberType("general")}
              aria-pressed={memberType === "general"}
              className={
                "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-3 text-left transition " +
                (memberType === "general"
                  ? "border-odoo-primary bg-odoo-primary/10 ring-1 ring-odoo-primary"
                  : "border-odoo-border bg-white hover:bg-odoo-surface-muted")
              }
            >
              <span className="text-[13px] font-bold text-odoo-text-strong">ສະມາຊິກທົ່ວໄປ</span>
              <span className="text-[11px] font-semibold text-odoo-text-muted">ບໍ່ມີສ່ວນຫຼຸດ</span>
            </button>
            <button
              type="button"
              onClick={() => setMemberType("line_oa")}
              aria-pressed={memberType === "line_oa"}
              className={
                "flex flex-col items-start gap-0.5 rounded-xl border px-3 py-3 text-left transition " +
                (memberType === "line_oa"
                  ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500"
                  : "border-odoo-border bg-white hover:bg-odoo-surface-muted")
              }
            >
              <span className="text-[13px] font-bold text-odoo-text-strong">ສະມາຊິກ LINE O.A</span>
              <span className="text-[11px] font-semibold text-amber-700">Gold · ສ່ວນຫຼຸດ 3%</span>
            </button>
          </div>
        </div>

        {/* ປ້າຍສະຖານະ */}
        {memberType === "line_oa" ? (
          <div
            className="flex items-center gap-3 rounded-xl border px-3 py-3"
            style={{
              background: "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(253,224,71,0.10))",
              borderColor: "rgba(202,138,4,0.35)",
            }}
          >
            <div
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
              style={{
                background: "linear-gradient(135deg, #fde047, #ca8a04)",
                boxShadow: "0 3px 8px rgba(202,138,4,0.3)",
              }}
            >
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                <path d="M9 11.75l-2.21-1.16-1.16-2.21L4.47 10.59 2.26 11.75l2.21 1.16 1.16 2.21 1.16-2.21 2.21-1.16zM19.53 13.41L18.37 11.2l-2.21-1.16 2.21-1.16L19.53 6.67l1.16 2.21 2.21 1.16-2.21 1.16-1.16 2.21zM12 2l-2.4 5.6L4 9l4.6 3.5L7.3 18 12 14.9 16.7 18l-1.3-5.5L20 9l-5.6-1.4L12 2z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-black text-amber-700">ສະຖານະ: Gold</div>
              <div className="mt-0.5 text-[11px] font-bold text-amber-700/85">ສ່ວນຫຼຸດ 3% ຕໍ່ບິນ ໂດຍອັດຕະໂນມັດ</div>
            </div>
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-xl border border-odoo-border bg-odoo-surface-muted px-3 py-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-slate-200 text-slate-600">
              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="h-6 w-6">
                <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
              </svg>
            </div>
            <div className="min-w-0">
              <div className="text-[14px] font-black text-odoo-text-strong">ສະມາຊິກທົ່ວໄປ</div>
              <div className="mt-0.5 text-[11px] font-bold text-odoo-text-muted">ບໍ່ມີສ່ວນຫຼຸດ</div>
            </div>
          </div>
        )}

        <label className="grid gap-1">
          <span className="odoo-label">ຊື່ *</span>
          <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="odoo-input" autoFocus />
        </label>
        <label className="grid gap-1">
          <span className="odoo-label">ເບີໂທ *</span>
          <input
            type="tel"
            inputMode="numeric"
            maxLength={10}
            value={phone}
            onChange={(e) => setPhone(e.target.value.replace(/\D+/g, "").slice(0, 10))}
            className="odoo-input"
          />
          <span className="text-[11px] text-odoo-text-muted">ຂຶ້ນຕົ້ນ 20 (10 ຕົວ) ຫຼື 30 (9 ຕົວ)</span>
        </label>

        <div className="grid gap-3">
          <span className="odoo-label">
            ທີ່ຢູ່
            {loadingLocations ? (
              <span className="ml-2 text-[11px] font-normal text-odoo-text-muted">ກຳລັງໂຫລດ...</span>
            ) : null}
          </span>
          <div className="grid gap-3 sm:grid-cols-3">
            <OptionPicker
              label="ແຂວງ"
              value={provinceCode}
              options={provinces}
              placeholder="— ເລືອກແຂວງ —"
              disabled={loadingLocations}
              onPick={(code) => {
                setProvinceCode(code);
                setAmperCode("");
                setTambonCode("");
                setTambons([]);
              }}
            />
            <OptionPicker
              label="ເມືອງ"
              value={amperCode}
              options={filteredAmpers}
              placeholder="— ເລືອກເມືອງ —"
              disabled={!provinceCode || loadingLocations}
              onPick={(code) => {
                setAmperCode(code);
                setTambonCode("");
              }}
            />
            <OptionPicker
              label="ບ້ານ"
              value={tambonCode}
              options={tambons}
              placeholder="— ເລືອກບ້ານ —"
              disabled={!amperCode}
              loading={loadingTambons}
              onPick={setTambonCode}
            />
          </div>
        </div>

        {error ? (
          <div className="flex items-start gap-2 rounded-xl border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="mt-0.5 h-5 w-5 shrink-0">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z" />
            </svg>
            <span>{error}</span>
          </div>
        ) : null}
      </div>

      {/* Sticky save bar — thumb-reachable on phones */}
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-odoo-border bg-white/95 px-4 py-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] backdrop-blur">
        <div className="mx-auto flex max-w-xl gap-2">
          <button
            type="button"
            onClick={goBack}
            disabled={submitting}
            className="h-12 shrink-0 rounded-xl border border-odoo-border bg-white px-5 text-sm font-bold text-odoo-text-strong"
          >
            ຍົກເລີກ
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="h-12 flex-1 rounded-xl bg-odoo-primary text-[15px] font-black text-white shadow-md transition hover:brightness-110 disabled:opacity-60"
          >
            {submitting ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກ"}
          </button>
        </div>
      </div>
    </div>
  );
}
