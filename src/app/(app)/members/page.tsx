"use client";

import { useEffect, useState, useTransition, Suspense } from "react";
import { useRouter, usePathname, useSearchParams } from "next/navigation";
import {
  getMembersData,
  type Member,
  type TierFacet,
} from "./actions";

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200] as const;
const numFmt = new Intl.NumberFormat("en-US");

function fmtDiscount(pct: number): string {
  if (!Number.isFinite(pct) || pct <= 0) return "—";
  return pct === Math.floor(pct) ? `${pct}%` : `${pct.toFixed(1)}%`;
}

// SVG Icons for Stat Cards
const UsersIcon = (
  <svg className="h-5 w-5 text-indigo-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M17 20h5v-2a3 3 0 00-5.356-1.857M17 20H7m10 0v-2c0-.656-.126-1.283-.356-1.857M7 20H2v-2a3 3 0 015.356-1.857M7 20v-2c0-.656.126-1.283.356-1.857m0 0a5.002 5.002 0 019.288 0M15 7a3 3 0 11-6 0 3 3 0 016 0zm6 3a2 2 0 11-4 0 2 2 0 014 0zM7 10a2 2 0 11-4 0 2 2 0 014 0z" />
  </svg>
);

const TiersIcon = (
  <svg className="h-5 w-5 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M5 3v4M3 5h4M6 17v4m-2-2h4m5-16l2.286 6.857L21 12l-5.714 2.143L13 21l-2.286-6.857L5 12l5.714-2.143L13 3z" />
  </svg>
);

const PageIcon = (
  <svg className="h-5 w-5 text-sky-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
  </svg>
);

const FilterIcon = (
  <svg className="h-5 w-5 text-emerald-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.2">
    <path strokeLinecap="round" strokeLinejoin="round" d="M3 4a1 1 0 011-1h16a1 1 0 011 1v2.586a1 1 0 01-.293.707l-6.414 6.414a1 1 0 00-.293.707V17l-4 4v-6.586a1 1 0 00-.293-.707L3.293 7.293A1 1 0 013 6.586V4z" />
  </svg>
);

export default function MembersPageWrapper() {
  return (
    <Suspense
      fallback={
        <div className="flex h-screen w-full items-center justify-center bg-slate-50">
          <div className="flex flex-col items-center gap-4">
            <div className="relative flex h-14 w-14 items-center justify-center">
              <div className="absolute inset-0 animate-ping rounded-full bg-indigo-400 opacity-20" />
              <div className="h-10 w-10 animate-spin rounded-full border-3 border-indigo-100 border-t-indigo-600 shadow-md" />
            </div>
            <span className="text-sm font-bold text-slate-500 animate-pulse font-sans">ກຳລັງໂຫຼດຂໍ້ມູນສະມາຊິກ...</span>
          </div>
        </div>
      }
    >
      <MembersPage />
    </Suspense>
  );
}

function MembersSkeleton() {
  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 w-full animate-pulse">
      {/* Header Skeleton */}
      <div className="mb-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="h-8 w-48 rounded-lg bg-slate-200" />
          <div className="mt-2 h-4 w-72 rounded-lg bg-slate-200" />
        </div>
      </div>

      {/* Stat Cards Skeleton */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-xl border border-slate-100 bg-white p-5">
            <div className="h-3 w-24 rounded-sm bg-slate-200" />
            <div className="mt-3 h-6 w-16 rounded-sm bg-slate-200" />
          </div>
        ))}
      </div>

      {/* Filter bar Skeleton */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="h-11 flex-1 rounded-xl bg-slate-200" />
        <div className="flex gap-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="h-9 w-20 rounded-xl bg-slate-200" />
          ))}
        </div>
      </div>

      {/* Table Skeleton */}
      <div className="rounded-xl border border-slate-100 bg-white p-2">
        <div className="h-10 w-full rounded-lg bg-slate-100 mb-2" />
        {[...Array(5)].map((_, i) => (
          <div key={i} className="h-12 w-full rounded-lg bg-slate-50 mb-1.5" />
        ))}
      </div>
    </div>
  );
}

