import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { canMonitorDevices, roleFromEmployee } from "@/lib/roles";
import MonitorClient from "./MonitorClient";

export const dynamic = "force-dynamic";

export default async function MonitorPage() {
  const me = await requireEmployee();
  if (!canMonitorDevices(roleFromEmployee(me))) {
    redirect("/");
  }
  return <MonitorClient />;
}
