import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import StockMinimumClient from "./StockMinimumClient";

export const dynamic = "force-dynamic";

export default async function StockMinimumPage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const canManage = role === "manager" || role === "head";
  return <StockMinimumClient canManage={canManage} />;
}
