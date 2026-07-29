"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

// A small brand combobox: type to filter, click to pick from the system's
// brand list, or keep a custom value the list doesn't have yet. Used by the
// incentive reward editors so brands are chosen from real data, not free-typed.
//
// The dropdown is portaled to <body> with fixed positioning so the editor
// card's `overflow: hidden` can't clip it.
export default function BrandSelect({
  value,
  onChange,
  options,
  placeholder,
  wrapClassName = "w-32",
}: {
  value: string;
  onChange: (value: string) => void;
  options: string[];
  placeholder?: string;
  wrapClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (!open) return;
    const place = () => {
      const el = inputRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setRect({ top: r.bottom, left: r.left, width: r.width });
    };
    place();
    const onScroll = () => place();
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (inputRef.current?.contains(t) || listRef.current?.contains(t)) return;
      setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open]);

  const query = value.trim().toUpperCase();
  const filtered = options.filter((o) => o.includes(query)).slice(0, 50);

  return (
    <div className={`relative ${wrapClassName}`}>
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        onChange={(e) => {
          onChange(e.target.value.toUpperCase());
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        className="odoo-input w-full uppercase"
      />
      {open && rect && filtered.length > 0 && typeof document !== "undefined"
        ? createPortal(
            <ul
              ref={listRef}
              style={{ position: "fixed", top: rect.top + 4, left: rect.left, width: rect.width, zIndex: 60 }}
              className="max-h-48 overflow-auto rounded-md border border-odoo-border bg-white py-1 shadow-lg"
            >
              {filtered.map((o) => (
                <li key={o}>
                  <button
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      onChange(o);
                      setOpen(false);
                    }}
                    className="block w-full px-3 py-1.5 text-left text-sm text-odoo-text-strong hover:bg-odoo-surface-muted"
                  >
                    {o}
                  </button>
                </li>
              ))}
            </ul>,
            document.body,
          )
        : null}
    </div>
  );
}
