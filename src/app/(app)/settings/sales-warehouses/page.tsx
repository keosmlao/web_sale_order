import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import SalesWarehousesClient from "./SalesWarehousesClient";

export const dynamic = "force-dynamic";

export default async function SalesWarehousesPage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const canManage = role === "manager" || role === "head";
  return <SalesWarehousesClient canManage={canManage} />;
}
