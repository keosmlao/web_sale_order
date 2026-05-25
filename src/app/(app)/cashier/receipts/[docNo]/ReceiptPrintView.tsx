import type { ReceiptDetail } from "@/lib/receipts";

const moneyFmt = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

function formatDate(d: Date | null): string {
  if (!d) return "—";
  try {
    return new Date(d).toLocaleString("lo-LA", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

// Render a single receipt in a paper-friendly layout. The page sets up the
// screen toolbar; this component is the actual receipt body and is what
// shows up in the printed output.
export default function ReceiptPrintView({
  receipt,
}: {
  receipt: ReceiptDetail;
}) {
  const r = receipt;
  return (
    <article className="receipt-sheet mx-auto max-w-3xl rounded border border-odoo-border bg-white px-8 py-8 shadow-sm print:max-w-none print:border-0 print:px-0 print:py-0 print:shadow-none">
      <header className="border-b-2 border-odoo-text-strong pb-4 text-center">
        <h1 className="text-2xl font-bold text-odoo-text-strong">
          ໃບຮັບເງິນ / RECEIPT
        </h1>
        <div className="mt-1 font-mono text-lg font-bold text-odoo-text-strong">
          {r.docNo}
        </div>
        {r.sourceSokDocNo ? (
          <div className="mt-0.5 text-xs text-odoo-text-muted">
            Sale Order: <span className="font-mono">{r.sourceSokDocNo}</span>
          </div>
        ) : null}
      </header>

      <section className="mt-4 grid grid-cols-2 gap-4 text-sm">
        <div>
          <Heading>ລູກຄ້າ</Heading>
          <Row label="ຊື່" value={r.customer.name ?? "—"} />
          <Row label="ເບີໂທ" value={r.customer.phone ?? "—"} />
          {r.customer.code ? (
            <Row label="ລະຫັດ" value={r.customer.code} mono />
          ) : null}
        </div>
        <div>
          <Heading>ເອກະສານ</Heading>
          <Row label="ວັນທີ" value={formatDate(r.createdAt)} />
          {r.cashier ? (
            <Row label="ພະນັກງານຮັບເງິນ" value={r.cashier.name} />
          ) : null}
          {r.salesperson ? (
            <Row label="ພະນັກງານຂາຍ" value={r.salesperson.name} />
          ) : null}
          {r.branchCode || r.departmentCode ? (
            <Row
              label="ສາຂາ / ໝວດ"
              value={
                [r.branchCode, r.departmentCode]
                  .filter(Boolean)
                  .join(" / ") || "—"
              }
            />
          ) : null}
        </div>
      </section>

      <section className="mt-6">
        <Heading>ລາຍການສິນຄ້າ</Heading>
        <table className="w-full text-sm">
          <thead className="border-b border-odoo-text-strong text-left text-xs uppercase text-odoo-text-muted">
            <tr>
              <th className="py-2 pr-2">#</th>
              <th className="py-2 pr-2">ສິນຄ້າ</th>
              <th className="py-2 pr-2 text-right">ຈຳນວນ</th>
              <th className="py-2 pr-2 text-right">ລາຄາ</th>
              <th className="py-2 pr-2 text-right">ສ່ວນຫຼຸດ</th>
              <th className="py-2 text-right">ລວມ</th>
            </tr>
          </thead>
          <tbody>
            {r.items.map((it) => (
              <tr key={it.lineNumber} className="border-b border-odoo-border">
                <td className="py-2 pr-2 text-odoo-text-muted">
                  {it.lineNumber + 1}
                </td>
                <td className="py-2 pr-2">
                  <div className="font-medium text-odoo-text-strong">
                    {it.itemName ?? it.itemCode}
                  </div>
                  <div className="font-mono text-[10px] text-odoo-text-muted">
                    {it.itemCode}
                  </div>
                </td>
                <td className="py-2 pr-2 text-right font-mono">
                  {moneyFmt.format(it.qty)}{" "}
                  <span className="text-xs text-odoo-text-muted">
                    {it.unitCode ?? ""}
                  </span>
                </td>
                <td className="py-2 pr-2 text-right font-mono">
                  {moneyFmt.format(it.priceKip)}
                </td>
                <td className="py-2 pr-2 text-right font-mono">
                  {it.discountAmountKip > 0 ? (
                    <>
                      −{moneyFmt.format(it.discountAmountKip)}
                      {it.discount ? (
                        <span className="ml-1 text-[10px] text-odoo-text-muted">
                          ({it.discount})
                        </span>
                      ) : null}
                    </>
                  ) : (
                    <span className="text-odoo-text-muted">—</span>
                  )}
                </td>
                <td className="py-2 text-right font-mono font-bold">
                  {moneyFmt.format(it.sumKip)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="mt-4 ml-auto w-full max-w-xs text-sm">
        {r.totals.billDiscountKip > 0 ? (
          <div className="flex items-center justify-between py-1 text-odoo-success">
            <span>
              ສ່ວນຫຼຸດທ້າຍບິນ
              {r.totals.billDiscountWordKip
                ? ` (${r.totals.billDiscountWordKip})`
                : ""}
            </span>
            <span className="font-mono">
              −{moneyFmt.format(r.totals.billDiscountKip)}
            </span>
          </div>
        ) : null}
        <div className="flex items-center justify-between border-t-2 border-odoo-text-strong py-2">
          <span className="font-bold">ລວມຍອດ</span>
          <span className="font-mono text-lg font-bold text-odoo-text-strong">
            {moneyFmt.format(r.totals.amountKip)} ກີບ
          </span>
        </div>
      </section>

      {r.payments.length > 0 ? (
        <section className="mt-6">
          <Heading>ການຮັບເງິນ</Heading>
          <table className="w-full text-sm">
            <thead className="text-left text-xs uppercase text-odoo-text-muted">
              <tr>
                <th className="py-1">ສະກຸນ</th>
                <th className="py-1">ປະເພດ</th>
                <th className="py-1 text-right">ຈຳນວນ</th>
                <th className="py-1 text-right">≈ ກີບ</th>
              </tr>
            </thead>
            <tbody>
              {r.payments.map((p) => (
                <tr key={p.id} className="border-b border-odoo-border">
                  <td className="py-1 font-mono">{p.currencyCode}</td>
                  <td className="py-1">
                    {p.payMethod === "cash" ? "ເງິນສົດ" : "ໂອນ"}
                  </td>
                  <td className="py-1 text-right font-mono">
                    {moneyFmt.format(p.amount)}
                  </td>
                  <td className="py-1 text-right font-mono text-odoo-text-muted">
                    {moneyFmt.format(p.amountInMain)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {r.cashSummary && r.cashSummary.changeThb > 0 && r.totals.exchangeRate > 0 ? (
            <div className="mt-2 flex items-center justify-end gap-3 text-sm">
              <span className="text-odoo-text-muted">ເງິນທອນ</span>
              <span className="font-mono font-bold text-odoo-success">
                {moneyFmt.format(
                  r.cashSummary.changeThb / r.totals.exchangeRate,
                )}{" "}
                ກີບ
              </span>
            </div>
          ) : null}
        </section>
      ) : null}

      {r.remark ? (
        <section className="mt-6">
          <Heading>ໝາຍເຫດ</Heading>
          <p className="whitespace-pre-wrap text-sm">{r.remark}</p>
        </section>
      ) : null}

      <footer className="mt-10 grid grid-cols-2 gap-8 text-center text-xs text-odoo-text-muted">
        <div>
          <div className="mb-12">ຜູ້ຮັບເງິນ</div>
          <div className="border-t border-odoo-text-strong pt-1">
            {r.cashier?.name ?? "—"}
          </div>
        </div>
        <div>
          <div className="mb-12">ລູກຄ້າ</div>
          <div className="border-t border-odoo-text-strong pt-1">
            {r.customer.name ?? "—"}
          </div>
        </div>
      </footer>
    </article>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return (
    <div className="mb-1 text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
      {children}
    </div>
  );
}

function Row({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex justify-between py-0.5 text-sm">
      <span className="text-odoo-text-muted">{label}</span>
      <span
        className={"text-odoo-text-strong" + (mono ? " font-mono" : "")}
      >
        {value}
      </span>
    </div>
  );
}
