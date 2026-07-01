import { requireEmployee } from "@/lib/auth";
import IncentivesClient from "./IncentivesClient";

export const dynamic = "force-dynamic";

export default async function IncentivesPage() {
  await requireEmployee();
  return <IncentivesClient />;
}
