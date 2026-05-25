import { requireEmployee } from "@/lib/auth";
import PromoEffectivenessClient from "./PromoEffectivenessClient";

export const dynamic = "force-dynamic";

export default async function PromoEffectivenessPage() {
  await requireEmployee();
  return <PromoEffectivenessClient />;
}
