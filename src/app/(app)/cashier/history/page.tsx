import { requireEmployee } from "@/lib/auth";
import HistoryClient from "./HistoryClient";

export const dynamic = "force-dynamic";

export default async function CashierHistoryPage() {
  await requireEmployee();
  return <HistoryClient />;
}
