import { redirect } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { roleFromEmployee } from "@/lib/roles";
import MenuVisibilityClient from "./MenuVisibilityClient";

export const dynamic = "force-dynamic";

export default async function MenuVisibilityPage() {
  const me = await requireEmployee();
  // Manager-only screen. Anyone else is bounced to the dashboard.
  if (roleFromEmployee(me) !== "manager") redirect("/");
  return <MenuVisibilityClient />;
}
