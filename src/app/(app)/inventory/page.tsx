import { requireEmployee } from "@/lib/auth";
import InventoryClient from "./InventoryClient";

export const dynamic = "force-dynamic";

export default async function InventoryPage() {
  await requireEmployee();
  return <InventoryClient />;
}
