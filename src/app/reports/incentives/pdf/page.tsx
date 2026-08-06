import { requireEmployee } from "@/lib/auth";
import PdfReport from "./PdfReport";

// "ໂບນັດພະນັກງານຂາຍ — ລາຍລະອຽດ": one section per salesperson with the point
// breakdown behind their bonus. The other PDF the branch asks for is simply the
// on-screen report printed as-is, which the report page handles itself.
//
// Deliberately outside the (app) route group: this becomes a PDF, so it renders
// on a bare page with no sidebar or nav to strip out at print time. Data comes
// from the same APIs the on-screen report uses, so the two cannot disagree.
export const dynamic = "force-dynamic";

export default async function IncentivesPdfPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string }>;
}) {
  // Gates the page and lets the API apply its own role scope — a salesperson
  // opening this URL still only gets their own row.
  await requireEmployee();
  const { period } = await searchParams;

  return <PdfReport period={period ?? ""} />;
}
