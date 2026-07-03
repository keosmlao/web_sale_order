"use client";

type MobileReloadButtonProps = {
  className?: string;
};

export default function MobileReloadButton({ className = "" }: MobileReloadButtonProps) {
  return (
    <button
      type="button"
      onClick={() => window.location.reload()}
      aria-label="ໂຫຼດໜ້າໃໝ່"
      className={`flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-bold text-odoo-text-muted transition-colors hover:text-odoo-primary active:text-odoo-primary ${className}`}
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.9"
        strokeLinecap="round"
        strokeLinejoin="round"
        className="h-6 w-6"
        aria-hidden="true"
      >
        <path d="M20 6v5h-5" />
        <path d="M18.5 15a7 7 0 1 1-.7-7.8L20 11" />
      </svg>
      ໂຫຼດໃໝ່
    </button>
  );
}
