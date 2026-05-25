import { requireEmployee } from "@/lib/auth";
import CashiersClient from "./CashiersClient";

export const dynamic = "force-dynamic";

export default async function CashiersReportPage() {
  await requireEmployee();
  return <CashiersClient />;
}
