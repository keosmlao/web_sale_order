import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import DeliveryTrackingClient from "./DeliveryTrackingClient";

export const dynamic = "force-dynamic";

export default async function DeliveryTrackingPage() {
  const me = await requireEmployee();
  const role = roleFromEmployee(me);
  const canSeeAll = role === "manager" || role === "head";
  return <DeliveryTrackingClient canSeeAll={canSeeAll} />;
}
