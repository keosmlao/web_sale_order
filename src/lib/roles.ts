// Sales-app permission roles. Effective role for a user is derived from
// odg_position.position_code, with odg_employee.app_role acting as an
// explicit per-user override when present.
//
// Mapping (matches odg_position):
//   11 → manager
//   12 → head
//   13 → salesperson
//
// app_role overrides the mapping. Set it to 'pc' for cashier-only data-entry
// users (no equivalent position_code), or any other value to promote/demote.
// NULL = no override → use position.
export type AppRole = "pc" | "salesperson" | "head" | "manager";

const VALID_ROLES: readonly AppRole[] = [
  "pc",
  "salesperson",
  "head",
  "manager",
] as const;

export function isValidRole(raw: unknown): raw is AppRole {
  return typeof raw === "string" &&
    (VALID_ROLES as readonly string[]).includes(raw);
}

// Used in a few legacy spots and the role-assignment endpoint where we know
// the caller already has a role string in hand. Prefer roleFromEmployee()
// for anything sourced from the DB.
export function normalizeRole(raw: string | null | undefined): AppRole {
  const v = (raw ?? "").trim().toLowerCase();
  if ((VALID_ROLES as readonly string[]).includes(v)) return v as AppRole;
  return "salesperson";
}

export function roleFromPositionCode(
  positionCode: string | null | undefined,
): AppRole {
  switch ((positionCode ?? "").trim()) {
    case "11":
      return "manager";
    case "12":
      return "head";
    case "13":
      return "salesperson";
    default:
      return "salesperson";
  }
}

// The single source of truth for "what role does this user have?". Always
// prefer this over reading app_role directly so the position-based derivation
// stays consistent.
export function roleFromEmployee(emp: {
  appRole: string | null | undefined;
  positionCode: string | null | undefined;
}): AppRole {
  if (emp.appRole && isValidRole(emp.appRole.trim())) {
    return emp.appRole.trim() as AppRole;
  }
  return roleFromPositionCode(emp.positionCode);
}

// Convenience predicates — call sites read more clearly than role checks.
export function canCancelOrders(role: AppRole): boolean {
  return role === "head" || role === "manager";
}

export function canCreateCustomers(role: AppRole): boolean {
  return role === "head" || role === "manager";
}

export function canAssignRoles(role: AppRole): boolean {
  return role === "head" || role === "manager";
}

// Price approval is intentionally stricter than cancel/assign — only manager.
// Head can cancel orders and create customers, but managers alone decide
// whether to release a special price.
export function canApprovePriceRequests(role: AppRole): boolean {
  return role === "manager";
}

// Picker on create-order shows salespeople, heads, and managers — anyone who
// can legitimately be credited for a sale. PC is data-entry only.
export function canBeSalesperson(role: AppRole): boolean {
  return role !== "pc";
}

// Promotions are a marketing-policy lever — only managers create/edit them.
// Head and salesperson roles can read promo definitions (for display) but not
// mutate them.
export function canManagePromotions(role: AppRole): boolean {
  return role === "manager";
}

// Stock-refill requests: approve/reject and mark-fulfilled are warehouse
// decisions that managers and heads share. Salespeople can create requests
// from the floor; PC has no business with stock.
// The owner's call: a refill request moves stock between warehouses, so it
// is the manager's decision alone. A head can raise one like anybody else,
// but not approve their own branch's.
export function canApproveRefillRequests(role: AppRole): boolean {
  return role === "manager";
}

// PC role is data-entry-only at the cashier and shouldn't be opening stock
// refill tickets either.
export function canCreateRefillRequests(role: AppRole): boolean {
  return role !== "pc";
}

// The mobile-device monitor (online status, location, battery, current
// screen of each salesperson's phone) is a supervisory view — heads and
// managers only. Salespeople must not see each other's whereabouts.
export function canMonitorDevices(role: AppRole): boolean {
  return role === "head" || role === "manager";
}

// Heads and managers run the floor and see everything (team + company-wide
// reports, management, settings). Everyone else (salesperson / pc) is confined
// to their own screens — see SELF_SERVE_HREFS / isSelfServePath below.
export function isPrivilegedRole(role: AppRole): boolean {
  return role === "head" || role === "manager";
}

// The only navigation targets a regular salesperson / PC is allowed to SEE and
// OPEN. Everything else under (app) is company-wide or management and is both
// hidden from their menu (Sidebar / BottomNav) and blocked at the route level
// (AppLayout redirects them back to Home). Heads / managers bypass this list.
//   /                    — personal dashboard (already self-scoped per role)
//   /orders/new          — POS, create their own bills
//   /cashier[/history]   — receive money at the register
//   /profile             — their own profile
//   /reports/my-sales    — their own sales
//   /reports/incentives  — their own bonus
export const SELF_SERVE_HREFS: readonly string[] = [
  "/",
  "/orders/new",
  "/cashier",
  "/cashier/history",
  "/profile",
  "/reports/my-sales",
  "/reports/incentives",
] as const;

