import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { isPrivilegedRole, roleFromEmployee } from "@/lib/roles";
import SpecialRewardsClient from "./SpecialRewardsClient";

export const dynamic = "force-dynamic";
export const metadata = { title: "ຈັດການລາງວັນພິເສດ" };

// Reward programs decide real payouts, so the screen is heads / managers only —
// the same bar /api/incentives/rewards enforces on write.
export default async function SpecialRewardsPage() {
  const me = await requireEmployee();
  if (!isPrivilegedRole(roleFromEmployee(me))) redirect("/");
  return <SpecialRewardsClient />;
}
