"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Same smooth-navigation idiom as the daily-sales DateFilter: picking a year
// re-renders the server component in place instead of reloading the page.
export default function YearFilter({
  year,
  years,
}: {
  year: number;
  years: number[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-end gap-2">
      <div>
        <label htmlFor="year" className="mb-1 block text-[10px] font-bold text-white/65">
          ປີ
        </label>
        <select
          id="year"
          className="h-10 min-w-28 rounded-lg border border-white/20 bg-white px-3 text-sm font-black text-odoo-primary-dark outline-none transition focus:border-odien-yellow focus:ring-2 focus:ring-odien-yellow/30"
          defaultValue={String(year)}
          onChange={(event) => {
            const value = event.target.value;
            startTransition(() => {
              router.replace(`/reports/total-company?year=${value}`, { scroll: false });
            });
          }}
        >
          {years.map((y) => (
            <option key={y} value={y}>
              {y}
            </option>
          ))}
        </select>
      </div>
      <span
        aria-live="polite"
        className={
          "inline-flex items-center gap-1.5 pb-2 text-xs text-white/75 transition-opacity " +
          (pending ? "opacity-100" : "opacity-0")
        }
      >
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle cx="12" cy="12" r="9" stroke="currentColor" strokeWidth="3" className="opacity-25" />
          <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        </svg>
        ກຳລັງໂຫຼດ…
      </span>
    </div>
  );
}
