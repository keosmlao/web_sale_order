import { requireEmployee } from "@/lib/auth";
import PinClient from "./PinClient";

export const dynamic = "force-dynamic";

export default async function PosPinPage() {
  const employee = await requireEmployee();
  return <PinClient employeeName={employee.fullnameLo ?? employee.employeeCode ?? ""} />;
}
