"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

// Smooth date switch: picking a date does a client-side navigation (no full
// page reload, scroll preserved) and shows a pending spinner while the server
// component re-renders. Replaces the old GET <form> + "ສະແດງ" button.
export default function DateFilter({ selectedDate }: { selectedDate: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <div className="flex items-end gap-2">
      <div>
        <label htmlFor="date" className="mb-1 block text-[10px] font-bold text-white/70">
          ເລືອກວັນທີ
        </label>
        <input
          id="date"
          name="date"
          type="date"
          defaultValue={selectedDate}
          className="h-10 rounded-lg border border-white/20 bg-white px-3 text-sm font-bold text-odoo-primary-dark outline-none transition focus:border-odien-yellow focus:ring-2 focus:ring-odien-yellow/30"
          onChange={(e) => {
            const v = e.target.value;
            if (!v) return;
            startTransition(() => {
              router.replace(`/reports/daily-sales?date=${v}`, {
                scroll: false,
              });
            });
          }}
        />
      </div>
      <span
        aria-live="polite"
        className={
          "inline-flex items-center gap-1.5 pb-2 text-xs text-white/75 transition-opacity " +
          (pending ? "opacity-100" : "opacity-0")
        }
      >
        <svg className="h-3.5 w-3.5 animate-spin" viewBox="0 0 24 24" fill="none">
          <circle
            cx="12"
            cy="12"
            r="9"
            stroke="currentColor"
            strokeWidth="3"
            className="opacity-25"
          />
          <path
            d="M21 12a9 9 0 0 0-9-9"
            stroke="currentColor"
            strokeWidth="3"
            strokeLinecap="round"
          />
        </svg>
        ກຳລັງໂຫຼດ…
      </span>
    </div>
  );
}
