import { requireEmployee } from "@/lib/auth";
import PriceTagsClient from "./PriceTagsClient";

export const dynamic = "force-dynamic";

export default async function PriceTagsPage() {
  await requireEmployee();
  return <PriceTagsClient />;
}
