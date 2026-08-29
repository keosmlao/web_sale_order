import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { fetchReceipt } from "@/lib/receipts";
import { prisma } from "@/lib/prisma";
import AutoPrint from "./AutoPrint";
import PrintButton from "./PrintButton";
import ReceiptPrintView from "./ReceiptPrintView";
import ReturnButton from "./ReturnButton";
import VoidButton from "./VoidButton";

export const dynamic = "force-dynamic";

type Params = { docNo: string };

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ print?: string; view?: string }>;
}) {
  const me = await requireEmployee();
  const { docNo: rawDocNo } = await params;
  const { print, view } = await searchParams;
  const docNo = decodeURIComponent(rawDocNo).trim();
  if (!docNo) notFound();

  const receipt = await fetchReceipt(docNo);
  if (!receipt) notFound();

  // Opened to print (?print=1): log it, and stamp everything after the
  // first print as a copy. The table heals itself on an un-migrated
  // database, same pattern as the delete log.
  let isCopy = false;
  if (print === "1") {
    await prisma.$executeRaw`
      CREATE TABLE IF NOT EXISTS app_receipt_print_log (
        id            BIGSERIAL PRIMARY KEY,
        doc_no        VARCHAR(50) NOT NULL,
        printed_by    VARCHAR(20),
        printed_at    TIMESTAMP   NOT NULL DEFAULT NOW()
      )
    `;
    const prior = await prisma.$queryRaw<Array<{ n: bigint }>>`
      SELECT COUNT(*)::bigint AS n FROM app_receipt_print_log
      WHERE doc_no = ${docNo}
    `;
    isCopy = Number(prior[0]?.n ?? 0) > 0;
    await prisma.$executeRaw`
      INSERT INTO app_receipt_print_log (doc_no, printed_by)
      VALUES (${docNo}, ${me.employeeCode ?? ""})
    `;
  }

  const fmt = new Intl.NumberFormat("en-US");
  const toKip = (thb: number) =>
    receipt.totals.exchangeRate > 0
      ? Math.round(thb / receipt.totals.exchangeRate)
      : thb;

  // ລາຍລະອຽດການຮັບເງິນ — its own screen, not the bill. The bill is what
  // the printer gets; this is what a person checking the money gets:
  // who paid what, in which currency, through which method, with the
  // slips to look at.
  if (view === "pay") {
    return (
      <div className="mx-auto max-w-2xl px-4 py-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <Link href="/cashier/history" className="odoo-btn odoo-btn-secondary">
            ← ກັບຄືນ
          </Link>
          <Link
            href={`/cashier/receipts/${encodeURIComponent(docNo)}?print=1`}
            className="odoo-btn odoo-btn-secondary"
          >
            ພິມບິນ
          </Link>
        </div>

        <section className="rounded-xl border border-odoo-border bg-white p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h1 className="font-mono text-lg font-black text-odoo-text-strong">
              {receipt.docNo}
            </h1>
            <b className="font-mono text-xl font-black text-odoo-primary">
              {fmt.format(receipt.totals.amountKip)} ກີບ
            </b>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-odoo-text-muted">
            {receipt.createdAt ? (
              <span>{new Date(receipt.createdAt).toLocaleString()}</span>
            ) : null}
            {receipt.customer.name ? <span>{receipt.customer.name}</span> : null}
            {receipt.customer.phone ? (
              <span>{receipt.customer.phone}</span>
            ) : null}
          </div>

          <h2 className="mt-4 text-sm font-black text-odoo-text-strong">
            ການຊຳລະ
          </h2>
          {receipt.payments.length > 0 ? (
            <ul className="mt-1 divide-y divide-odoo-border">
              {receipt.payments.map((pl) => (
                <li
                  key={pl.id}
                  className="flex items-baseline justify-between py-2 text-sm"
                >
                  <span className="font-semibold">
                    {pl.payMethod === "cash"
                      ? "ເງິນສົດ"
                      : pl.payMethod === "transfer"
                        ? "ເງິນໂອນ"
                        : pl.payMethod}
                    {" · "}
                    {pl.currencyCode === "02"
                      ? "ກີບ"
                      : pl.currencyCode === "01"
                        ? "ບາດ"
                        : pl.currencyCode}
                  </span>
                  <span className="text-right">
                    <b className="font-mono">{fmt.format(pl.amount)}</b>
                    {pl.currencyCode !== "02" ? (
                      <small className="block text-[11px] text-odoo-text-muted">
                        ≈ {fmt.format(pl.amountInMain)} ກີບ
                      </small>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : receipt.cashSummary ? (
            <ul className="mt-1 divide-y divide-odoo-border text-sm">
              {receipt.cashSummary.cashThb > 0 ? (
                <li className="flex items-baseline justify-between py-2">
                  <span className="font-semibold">ເງິນສົດ</span>
                  <b className="font-mono">
                    {fmt.format(toKip(receipt.cashSummary.cashThb))} ກີບ
                  </b>
                </li>
              ) : null}
              {receipt.cashSummary.transferThb > 0 ? (
                <li className="flex items-baseline justify-between py-2">
                  <span className="font-semibold">ເງິນໂອນ</span>
                  <b className="font-mono">
                    {fmt.format(toKip(receipt.cashSummary.transferThb))} ກີບ
                  </b>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-1 text-sm text-odoo-text-muted">
              ບໍ່ມີລາຍລະອຽດການຊຳລະ
            </p>
          )}
          {receipt.cashSummary && receipt.cashSummary.changeThb > 0 ? (
            <div className="mt-1 flex items-baseline justify-between border-t border-odoo-border pt-2 text-sm">
              <span className="text-odoo-text-muted">ເງິນທອນ</span>
              <b className="font-mono text-odoo-danger">
                {fmt.format(toKip(receipt.cashSummary.changeThb))} ກີບ
              </b>
            </div>
          ) : null}

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 border-t border-odoo-border pt-2 text-[12px] text-odoo-text-muted">
            {receipt.cashier ? (
              <span>ຮັບເງິນ: {receipt.cashier.name}</span>
            ) : null}
            {receipt.salesperson ? (
              <span>ຂາຍ: {receipt.salesperson.name}</span>
            ) : null}
          </div>
        </section>

        {receipt.slips.length > 0 ? (
          <section className="mt-3 rounded-xl border border-odoo-border bg-white p-4">
            <h2 className="text-sm font-black text-odoo-text-strong">
              ສະລິບການໂອນ ({receipt.slips.length})
            </h2>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {receipt.slips.map((slip) => (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  key={slip.id}
                  src={`/api/cashier/transfer-slips/${slip.id}`}
                  alt={slip.fileName ?? "ສະລິບ"}
                  className="w-full rounded-lg border border-odoo-border object-contain"
                />
              ))}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  return (
    <div className="bg-odoo-surface-muted py-6 print:bg-white print:py-0">
      {/* The toolbar is screen-only; the global @media print rules hide it
          so the paper output starts directly with the receipt body. */}
      <div className="mx-auto mb-4 flex max-w-3xl items-center justify-between gap-3 px-6 print:hidden">
        <Link href="/cashier" className="odoo-btn odoo-btn-secondary">
          ← ກັບໄປໜ້າຮັບເງິນ
        </Link>
        <div className="flex items-center gap-2">
          {/* Voiding unwinds documents this app wrote. A receipt raised
              inside SML has none of them — it is corrected in SML. */}
          {receipt.origin === "pos" ? (
            <>
              <ReturnButton
                docNo={docNo}
                items={receipt.items.map((it) => ({
                  lineNumber: it.lineNumber,
                  itemCode: it.itemCode,
                  itemName: it.itemName,
                  qty: it.qty,
                  priceKip: it.priceKip,
                }))}
              />
              <VoidButton docNo={docNo} />
            </>
          ) : null}
          <PrintButton />
        </div>
      </div>
      <ReceiptPrintView receipt={receipt} isCopy={isCopy} />
      {print === "1" ? <AutoPrint /> : null}
    </div>
  );
}
