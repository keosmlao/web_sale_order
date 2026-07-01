import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import IncentiveSettingsClient from "./IncentiveSettingsClient";

export const dynamic = "force-dynamic";

export default async function IncentiveConfigPage() {
  const employee = await requireEmployee();
  const role = roleFromEmployee(employee);
  const canManage = role === "manager" || role === "head";
  return <IncentiveSettingsClient canManage={canManage} />;
}
