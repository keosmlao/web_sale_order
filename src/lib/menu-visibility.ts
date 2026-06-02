// Server helpers for per-role sidebar menu visibility (table: app_menu_visibility).
//
// Opt-out model: a (menu_key, role) row means that item is HIDDEN for that
// role. No row = visible. Reads are wrapped in try/catch so the app keeps
// working (everything visible) even before the SQL migration is applied.

import { cache } from "react";
import { prisma } from "@/lib/prisma";
import type { AppRole } from "@/lib/roles";
import { MENU_REGISTRY_KEYS } from "@/lib/menu-registry";

type Row = { menu_key: string; role: string };

// Keys hidden for a single role — used by the app layout to filter the sidebar.
export const getHiddenMenuKeys = cache(async (role: AppRole): Promise<string[]> => {
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT menu_key FROM app_menu_visibility WHERE role = ${role}
    `;
    return rows.map((r) => r.menu_key);
  } catch {
    // Table not present yet (migration not applied) → hide nothing.
    return [];
  }
});

// Full hidden map { role: keys[] } — used by the settings page/API.
export async function getHiddenMenuMap(): Promise<Record<string, string[]>> {
  const map: Record<string, string[]> = {};
  try {
    const rows = await prisma.$queryRaw<Row[]>`
      SELECT menu_key, role FROM app_menu_visibility
    `;
    for (const r of rows) {
      // Ignore stale keys that no longer exist in the registry.
      if (!MENU_REGISTRY_KEYS.has(r.menu_key)) continue;
      (map[r.role] ??= []).push(r.menu_key);
    }
  } catch {
    /* table missing → empty map (all visible) */
  }
  return map;
}