function MembersPage() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  const qParam = searchParams.get("q") ?? "";
  const tierParam = searchParams.get("tier") ?? "ALL";
  const pageParam = searchParams.get("page") ?? "1";
  const pageSizeParam = searchParams.get("pageSize") ?? "50";

  const [data, setData] = useState<{
    members: Member[];
    tiers: TierFacet[];
    total: number;
    grandTotal: number;
    page: number;
    pageSize: number;
  } | null>(null);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState(qParam);

  const [prevQParam, setPrevQParam] = useState(qParam);
  if (qParam !== prevQParam) {
    setPrevQParam(qParam);
    setSearchInput(qParam);
  }

  // Copy success mapping
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const handleCopy = (id: string) => {
    navigator.clipboard.writeText(id);
    setCopiedId(id);
    setTimeout(() => {
      setCopiedId(null);
    }, 1500);
  };

  useEffect(() => {
    let active = true;
    async function load() {
      setLoading(true);
      try {
        const res = await getMembersData({
          q: qParam,
          tier: tierParam,
          page: pageParam,
          pageSize: pageSizeParam,
        });
        if (active) {
          setData(res);
        }
      } catch (err) {
        console.error("Failed to load members:", err);
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    }
    load();
    return () => {
      active = false;
    };
  }, [qParam, tierParam, pageParam, pageSizeParam]);

  useEffect(() => {
    if (searchInput === qParam) return;
    const timer = setTimeout(() => {
      pushParams({ q: searchInput || null, page: "1" });
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchInput]);

  function pushParams(patch: Record<string, string | null>) {
    const params = new URLSearchParams();
    if (qParam) params.set("q", qParam);
    if (tierParam && tierParam !== "ALL") params.set("tier", tierParam);
    if (Number(pageParam) > 1) params.set("page", pageParam);
    if (Number(pageSizeParam) !== 50) params.set("pageSize", pageSizeParam);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === "" || v === "ALL") params.delete(k);
      else params.set(k, v);
    }
    const search = params.toString();
    startTransition(() => {
      router.replace(search ? `${pathname}?${search}` : pathname, {
        scroll: false,
      });
    });
  }

  if (loading && !data) {
    return <MembersSkeleton />;
  }

  const members = data?.members ?? [];
  const tiers = data?.tiers ?? [];
  const total = data?.total ?? 0;
  const grandTotal = data?.grandTotal ?? 0;
  const currentPage = data?.page ?? 1;
  const pageSize = data?.pageSize ?? 50;

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const startIdx = total === 0 ? 0 : (currentPage - 1) * pageSize + 1;
  const endIdx = Math.min(currentPage * pageSize, total);

  return (
    <div className="px-4 py-6 sm:px-6 lg:px-8 w-full">
      {/* Header */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-extrabold tracking-tight text-slate-900 font-sans">
            ສະມາຊິກລູກຄ້າ
          </h1>
          <p className="mt-1 text-sm text-slate-500 font-medium">
            ລາຍຊື່ລູກຄ້າທີ່ຖືກຕັ້ງເປັນສະມາຊິກ ແລະ ລະດັບ Loyalty ຂອງແຕ່ລະຄົນໃນລະບົບ
          </p>
        </div>
      </div>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <StatCard label="ສະມາຊິກທັງໝົດ" value={numFmt.format(grandTotal)} icon={UsersIcon} gradientColor="indigo" />
        <StatCard label="ປະເພດສະມາຊິກ" value={numFmt.format(tiers.length)} icon={TiersIcon} gradientColor="amber" />
        <StatCard label="ໜ້ານີ້" value={numFmt.format(members.length)} icon={PageIcon} gradientColor="sky" />
        <StatCard label="ກອງແລ້ວ" value={numFmt.format(total)} icon={FilterIcon} gradientColor="emerald" />
      </div>

      {/* Filter bar */}
      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center">
        <div className="flex-1">
          <div className="relative">
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="pointer-events-none absolute left-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m21 21-4.3-4.3" />
            </svg>
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="ຄົ້ນຫາ ຊື່ / ລະຫັດ / ເບີໂທ / ປະເພດສະມາຊິກ"
              className="w-full rounded-xl border-1.5 border-slate-200 bg-white py-2.5 pl-11 pr-10 text-sm font-medium text-slate-800 placeholder:text-slate-400 outline-none transition duration-200 focus:border-indigo-500 focus:ring-4 focus:ring-indigo-500/10 shadow-2xs"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 transition p-1 hover:bg-slate-100 rounded-full cursor-pointer"
              >
                <svg className="h-4.5 w-4.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <TierPill
            label="ທັງໝົດ"
            count={grandTotal}
            active={!tierParam || tierParam === "ALL"}
            onClick={() => pushParams({ tier: null, page: "1" })}
          />
          {tiers.map((t) => (
            <TierPill
              key={t.name}
              label={t.name}
              count={t.count}
              active={tierParam === t.name}
              onClick={() => pushParams({ tier: t.name, page: "1" })}
            />
          ))}
        </div>
      </div>

      {/* Results */}
      {total === 0 && !loading ? (
        <EmptyState />
      ) : (
        <>
          <div
            className={
              "odoo-card overflow-hidden transition-all duration-300 border border-slate-200 bg-white rounded-xl shadow-xs " +
              (isPending || loading ? "opacity-60" : "opacity-100")
            }
          >
            {/* Desktop table */}
            <div className="overflow-x-auto">
              <table className="hidden w-full text-sm md:table border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 bg-slate-50 text-left text-xs font-bold uppercase tracking-wider text-slate-500">
                    <th className="px-5 py-4">ລະຫັດ ID</th>
                    <th className="px-5 py-4">ຊື່ລູກຄ້າ</th>
                    <th className="px-5 py-4">ເບີໂທລະສັບ</th>
                    <th className="px-5 py-4">ປະເພດສະມາຊິກ</th>
                    <th className="px-5 py-4 text-right">ແຕ້ມສະສົມ</th>
                    <th className="px-5 py-4 text-right">ສ່ວນຫຼຸດ</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {members.map((m) => (
                    <tr
                      key={m.id}
                      className="hover:bg-slate-50/50 transition duration-150 group"
                    >
                      <td className="px-5 py-4">
                        <button
                          type="button"
                          onClick={() => handleCopy(m.id)}
                          className={`group/id inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1 font-mono text-xs font-semibold transition-all duration-200 active:scale-95 cursor-pointer ${
                            copiedId === m.id
                              ? "bg-emerald-50 text-emerald-700 border-emerald-300 shadow-2xs"
                              : "bg-slate-50 text-slate-700 border-slate-200 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 shadow-2xs"
                          }`}
                          title="ຄລິກເພື່ອສຳເນົາລະຫັດ"
                        >
                          {copiedId === m.id ? (
                            <>
                              <span>Copied!</span>
                              <svg className="h-3.5 w-3.5 text-emerald-600 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                              </svg>
                            </>
                          ) : (
                            <>
                              <span>{m.id}</span>
                              <svg className="h-3.5 w-3.5 opacity-0 group-hover/id:opacity-100 text-slate-400 transition-opacity" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                              </svg>
                            </>
                          )}
                        </button>
                      </td>
                      <td className="px-5 py-4">
                        <div className="flex flex-col">
                          <span className="font-bold text-slate-900 group-hover:text-indigo-600 transition-colors">
                            {m.name}
                          </span>
                          {m.address && (
                            <span className="mt-1 text-xs font-normal text-slate-500 leading-normal">
                              📍 {m.address}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="px-5 py-4 font-medium text-slate-800">
                        {m.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            📞 {m.phone}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4">
                        {m.groupName ? (
                          <TierBadge name={m.groupName} />
                        ) : (
                          <span className="text-slate-350 font-medium">—</span>
                        )}
                      </td>
                      <td className="px-5 py-4 text-right">
                        <span className="inline-flex items-center gap-1.5 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1 font-semibold text-amber-700 font-mono text-xs shadow-2xs hover:bg-amber-100 transition-colors">
                          <span className="text-amber-500 text-sm">★</span>
                          {numFmt.format(m.points)}
                        </span>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {m.discountPct > 0 ? (
                          <span className="inline-flex items-center gap-1 bg-emerald-50 border border-emerald-200 rounded-lg px-2.5 py-1 font-bold text-emerald-700 font-mono text-xs shadow-2xs hover:bg-emerald-100 transition-colors">
                            🏷️ {fmtDiscount(m.discountPct)}
                          </span>
                        ) : (
                          <span className="text-slate-300 font-mono">—</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Mobile list */}
            <ul className="divide-y divide-slate-100 md:hidden bg-white">
              {members.map((m) => (
                <li key={m.id} className="p-4 hover:bg-slate-50/50 transition">
                  <div className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-bold text-slate-900 text-sm truncate">
                          {m.name}
                        </div>
                        <div className="mt-2 flex flex-wrap gap-1.5 items-center">
                          <button
                            type="button"
                            onClick={() => handleCopy(m.id)}
                            className={`group/id inline-flex items-center gap-1.5 rounded-lg border px-2 py-0.5 font-mono text-[10px] font-semibold transition-all duration-200 active:scale-95 cursor-pointer ${
                              copiedId === m.id
                                ? "bg-emerald-50 text-emerald-700 border-emerald-300 shadow-2xs"
                                : "bg-slate-50 text-slate-700 border-slate-200 shadow-2xs"
                            }`}
                          >
                            {copiedId === m.id ? (
                              <>
                                <span>Copied!</span>
                                <svg className="h-3 w-3 text-emerald-600 animate-bounce" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="3">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                </svg>
                              </>
                            ) : (
                              <>
                                <span>{m.id}</span>
                                <svg className="h-3 w-3 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="2.5">
                                  <path strokeLinecap="round" strokeLinejoin="round" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2m0 0h2a2 2 0 012 2v3m2 4H10m0 0l3-3m-3 3l3 3" />
                                </svg>
                              </>
                            )}
                          </button>
                        </div>
                      </div>
                      <div className="flex flex-col items-end gap-1.5">
                        {m.groupName ? <TierBadge name={m.groupName} /> : null}
                      </div>
                    </div>

                    {m.address && (
                      <div className="text-xs text-slate-500 flex items-start gap-1">
                        <span className="shrink-0">📍</span>
                        <span className="break-words leading-relaxed">{m.address}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-between border-t border-slate-50 pt-3 text-xs">
                      <div className="text-slate-600 font-medium">
                        {m.phone ? (
                          <span className="inline-flex items-center gap-1.5">
                            📞 {m.phone}
                          </span>
                        ) : (
                          <span className="text-slate-350">—</span>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="inline-flex items-center gap-1 bg-amber-50 border border-amber-200 rounded-lg px-2 py-0.5 font-semibold text-amber-700 font-mono text-[10px] shadow-2xs">
                          ★ {numFmt.format(m.points)}
                        </span>
                        {m.discountPct > 0 && (
                          <span className="inline-flex items-center gap-0.5 bg-emerald-50 border border-emerald-200 rounded-lg px-2 py-0.5 font-bold text-emerald-700 font-mono text-[10px] shadow-2xs">
                            🏷️ {fmtDiscount(m.discountPct)}
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <Pagination
            total={total}
            startIdx={startIdx}
            endIdx={endIdx}
            page={currentPage}
            totalPages={totalPages}
            pageSize={pageSize}
            disabled={isPending || loading}
            onPageChange={(p) => pushParams({ page: String(p) })}
            onPageSizeChange={(s) =>
              pushParams({ pageSize: String(s), page: "1" })
            }
          />
        </>
      )}
    </div>
  );
}

function StatCard({
  label,
  value,
  icon,
  gradientColor,
}: {
  label: string;
  value: string;
  icon: React.ReactNode;
  gradientColor: "indigo" | "amber" | "sky" | "emerald";
}) {
  const gradientStyles = {
    indigo: "border-indigo-100 hover:border-indigo-300 hover:shadow-indigo-100/50 bg-gradient-to-br from-white to-indigo-50/20 text-indigo-600",
    amber: "border-amber-100 hover:border-amber-300 hover:shadow-amber-100/50 bg-gradient-to-br from-white to-amber-50/20 text-amber-600",
    sky: "border-sky-100 hover:border-sky-300 hover:shadow-sky-100/50 bg-gradient-to-br from-white to-sky-50/20 text-sky-600",
    emerald: "border-emerald-100 hover:border-emerald-300 hover:shadow-emerald-100/50 bg-gradient-to-br from-white to-emerald-50/20 text-emerald-600",
  };

  return (
    <div className={`odoo-card relative overflow-hidden px-5 py-4.5 transition-all duration-300 hover:-translate-y-1 hover:shadow-lg ${gradientStyles[gradientColor]}`}>
      <div className="absolute -right-4 -bottom-4 h-16 w-16 opacity-10 blur-xl rounded-full bg-current" />
      
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-xs font-bold uppercase tracking-wider text-slate-500">
            {label}
          </div>
          <div className="mt-2 text-2xl font-extrabold tracking-tight tabular-nums text-slate-900">
            {value}
          </div>
        </div>
        <div className="rounded-xl bg-slate-50 p-2.5 shadow-2xs border border-slate-100/50 shrink-0">
          {icon}
        </div>
      </div>
    </div>
  );
}

function TierPill({
  label,
  count,
  active,
  onClick,
}: {
  label: string;
  count: number;
  active: boolean;
  onClick: () => void;
}) {
  const lower = label.toLowerCase();
  
  let activeBg = "bg-indigo-600 text-white border-indigo-700 shadow-indigo-100 shadow-md";
  const activeBadge = "bg-white/20 text-white";
  
  if (active) {
    if (lower.includes("black")) {
      activeBg = "bg-slate-900 text-white border-slate-950 shadow-slate-200 shadow-md";
    } else if (lower.includes("gold")) {
      activeBg = "bg-amber-500 text-white border-amber-600 shadow-amber-100 shadow-md";
    } else if (lower.includes("platinum") || lower.includes("plat")) {
      activeBg = "bg-slate-600 text-white border-slate-700 shadow-slate-200 shadow-md";
    } else if (lower.includes("silver")) {
      activeBg = "bg-slate-400 text-white border-slate-500 shadow-slate-100 shadow-md";
    }
  }

  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? `inline-flex items-center gap-2 rounded-xl border px-4 py-2 text-xs font-extrabold transition-all duration-200 ${activeBg} cursor-pointer`
          : "inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2 text-xs font-bold text-slate-700 transition-all duration-200 hover:border-slate-350 hover:bg-slate-50 cursor-pointer shadow-2xs hover:shadow-xs active:scale-95"
      }
    >
      <span>{label}</span>
      <span
        className={
          active
            ? `rounded-lg ${activeBadge} px-2 py-0.5 text-[10px] font-extrabold tabular-nums`
            : "rounded-lg bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold tabular-nums text-slate-600"
        }
      >
        {numFmt.format(count)}
      </span>
    </button>
  );
}

function TierBadge({ name }: { name: string }) {
  const lower = name.toLowerCase();
  const cls = "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-bold shadow-2xs border transition duration-150 hover:brightness-105 select-none";
  
  if (lower.includes("black")) {
    return (
      <span className={`${cls} bg-gradient-to-r from-slate-900 via-slate-800 to-slate-950 text-white border-slate-750 shadow-md ring-1 ring-slate-800`}>
        💎 {name}
      </span>
    );
  } else if (lower.includes("platinum") || lower.includes("plat")) {
    return (
      <span className={`${cls} bg-gradient-to-r from-slate-200 via-slate-100 to-slate-300 text-slate-800 border-slate-300`}>
        💿 {name}
      </span>
    );
  } else if (lower.includes("gold")) {
    return (
      <span className={`${cls} bg-gradient-to-r from-amber-400 via-yellow-500 to-amber-500 text-white border-amber-300 shadow-2xs`}>
        👑 {name}
      </span>
    );
  } else if (lower.includes("silver")) {
    return (
      <span className={`${cls} bg-gradient-to-r from-slate-300 to-slate-400 text-slate-800 border-slate-200`}>
        ✨ {name}
      </span>
    );
  } else {
    return (
      <span className={`${cls} bg-gradient-to-r from-emerald-400 to-teal-500 text-white border-emerald-300 shadow-2xs`}>
        👤 {name}
      </span>
    );
  }
}

function EmptyState() {
  return (
    <div className="rounded-xl border border-dashed border-slate-300 bg-white px-6 py-20 text-center shadow-2xs">
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="mx-auto h-12 w-12 text-slate-400 animate-pulse"
      >
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
      <p className="mt-4 text-base font-extrabold text-slate-800">
        ບໍ່ພົບສະມາຊິກລູກຄ້າ
      </p>
      <p className="mt-1.5 text-xs font-medium text-slate-500">ລອງປ່ຽນຕົວກອງ ຫຼື ປ້ອນຄຳຄົ້ນຫາໃໝ່</p>
    </div>
  );
}

function Pagination({
  total,
  startIdx,
  endIdx,
  page,
  totalPages,
  pageSize,
  disabled,
  onPageChange,
  onPageSizeChange,
}: {
  total: number;
  startIdx: number;
  endIdx: number;
  page: number;
  totalPages: number;
  pageSize: number;
  disabled: boolean;
  onPageChange: (p: number) => void;
  onPageSizeChange: (s: number) => void;
}) {
  const pages = pageRange(page, totalPages);

  return (
    <div className="mt-6 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between border-t border-slate-100 pt-5">
      <div className="flex items-center gap-3 text-xs text-slate-600 font-medium">
        <span>
          ສະແດງ{" "}
          <span className="font-bold tabular-nums text-slate-900">
            {numFmt.format(startIdx)}–{numFmt.format(endIdx)}
          </span>{" "}
          ຈາກ{" "}
          <span className="font-bold tabular-nums text-slate-900">
            {numFmt.format(total)}
          </span>
        </span>
        <div className="flex items-center gap-2">
          <label
            htmlFor="page-size"
            className="hidden text-xs text-slate-500 sm:inline"
          >
            ຕໍ່ໜ້າ
          </label>
          <select
            id="page-size"
            value={pageSize}
            disabled={disabled}
            onChange={(e) => onPageSizeChange(Number(e.target.value))}
            className="rounded-xl border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold text-slate-700 outline-none transition focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 disabled:opacity-50 cursor-pointer shadow-2xs"
          >
            {PAGE_SIZE_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="flex items-center gap-1.5 justify-center sm:justify-end">
        <PageButton
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(1)}
          aria-label="ໜ້າທຳອິດ"
        >
          «
        </PageButton>
        <PageButton
          disabled={disabled || page <= 1}
          onClick={() => onPageChange(page - 1)}
          aria-label="ໜ້າກ່ອນ"
        >
          ‹
        </PageButton>
        {pages.map((p, i) =>
          p === "…" ? (
            <span
              key={`gap-${i}`}
              className="px-2 text-xs text-slate-400 select-none font-bold"
            >
              …
            </span>
          ) : (
            <PageButton
              key={p}
              active={p === page}
              disabled={disabled}
              onClick={() => onPageChange(p)}
              aria-label={`ໜ້າ ${p}`}
              aria-current={p === page ? "page" : undefined}
            >
              {p}
            </PageButton>
          ),
        )}
        <PageButton
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(page + 1)}
          aria-label="ໜ້າຕໍ່ໄປ"
        >
          ›
        </PageButton>
        <PageButton
          disabled={disabled || page >= totalPages}
          onClick={() => onPageChange(totalPages)}
          aria-label="ໜ້າສຸດທ້າຍ"
        >
          »
        </PageButton>
      </div>
    </div>
  );
}

function PageButton({
  children,
  active,
  disabled,
  onClick,
  ...rest
}: {
  children: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick?: () => void;
} & Omit<
  React.ButtonHTMLAttributes<HTMLButtonElement>,
  "children" | "onClick" | "disabled"
>) {
  const base =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-xl border text-xs font-bold tabular-nums transition-all duration-150 cursor-pointer";
  let cls: string;
  if (active) {
    cls = `${base} border-indigo-600 bg-indigo-600 text-white shadow-md shadow-indigo-100`;
  } else if (disabled) {
    cls = `${base} border-slate-100 bg-white text-slate-300 cursor-not-allowed`;
  } else {
    cls = `${base} border-slate-200 bg-white text-slate-700 hover:border-slate-350 hover:bg-slate-50 hover:text-slate-900 active:scale-95 shadow-2xs`;
  }
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cls}
      {...rest}
    >
      {children}
    </button>
  );
}

function pageRange(current: number, total: number): Array<number | "…"> {
  if (total <= 7) {
    return Array.from({ length: total }, (_, i) => i + 1);
  }
  const out: Array<number | "…"> = [1];
  const left = Math.max(2, current - 1);
  const right = Math.min(total - 1, current + 1);
  if (left > 2) out.push("…");
  for (let p = left; p <= right; p++) out.push(p);
  if (right < total - 1) out.push("…");
  out.push(total);
  return out;
}
