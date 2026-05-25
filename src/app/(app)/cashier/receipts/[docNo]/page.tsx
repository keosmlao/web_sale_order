import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { fetchReceipt } from "@/lib/receipts";
import PrintButton from "./PrintButton";
import ReceiptPrintView from "./ReceiptPrintView";
import VoidButton from "./VoidButton";

export const dynamic = "force-dynamic";

type Params = { docNo: string };

export default async function ReceiptPage({
  params,
}: {
  params: Promise<Params>;
}) {
  await requireEmployee();
  const { docNo: rawDocNo } = await params;
  const docNo = decodeURIComponent(rawDocNo).trim();
  if (!docNo) notFound();

  const receipt = await fetchReceipt(docNo);
  if (!receipt) notFound();

  return (
    <div className="bg-odoo-surface-muted py-6 print:bg-white print:py-0">
      {/* The toolbar is screen-only; the global @media print rules hide it
          so the paper output starts directly with the receipt body. */}
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 px-6 print:hidden">
        <Link href="/cashier" className="odoo-btn odoo-btn-secondary">
          ← ກັບໄປໜ້າຮັບເງິນ
        </Link>
        <div className="flex items-center gap-2">
          <VoidButton docNo={docNo} />
          <PrintButton />
        </div>
      </div>
      <ReceiptPrintView receipt={receipt} />
    </div>
  );
}
