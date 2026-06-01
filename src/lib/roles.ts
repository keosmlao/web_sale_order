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
export function canApproveRefillRequests(role: AppRole): boolean {
  return role === "head" || role === "manager";
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
