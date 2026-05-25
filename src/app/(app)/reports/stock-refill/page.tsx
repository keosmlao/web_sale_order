import { requireEmployee } from "@/lib/auth";
import {
  canApproveRefillRequests,
  canCreateRefillRequests,
  roleFromEmployee,
} from "@/lib/roles";
import StockRefillClient from "./StockRefillClient";

export const dynamic = "force-dynamic";

export default async function StockRefillReportPage() {
  const employee = await requireEmployee();
  const role = roleFromEmployee(employee);
  return (
    <StockRefillClient
      canApprove={canApproveRefillRequests(role)}
      canCreate={canCreateRefillRequests(role)}
    />
  );
}
