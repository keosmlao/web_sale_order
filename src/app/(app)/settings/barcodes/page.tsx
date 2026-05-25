import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import BarcodesClient from "./BarcodesClient";

export const dynamic = "force-dynamic";

export default async function BarcodesSettingsPage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const canManage = role === "manager" || role === "head";
  return <BarcodesClient canManage={canManage} />;
}
