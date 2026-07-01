import { requireEmployee } from "@/lib/auth";
import MySalesClient from "./MySalesClient";

export const dynamic = "force-dynamic";

export default async function MySalesPage() {
  await requireEmployee();
  return <MySalesClient />;
}