// Path-level counterpart of SELF_SERVE_HREFS — tolerant of sub-paths
// (/cashier/receipts/123, /profile/edit, /orders/new/…). Used by AppLayout to
// gate direct-URL access for non-privileged roles.
export function isSelfServePath(pathname: string): boolean {
  if (pathname === "/") return true;
  if (pathname === "/orders/new" || pathname.startsWith("/orders/new/")) return true;
  if (pathname === "/cashier" || pathname.startsWith("/cashier/")) return true;
  if (pathname === "/profile" || pathname.startsWith("/profile/")) return true;
  if (pathname.startsWith("/reports/my-")) return true;
  if (pathname === "/reports/incentives") return true;
  return false;
}

// ── Selling and taking the money are different jobs ──────────────────
// The books already keep them apart: settle writes sale_code (who sold)
// and cashier_code (who took the money) as separate columns. Access did
// not — one person could ring a bill up and then receive payment on it
// themselves, so the two columns could name the same employee.
//
// A salesperson gets the POS and never the register; a 'pc' is the
// register and never the POS. Heads and managers are unaffected — they
// supervise both and need to be able to stand in at either.
// Which side of the counter is this user on? Derived ONLY from an explicit
// app_role, never from position_code. That matters: position_code defaults
// everyone to "salesperson", and enforcing the split on a default would shut
// the whole shop out of the register overnight. Until someone is explicitly
// marked, they keep the access they have today and nothing changes for them.
export type CounterSide = "pos" | "register";

export function counterSide(emp: {
  appRole: string | null | undefined;
}): CounterSide | null {
  const explicit = (emp.appRole ?? "").trim().toLowerCase();
  if (explicit === "pc") return "register";
  if (explicit === "salesperson") return "pos";
  return null;
}

const POS_PATHS = ["/orders/new"] as const;
const CASHIER_PATHS = ["/cashier"] as const;

function matchesAny(pathname: string, roots: readonly string[]): boolean {
  return roots.some(
    (root) => pathname === root || pathname.startsWith(root + "/"),
  );
}

// Where a role lands after login, and where it is sent back to when it asks
// for a screen that is not its job.
export function homePathForSide(side: CounterSide | null): string {
  if (side === "register") return "/cashier";
  if (side === "pos") return "/orders/new";
  return "/";
}

// Where a user lands is a different question from what they are barred
// from. Blocking stays keyed on an explicit app_role — deriving it would
// shut the shop out of the register (see counterSide). Landing does not
// take anything away, so it can fall back to the derived role: a
// salesperson opens on the POS whether or not anyone has marked them one.
export function landingPathFor(emp: {
  appRole: string | null | undefined;
  positionCode: string | null | undefined;
}): string {
  const side = counterSide(emp);
  if (side) return homePathForSide(side);
  // position_code 13 is the sales floor. Deliberately not
  // roleFromPositionCode(), which reads every unrecognised code as a
  // salesperson too — that would open the POS for the 37 people who have
  // no position on file, including office staff.
  if ((emp.positionCode ?? "").trim() === "13") return "/orders/new";
  return "/";
}

// The register is off-limits to the sales floor and the POS is off-limits to
// the register — but only once someone has actually been assigned a side.
export function isPathAllowedForSide(
  side: CounterSide | null,
  pathname: string,
): boolean {
  if (side === "pos" && matchesAny(pathname, CASHIER_PATHS)) return false;
  if (side === "register" && matchesAny(pathname, POS_PATHS)) return false;
  return true;
}

// Closing the till is part of working the register, so the daily takings
// report counts as one of that side's own screens. It stays off-limits to
// the sales floor, who have no business reading the shop's cash position.
const REGISTER_EXTRA_PATHS = ["/reports/daily-payments"] as const;

export function isSelfServeForSide(
  side: CounterSide | null,
  pathname: string,
): boolean {
  if (side === "register" && matchesAny(pathname, REGISTER_EXTRA_PATHS)) {
    return true;
  }
  return isSelfServePath(pathname);
}

// Menu counterpart — Sidebar / BottomNav filter their links through this so a
// link a user cannot open is never shown in the first place.
export function isHrefAllowedForSide(
  side: CounterSide | null,
  href: string,
): boolean {
  return isPathAllowedForSide(side, href);
}
