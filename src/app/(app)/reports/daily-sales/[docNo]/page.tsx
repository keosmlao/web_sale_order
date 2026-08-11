import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

type Header = {
  doc_no: string;
  doc_date: Date | string;
  doc_time: string | null;
  cust_code: string | null;
  customer_name: string | null;
  customer_phone: string | null;
  sale_code: string | null;
  salesperson_name: string | null;
  salesperson_nickname: string | null;
  branch_code: string | null;
  branch_name: string | null;
  department_code: string | null;
  department_name: string | null;
  division_code: string | null;
  division_name: string | null;
  currency_code: string | null;
  exchange_rate: string | number | null;
  total_amount: string | number | null;
  total_amount_2: string | number | null;
  total_discount: string | number | null;
  total_discount_2: string | number | null;
  total_before_vat: string | number | null;
  total_vat_value: string | number | null;
  cancel_type: number | null;
  remark: string | null;
};

type Item = {
  line_number: number | null;
  item_code: string | null;
  item_name: string | null;
  unit_code: string | null;
  qty: string | number | null;
  price_2: string | number | null;
  discount: string | null;
  discount_amount: string | number | null;
  sum_amount_2: string | number | null;
  sum_amount: string | number | null;
};

const currencyMeta: Record<string, { code: string; name: string }> = {
  "01": { code: "THB", name: "ບາດ" },
  "02": { code: "KIP", name: "ກີບ" },
  "03": { code: "USD", name: "ໂດລາ" },
};

const numberValue = (value: string | number | null | undefined) => Number(value ?? 0) || 0;
const normalizeCurrency = (value: string | null) => (value ?? "").trim().padStart(2, "0");
const money = (value: string | number | null, digits = 2) =>
  numberValue(value).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });

