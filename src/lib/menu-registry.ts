// Serializable registry of sidebar menu items — the shared source of truth
// for the menu-visibility settings page. Keys MUST match the `href` (or group
// id) used by the sidebar in src/components/Sidebar.tsx so a hidden key here
// filters the matching sidebar entry.
//
// Icons/labels still live in the sidebar; this registry only needs a stable
// key + a human label + the section it belongs to, so the settings grid can
// render a toggle per (item × role).

import type { AppRole } from "@/lib/roles";

export const CONFIGURABLE_ROLES: readonly AppRole[] = [
  "pc",
  "salesperson",
  "head",
  "manager",
] as const;

export const ROLE_LABELS: Record<AppRole, string> = {
  pc: "PC (ແຄຊເຊຍ)",
  salesperson: "ພະນັກງານຂາຍ",
  head: "ຫົວໜ້າ",
  manager: "ຜູ້ຈັດການ",
};

export type MenuRegistryItem = {
  /** Stable key = sidebar href. */
  key: string;
  /** Lao label, mirrors the sidebar. */
  label: string;
  /** Section heading for grouping in the settings grid. */
  section: string;
};

// Mirrors the sidebar `sections` array. Keep in sync when menu items change.
// The menu-visibility page itself is intentionally excluded so a manager can
// never hide their own way back into this screen.
export const MENU_REGISTRY: MenuRegistryItem[] = [
  { key: "/", label: "ໜ້າຫຼັກ", section: "Dashboard" },

  { key: "/reports/daily-sales", label: "ຍອດຂາຍປະຈຳວັນ", section: "Reports" },
  { key: "/reports/cashiers", label: "Cashier performance", section: "Reports" },
  { key: "/reports/promo-effectiveness", label: "ປະສິດທິພາບໂປຣ", section: "Reports" },
  { key: "/reports/daily-payments", label: "ສະຫຼຸບການຮັບເງິນ", section: "Reports" },
  { key: "/reports/salespeople", label: "ຍອດຂາຍຕາມພະນັກງານ", section: "Reports" },
  { key: "/reports/items", label: "ສິນຄ້າຂາຍດີ", section: "Reports" },
  { key: "/reports/stock-refill", label: "ຂໍເຕີມສະຕ້ອກ", section: "Reports" },

  { key: "/delivery-tracking", label: "ຕິດຕາມຂົນສົ່ງ", section: "Operations" },
  { key: "/inventory", label: "ສິນຄ້າຄົງເຫຼືອ", section: "Operations" },
  { key: "/cashier", label: "ຮັບເງິນ", section: "Operations" },
  { key: "/cashier/history", label: "ປະຫວັດການຂາຍ", section: "Operations" },
  { key: "/orders/new", label: "POS", section: "Operations" },
  { key: "/price-tags", label: "ປ້າຍລາຄາ", section: "Operations" },

  { key: "/members", label: "ສະມາຊິກລູກຄ້າ", section: "Management" },
  { key: "/employees", label: "ຈັດການພະນັກງານ", section: "Management" },
  { key: "/monitor", label: "ຕິດຕາມມືຖື sale", section: "Management" },
  { key: "/settings/sales-warehouses", label: "ສາງຂາຍ", section: "Management · ການຕັ້ງຄ່າ" },
  { key: "/settings/stock-minimum", label: "Minimum Stock", section: "Management · ການຕັ້ງຄ່າ" },
  { key: "/settings/barcodes", label: "Barcode ສິນຄ້າ", section: "Management · ການຕັ້ງຄ່າ" },
  { key: "/settings/payment-accounts", label: "ບັນຊີຮັບເງິນ", section: "Management · ການຕັ້ງຄ່າ" },
  { key: "/promotions", label: "ໂປຣໂມຊັນ", section: "Management · ການຕັ້ງຄ່າ" },
  { key: "/loyalty", label: "ສະສົມແຕ້ມ", section: "Management · ການຕັ້ງຄ່າ" },
];

export const MENU_REGISTRY_KEYS = new Set(MENU_REGISTRY.map((m) => m.key));
