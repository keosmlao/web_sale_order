import Link from "next/link";
import { notFound } from "next/navigation";
import { requireEmployee } from "@/lib/auth";
import { fetchReceipt } from "@/lib/receipts";
import AutoPrint from "./AutoPrint";
import PrintButton from "./PrintButton";
import ReceiptPrintView from "./ReceiptPrintView";
import VoidButton from "./VoidButton";

export const dynamic = "force-dynamic";

type Params = { docNo: string };

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Promise<Params>;
  searchParams: Promise<{ print?: string }>;
}) {
  await requireEmployee();
  const { docNo: rawDocNo } = await params;
  const { print } = await searchParams;
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
          {/* Voiding unwinds documents this app wrote. A receipt raised
              inside SML has none of them — it is corrected in SML. */}
          {receipt.origin === "pos" ? <VoidButton docNo={docNo} /> : null}
          <PrintButton />
        </div>
      </div>
      {/* ລາຍລະອຽດການຮັບເງິນ — screen only; the paper shows the bill. How
          the money actually arrived: each tender in its currency, then the
          paid/change summary. */}
      <div className="mx-auto mb-4 max-w-3xl px-6 print:hidden">
        <section className="rounded-xl border border-odoo-border bg-white p-4">
          <h2 className="text-sm font-black text-odoo-text-strong">
            ລາຍລະອຽດການຮັບເງິນ
          </h2>
          {receipt.payments.length > 0 ? (
            <ul className="mt-2 divide-y divide-odoo-border">
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
                    <b className="font-mono">
                      {new Intl.NumberFormat("en-US").format(pl.amount)}
                    </b>
                    {pl.currencyCode !== "02" ? (
                      <small className="block text-[11px] text-odoo-text-muted">
                        ≈ {new Intl.NumberFormat("en-US").format(pl.amountInMain)} ກີບ
                      </small>
                    ) : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : receipt.cashSummary ? (
            <ul className="mt-2 divide-y divide-odoo-border text-sm">
              {receipt.cashSummary.cashThb > 0 ? (
                <li className="flex items-baseline justify-between py-2">
                  <span className="font-semibold">ເງິນສົດ</span>
                  <b className="font-mono">
                    {new Intl.NumberFormat("en-US").format(
                      receipt.totals.exchangeRate > 0
                        ? Math.round(
                            receipt.cashSummary.cashThb /
                              receipt.totals.exchangeRate,
                          )
                        : receipt.cashSummary.cashThb,
                    )}{" "}
                    ກີບ
                  </b>
                </li>
              ) : null}
              {receipt.cashSummary.transferThb > 0 ? (
                <li className="flex items-baseline justify-between py-2">
                  <span className="font-semibold">ເງິນໂອນ</span>
                  <b className="font-mono">
                    {new Intl.NumberFormat("en-US").format(
                      receipt.totals.exchangeRate > 0
                        ? Math.round(
                            receipt.cashSummary.transferThb /
                              receipt.totals.exchangeRate,
                          )
                        : receipt.cashSummary.transferThb,
                    )}{" "}
                    ກີບ
                  </b>
                </li>
              ) : null}
            </ul>
          ) : (
            <p className="mt-2 text-sm text-odoo-text-muted">
              ບໍ່ມີລາຍລະອຽດການຊຳລະ
            </p>
          )}
          {receipt.cashSummary && receipt.cashSummary.changeThb > 0 ? (
            <div className="mt-2 flex items-baseline justify-between border-t border-odoo-border pt-2 text-sm">
              <span className="text-odoo-text-muted">ເງິນທອນ</span>
              <b className="font-mono text-odoo-danger">
                {new Intl.NumberFormat("en-US").format(
                  receipt.totals.exchangeRate > 0
                    ? Math.round(
                        receipt.cashSummary.changeThb /
                          receipt.totals.exchangeRate,
                      )
                    : receipt.cashSummary.changeThb,
                )}{" "}
                ກີບ
              </b>
            </div>
          ) : null}
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-odoo-border pt-2 text-[12px] text-odoo-text-muted">
            {receipt.cashier ? <span>ຮັບເງິນ: {receipt.cashier.name}</span> : null}
            {receipt.salesperson ? (
              <span>ຂາຍ: {receipt.salesperson.name}</span>
            ) : null}
            {receipt.slips.length > 0 ? (
              <span>ສະລິບ {receipt.slips.length} ໃບ</span>
            ) : null}
          </div>
        </section>
      </div>
      <ReceiptPrintView receipt={receipt} />
      {print === "1" ? <AutoPrint /> : null}
    </div>
  );
}
