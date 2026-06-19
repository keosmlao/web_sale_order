import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import PaymentAccountsClient from "./PaymentAccountsClient";

export const dynamic = "force-dynamic";

export default async function PaymentAccountsPage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const canManage = role === "manager" || role === "head";
  return <PaymentAccountsClient canManage={canManage} />;
}
