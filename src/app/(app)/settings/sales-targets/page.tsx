import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { isPrivilegedRole, roleFromEmployee } from "@/lib/roles";
import SalesTargetsClient from "./SalesTargetsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "ຈັດການເປົ້າຂາຍ" };

// Every bonus and special reward is paid against the numbers entered here, so
// the screen is heads / managers only — the same bar /api/incentives/targets
// and /api/incentives/rewards enforce on write. AppLayout already blocks
// non-privileged roles from this path; the redirect keeps the rule beside the
// page it protects.
export default async function SalesTargetsPage() {
  const me = await requireEmployee();
  if (!isPrivilegedRole(roleFromEmployee(me))) redirect("/");
  return <SalesTargetsClient />;
}
