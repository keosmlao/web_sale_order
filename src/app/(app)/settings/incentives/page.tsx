import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import IncentiveConfigClient from "./IncentiveConfigClient";
import PointMapEditor from "./PointMapEditor";
import RewardsEditor from "./RewardsEditor";

export const dynamic = "force-dynamic";

export default async function IncentiveConfigPage() {
  const employee = await requireEmployee();
  const role = roleFromEmployee(employee);
  const canManage = role === "manager" || role === "head";
  return (
    <>
      <IncentiveConfigClient canManage={canManage} />
      <RewardsEditor canManage={canManage} />
      <PointMapEditor canManage={canManage} />
    </>
  );
}