export default async function DailySaleDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ docNo: string }>;
  searchParams: Promise<{ date?: string }>;
}) {
  const { docNo: rawDocNo } = await params;
  const { date } = await searchParams;
  const docNo = decodeURIComponent(rawDocNo).trim();
  if (!/^(CAK|INK)[A-Z0-9-]+$/i.test(docNo)) notFound();

  const headers = await prisma.$queryRaw<Header[]>`
    SELECT
      t.doc_no, t.doc_date, t.doc_time, t.cust_code,
      c.name_1 AS customer_name, c.telephone AS customer_phone,
      t.sale_code, e.fullname_lo AS salesperson_name,
      e.nickname AS salesperson_nickname,
      NULLIF(t.branch_code, '') AS branch_code,
      b.name_1 AS branch_name,
      NULLIF(t.department_code, '') AS department_code,
      d.name_1 AS department_name,
      NULLIF(e.division_code, '') AS division_code,
      v.division_name_lo AS division_name,
      t.currency_code, t.exchange_rate,
      t.total_amount, t.total_amount_2,
      t.total_discount, t.total_discount_2,
      t.total_before_vat, t.total_vat_value,
      t.cancel_type, t.remark
    FROM ic_trans t
    LEFT JOIN ar_customer c ON c.code = t.cust_code
    LEFT JOIN odg_employee e ON e.employee_code = t.sale_code
    LEFT JOIN erp_branch_list b ON b.code = NULLIF(t.branch_code, '')
    LEFT JOIN erp_department_list d ON d.code = NULLIF(t.department_code, '')
    LEFT JOIN odg_division v ON v.division_code = NULLIF(e.division_code, '')
    WHERE t.doc_no = ${docNo}
      AND t.trans_flag = 44
      AND (t.doc_no LIKE 'CAK%' OR t.doc_no LIKE 'INK%')
    LIMIT 1
  `;
  const header = headers[0];
  if (!header) notFound();

  const items = await prisma.$queryRaw<Item[]>`
    SELECT line_number, item_code, item_name, unit_code, qty,
           price_2, discount, discount_amount, sum_amount_2, sum_amount
    FROM ic_trans_detail
    WHERE doc_no = ${docNo}
      AND trans_type = 2
    ORDER BY line_number, roworder
  `;

  const currency = normalizeCurrency(header.currency_code);
  const meta = currencyMeta[currency] ?? { code: currency || "—", name: "ບໍ່ລະບຸ" };
  const nativeDigits = currency === "02" ? 0 : 2;
  const docDateIso = header.doc_date instanceof Date
    ? header.doc_date.toISOString().slice(0, 10)
    : String(header.doc_date).slice(0, 10);
  const backDate = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : docDateIso;
  const salesperson =
    (header.salesperson_nickname && header.salesperson_nickname !== "0" ? header.salesperson_nickname : null) ??
    header.salesperson_name ?? header.sale_code ?? "—";
  const cancelled = (header.cancel_type ?? 0) !== 0;

  return (
    <div className="odoo-page max-w-6xl">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <Link href={`/reports/daily-sales?date=${backDate}`} className="odoo-btn odoo-btn-secondary">
          ← ກັບໄປລາຍງານປະຈຳວັນ
        </Link>
        <span className={cancelled ? "odoo-pill odoo-pill-danger" : "odoo-pill odoo-pill-success"}>
          {cancelled ? "ຍົກເລີກ" : "ບິນປົກກະຕິ"}
        </span>
      </div>

      <section className="overflow-hidden rounded-2xl bg-gradient-to-br from-odoo-primary-dark via-odoo-primary to-odoo-primary-light p-5 text-white shadow-[0_18px_45px_-20px_rgba(0,51,97,0.55)] sm:p-6">
        <div className="text-[10px] font-black tracking-[0.18em] text-white/60">SALE DOCUMENT</div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black tracking-tight sm:text-3xl">{header.doc_no}</h1>
            <p className="mt-1 text-sm font-semibold text-white/70">{docDateIso} · {header.doc_time ?? "—"}</p>
          </div>
          <div className="text-right">
            <div className="text-[10px] font-bold text-white/60">ຍອດສຸດທິ</div>
            <div className="mt-1 text-3xl font-black">{money(header.total_amount_2, nativeDigits)} <span className="text-sm text-odien-yellow">{meta.code}</span></div>
            <div className="text-xs font-semibold text-white/65">≈ {money(header.total_amount)} ບາດ</div>
          </div>
        </div>
      </section>

      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <InfoCard label="ລູກຄ້າ" value={header.customer_name?.trim() || "ບໍ່ມີຊື່"} sub={[header.cust_code, header.customer_phone].filter(Boolean).join(" · ") || "—"} />
        <InfoCard label="ພະນັກງານຂາຍ" value={salesperson} sub={header.sale_code ?? "—"} />
        <InfoCard label="ສະກຸນເງິນ" value={`${meta.name} (${meta.code})`} sub={`ອັດຕາແລກປ່ຽນ ${numberValue(header.exchange_rate).toLocaleString("en-US", { maximumFractionDigits: 7 })}`} />
      </div>

      <section className="mt-4 overflow-hidden rounded-2xl border border-odoo-primary-100 bg-white shadow-sm">
        <div className="flex items-center gap-2 border-b border-odoo-primary-100 bg-odoo-primary-50 px-4 py-3">
          <span className="h-2 w-2 rounded-full bg-odoo-primary-light" aria-hidden />
          <h2 className="text-xs font-black text-odoo-primary-dark">ໂຄງສ້າງອົງກອນຂອງບິນ</h2>
        </div>
        <div className="grid gap-px bg-odoo-border md:grid-cols-3">
          <OrgInfo label="ສາຂາ" code={header.branch_code} name={header.branch_name} />
          <OrgInfo label="ຝ່າຍ" code={header.division_code} name={header.division_name} />
          <OrgInfo label="ພະແນກ" code={header.department_code} name={header.department_name} />
        </div>
      </section>

      <section className="odoo-card mt-5 overflow-hidden">
        <div className="flex items-center justify-between border-b border-odoo-border px-4 py-3">
          <h2 className="text-sm font-black text-odoo-text-strong">ລາຍການສິນຄ້າ</h2>
          <span className="rounded-full bg-odoo-primary-50 px-2.5 py-1 text-[11px] font-black text-odoo-primary">{items.length} ລາຍການ</span>
        </div>
        <div className="overflow-x-auto">
          <table className="odoo-table min-w-[760px]">
            <thead><tr><th>#</th><th>ລະຫັດ/ສິນຄ້າ</th><th className="text-right">ຈຳນວນ</th><th className="text-right">ລາຄາ/{meta.code}</th><th>ສ່ວນຫຼຸດ</th><th className="text-right">ລວມ/{meta.code}</th><th className="text-right">≈ ບາດ</th></tr></thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={`${item.line_number ?? index}-${item.item_code ?? "item"}`}>
                  <td className="text-odoo-text-muted">{index + 1}</td>
                  <td><div className="font-bold text-odoo-text-strong">{item.item_name || "—"}</div><div className="text-[11px] text-odoo-text-muted">{item.item_code || "—"}</div></td>
                  <td className="text-right font-bold">{money(item.qty, 2)} {item.unit_code ?? ""}</td>
                  <td className="text-right">{money(item.price_2, nativeDigits)}</td>
                  <td>{item.discount?.trim() || (numberValue(item.discount_amount) > 0 ? money(item.discount_amount) : "—")}</td>
                  <td className="text-right font-black text-odoo-text-strong">{money(item.sum_amount_2, nativeDigits)}</td>
                  <td className="text-right font-black text-odoo-primary">{money(item.sum_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <InfoCard label="ຍອດກ່ອນ VAT" value={`${money(header.total_before_vat)} ບາດ`} />
        <InfoCard label="VAT" value={`${money(header.total_vat_value)} ບາດ`} />
        <InfoCard label="ສ່ວນຫຼຸດ" value={`${money(header.total_discount_2, nativeDigits)} ${meta.code}`} />
        <InfoCard label="ຍອດສຸດທິ" value={`${money(header.total_amount_2, nativeDigits)} ${meta.code}`} sub={`≈ ${money(header.total_amount)} ບາດ`} accent />
      </section>

      {header.remark?.trim() ? <div className="odoo-card mt-4 p-4 text-sm"><b className="text-odoo-text-strong">ໝາຍເຫດ:</b> {header.remark}</div> : null}
    </div>
  );
}

function InfoCard({ label, value, sub, accent = false }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className={"odoo-card p-4 " + (accent ? "border-odoo-primary bg-odoo-primary-50" : "")}>
      <div className="text-[10px] font-bold text-odoo-text-muted">{label}</div>
      <div className="mt-1 text-base font-black text-odoo-text-strong">{value}</div>
      {sub ? <div className="mt-1 text-[11px] font-semibold text-odoo-text-muted">{sub}</div> : null}
    </div>
  );
}

function OrgInfo({ label, code, name }: { label: string; code: string | null; name: string | null }) {
  return (
    <div className="bg-white p-4">
      <div className="text-[10px] font-black uppercase tracking-wider text-odoo-text-muted">{label}</div>
      <div className="mt-1 text-sm font-black text-odoo-text-strong">{name?.trim() || "ບໍ່ພົບຊື່ໃນ master data"}</div>
      <div className="mt-1 inline-flex rounded-md bg-odoo-primary-50 px-2 py-0.5 text-[11px] font-bold text-odoo-primary">ລະຫັດ {code?.trim() || "—"}</div>
    </div>
  );
}
