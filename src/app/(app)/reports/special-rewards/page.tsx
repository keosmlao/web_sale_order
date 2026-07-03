import { requireEmployee } from "@/lib/auth";
import SpecialRewardsClient from "./SpecialRewardsClient";

export const dynamic = "force-dynamic";

export default async function SpecialRewardsPage() {
  await requireEmployee();
  return <SpecialRewardsClient />;
}
