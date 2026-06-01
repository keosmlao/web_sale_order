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
        <label htmlFor="date" className="odoo-label">
          ເລືອກວັນທີ
        </label>
        <input
          id="date"
          name="date"
          type="date"
          defaultValue={selectedDate}
          min="2026-01-01"
          max="2026-12-31"
          className="odoo-input"
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
          "inline-flex items-center gap-1.5 pb-2 text-xs text-odoo-text-muted transition-opacity " +
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
