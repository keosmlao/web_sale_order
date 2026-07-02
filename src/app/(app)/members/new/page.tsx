import { Suspense } from "react";
import { requireEmployee } from "@/lib/auth";
import NewMemberClient from "./NewMemberClient";

export const dynamic = "force-dynamic";

export default async function NewMemberPage() {
  await requireEmployee();
  return (
    <Suspense fallback={null}>
      <NewMemberClient />
    </Suspense>
  );
}
