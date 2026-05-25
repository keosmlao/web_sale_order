import { Prisma } from "@/generated/prisma/client";
import { prisma } from "@/lib/prisma";

export const dynamic ="force-dynamic";

//"ພະແນກຂາຍໜ້າຮ້ານ ຂົວຫຼວງ" — front-shop sales depts at Khua Luang branch.
// Excludes 2042 (ຂາຍໜ້າຮ້ານອາໄຫຼ່) per requirement.
const INCLUDED_DEPTS: ReadonlyArray<{ code: string; name: string }> = [
 { code:"2012", name:"ຂາຍໜ້າຮ້ານເຄື່ອງໃຊ້ໄຟຟ້າ" },
 { code:"2022", name:"ຂາຍໜ້າຮ້ານແອ" },
 { code:"2032", name:"ຂາຍໜ້າຮ້ານປະປາ" },
 { code:"2062", name:"ຂາຍໜ້າຮ້ານໄຟຟ້າຂະໜາດນ້ອຍ" },
];
const INCLUDED_DEPT_CODES = INCLUDED_DEPTS.map((d) => d.code);

// JSON-derived numeric values come back as `number` (Postgres json serialization of numeric).
// For sale totals well under 2^53 this is safe; we never compute on them, only display.
type Num = number | string | null;

type DailyTotals = {
 doc_count: Num;
 cak_count: Num;
 ink_count: Num;
 cak_total: Num;
 ink_total: Num;
 total: Num;
 total_before_vat: Num;
 total_vat: Num;
};

type CurrencyTotal = {
 currency_code: string | null;
 doc_count: Num;
 total_baht: Num;
 total_native: Num;
};

type SalespersonTotal = {
 sale_code: string | null;
 fullname_lo: string | null;
 nickname: string | null;
 doc_count: Num;
 total_baht: Num;
};

type Row = {
 doc_no: string;
 doc_time: string | null;
 doc_date: string;
 cust_code: string | null;
 cust_name: string | null;
 sale_code: string | null;
 sale_fullname: string | null;
 sale_nickname: string | null;
 currency_code: string | null;
 exchange_rate: Num;
 total_amount: Num;
 total_amount_2: Num;
 total_before_vat: Num;
 total_vat_value: Num;
 cancel_type: number | null;
 remark: string | null;
};

type ReportResult = {
 totals: DailyTotals | null;
 currencies: CurrencyTotal[] | null;
 salespeople: SalespersonTotal[] | null;
 detail_rows: Row[] | null;
};

const TODAY_ISO = (() => {
 // Compute"today" in Asia/Vientiane (UTC+7) so the default day matches operator local time.
 const now = new Date();
 const local = new Date(now.getTime() + 7 * 60 * 60 * 1000);
 return local.toISOString().slice(0, 10);
})();

// Normalize"2" →"02", trim, etc.
const normalizeCurrency = (raw: string | null | undefined): string => {
 const v = (raw ??"").trim();
 if (!v) return"";
 if (/^\d$/.test(v)) return `0${v}`;
 return v;
};

const CURRENCY_META: Record<string, { name: string; code: string }> = {
"01": { name:"ບາດ", code:"THB" },
"02": { name:"ກີບ", code:"KIP" },
"03": { name:"ໂດລາ", code:"USD" },
};

const currencyShort = (raw: string | null | undefined) => {
 const norm = normalizeCurrency(raw);
 return CURRENCY_META[norm]?.code ?? norm ??"—";
};

const toNum = (v: Num | Prisma.Decimal | bigint | undefined): number => {
 if (v == null) return 0;
 if (typeof v ==="number") return v;
 if (typeof v ==="bigint") return Number(v);
 if (typeof v ==="string") return Number(v) || 0;
 // Prisma.Decimal-like
 return Number(v.toString()) || 0;
};

const fmtMoney = (v: Num | Prisma.Decimal | undefined, digits = 2) => {
 return toNum(v).toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
};

const fmtInt = (v: Num | bigint | undefined) =>
 toNum(v).toLocaleString("en-US");

function isValidDate(s: string): boolean {
 return /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(new Date(s).getTime());
}

export default async function DailySalesReportPage({
 searchParams,
}: {
 searchParams: Promise<{ date?: string }>;
}) {
 const params = await searchParams;
 const selectedDate = params.date && isValidDate(params.date) ? params.date : TODAY_ISO;
 const deptList = Prisma.join(INCLUDED_DEPT_CODES);

 // Single round-trip: scan ic_trans once, derive all aggregates and detail rows from the same
 // base set. Cuts 4 sequential scans down to 1. (Pre-PG12 materializes CTEs by default; PG12+
 // may inline, which is fine since the base set is referenced cheaply by index.)
 const result = await prisma.$queryRaw<ReportResult[]>`
 WITH base AS (
 SELECT
 t.doc_no, t.doc_time, t.doc_date,
 t.cust_code, t.sale_code,
 t.currency_code, t.exchange_rate,
 t.total_amount, t.total_amount_2,
 t.total_before_vat, t.total_vat_value,
 t.cancel_type, t.remark
 FROM ic_trans t
 WHERE t.trans_flag = 44
 AND (t.doc_no LIKE'CAK%' OR t.doc_no LIKE'INK%')
 AND t.doc_date = ${selectedDate}::date
 AND t.department_code IN (${deptList})
 ),
 totals AS (
 SELECT
 COUNT(*) AS doc_count,
 COUNT(*) FILTER (WHERE doc_no LIKE'CAK%') AS cak_count,
 COUNT(*) FILTER (WHERE doc_no LIKE'INK%') AS ink_count,
 COALESCE(SUM(total_amount) FILTER (WHERE doc_no LIKE'CAK%'), 0) AS cak_total,
 COALESCE(SUM(total_amount) FILTER (WHERE doc_no LIKE'INK%'), 0) AS ink_total,
 COALESCE(SUM(total_amount), 0) AS total,
 COALESCE(SUM(total_before_vat), 0) AS total_before_vat,
 COALESCE(SUM(total_vat_value), 0) AS total_vat
 FROM base
 ),
 currencies AS (
 SELECT
 LPAD(NULLIF(TRIM(currency_code),''), 2,'0') AS currency_code,
 COUNT(*) AS doc_count,
 COALESCE(SUM(total_amount), 0) AS total_baht,
 COALESCE(SUM(total_amount_2), 0) AS total_native
 FROM base
 GROUP BY LPAD(NULLIF(TRIM(currency_code),''), 2,'0')
 ORDER BY total_baht DESC
 ),
 salespeople AS (
 SELECT
 b.sale_code,
 e.fullname_lo,
 e.nickname,
 COUNT(*) AS doc_count,
 COALESCE(SUM(b.total_amount), 0) AS total_baht
 FROM base b
 LEFT JOIN odg_employee e ON e.employee_code = b.sale_code
 GROUP BY b.sale_code, e.fullname_lo, e.nickname
 ORDER BY total_baht DESC
 ),
 detail_rows AS (
 SELECT
 b.doc_no, b.doc_time, b.doc_date,
 b.cust_code,
 c.name_1 AS cust_name,
 b.sale_code,
 e.fullname_lo AS sale_fullname,
 e.nickname AS sale_nickname,
 b.currency_code, b.exchange_rate,
 b.total_amount, b.total_amount_2,
 b.total_before_vat, b.total_vat_value,
 b.cancel_type, b.remark
 FROM base b
 LEFT JOIN odg_employee e ON e.employee_code = b.sale_code
 LEFT JOIN ar_customer c ON c.code = b.cust_code
 ORDER BY b.doc_time NULLS LAST, b.doc_no
 )
 SELECT
 (SELECT row_to_json(t) FROM totals t) AS totals,
 (SELECT json_agg(c) FROM currencies c) AS currencies,
 (SELECT json_agg(s) FROM salespeople s) AS salespeople,
 (SELECT json_agg(d) FROM detail_rows d) AS detail_rows
 `;

 const payload = result[0] ?? { totals: null, currencies: null, salespeople: null, detail_rows: null };
 const totals: DailyTotals = payload.totals ?? {
 doc_count: 0,
 cak_count: 0,
 ink_count: 0,
 cak_total: 0,
 ink_total: 0,
 total: 0,
 total_before_vat: 0,
 total_vat: 0,
 };
 const currencyRows: CurrencyTotal[] = payload.currencies ?? [];
 const salesRows: SalespersonTotal[] = payload.salespeople ?? [];
 const rows: Row[] = payload.detail_rows ?? [];

 return (
 <div className="odoo-page">
 <div className="odoo-card mb-4 p-5">
 <div className="flex flex-wrap items-end justify-between gap-4">
 <div>
 <div className="odoo-label">
 ລາຍງານຍອດຂາຍປະຈຳວັນ
 </div>
 <h1 className="odoo-page-title mt-2">
 ລາຍງານຍອດຂາຍປະຈຳວັນ
 </h1>
 <p className="mt-1 text-sm text-odoo-text">
 ພະແນກຂາຍໜ້າຮ້ານ ຂົວຫຼວງ · ປີ 2026
 </p>
 <div className="mt-2 flex flex-wrap gap-1.5">
 {INCLUDED_DEPTS.map((d) => (
 <span
 key={d.code}
 className="inline-flex items-center gap-1.5 rounded-md bg-odoo-surface-muted px-2.5 py-1 text-xs text-odoo-text-strong"
 >
 <span className="font-mono text-[10px] text-odoo-text-muted">{d.code}</span>
 {d.name}
 </span>
 ))}
 </div>
 </div>
 <form action="/reports/daily-sales" method="get" className="flex items-end gap-2">
 <div>
 <label htmlFor="date" className="odoo-label">
 ເລືອກວັນທີ
 </label>
 <input
 id="date"
 name="date"
 type="date"
 defaultValue={selectedDate}
 min="2026-01-01"
 max="2026-12-31"
 className="odoo-input"
 />
 </div>
 <button
 type="submit"
 className="odoo-btn odoo-btn-primary"
 >
 ສະແດງ
 </button>
 </form>
 </div>
 </div>

 <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
 <StatCard label="ຈຳນວນເອກະສານ" value={fmtInt(totals.doc_count)} sub={`CAK ${fmtInt(totals.cak_count)} · INK ${fmtInt(totals.ink_count)}`} />
 <StatCard label="ຍອດຂາຍລວມ (ບາດ)" value={fmtMoney(totals.total)} accent />
 <StatCard label="ຍອດ CAK (ບາດ)" value={fmtMoney(totals.cak_total)} />
 <StatCard label="ຍອດ INK (ບາດ)" value={fmtMoney(totals.ink_total)} />
 </div>

 <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
 <StatCard label="ຍອດກ່ອນອາກອນ (ບາດ)" value={fmtMoney(totals.total_before_vat)} muted />
 <StatCard label="ອາກອນມູນຄ່າເພີ່ມ (ບາດ)" value={fmtMoney(totals.total_vat)} muted />
 </div>

 <div className="odoo-card mt-6 overflow-hidden">
 <div className="border-b border-odoo-border px-4 py-3">
 <h2 className="text-sm font-semibold text-odoo-text-strong">ຍອດຕາມສະກຸນເງິນ</h2>
 </div>
 {currencyRows.length === 0 ? (
 <div className="px-4 py-8 text-center text-sm text-odoo-text-muted">—</div>
 ) : (
 <div className="overflow-x-auto">
 <table className="odoo-table">
 <thead>
 <tr>
 <th className="px-4 py-2.5 font-medium">ສະກຸນເງິນ</th>
 <th className="px-4 py-2.5 text-right font-medium">ຈຳນວນເອກະສານ</th>
 <th className="px-4 py-2.5 text-right font-medium">ຍອດຕາມສະກຸນ</th>
 <th className="px-4 py-2.5 text-right font-medium">≈ ບາດ</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-odoo-border">
 {currencyRows.map((row) => {
 const norm = normalizeCurrency(row.currency_code);
 const meta = CURRENCY_META[norm];
 const isKip = norm ==="02";
 return (
 <tr key={norm ||"?"} className="text-odoo-text-strong">
 <td className="px-4 py-2.5">
 <div className="font-medium">{meta?.name ??"—"}</div>
 <div className="text-xs text-odoo-text-muted">{meta?.code ?? norm ??"?"}</div>
 </td>
 <td className="px-4 py-2.5 text-right font-mono">{fmtInt(row.doc_count)}</td>
 <td className="px-4 py-2.5 text-right font-mono">{fmtMoney(row.total_native, isKip ? 0 : 2)}</td>
 <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtMoney(row.total_baht)}</td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </div>

 <div className="odoo-card mt-6 overflow-hidden">
 <div className="border-b border-odoo-border px-4 py-3">
 <h2 className="text-sm font-semibold text-odoo-text-strong">
 ຍອດຕາມພະນັກງານຂາຍ ({fmtInt(salesRows.length)} ຄົນ)
 </h2>
 </div>
 {salesRows.length === 0 ? (
 <div className="px-4 py-8 text-center text-sm text-odoo-text-muted">—</div>
 ) : (
 <div className="overflow-x-auto">
 <table className="odoo-table">
 <thead>
 <tr>
 <th className="px-4 py-2.5 font-medium">ລະຫັດ</th>
 <th className="px-4 py-2.5 font-medium">ຊື່</th>
 <th className="px-4 py-2.5 font-medium">ຫຼິ້ນຊື່</th>
 <th className="px-4 py-2.5 text-right font-medium">ຈຳນວນເອກະສານ</th>
 <th className="px-4 py-2.5 text-right font-medium">ຍອດຂາຍ (ບາດ)</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-odoo-border">
 {salesRows.map((s) => {
 const unmatched = !s.fullname_lo;
 return (
 <tr key={s.sale_code ??"?"} className={unmatched ? "text-odoo-text-muted" : "text-odoo-text-strong"}>
 <td className="px-4 py-2.5 font-mono text-xs">{s.sale_code ??"—"}</td>
 <td className="px-4 py-2.5">
 {s.fullname_lo ?? <span className="text-xs italic text-odoo-text-soft">ບໍ່ພົບໃນລະບົບ</span>}
 </td>
 <td className="px-4 py-2.5 text-odoo-text-muted">
 {s.nickname && s.nickname !=="0" ? s.nickname :"—"}
 </td>
 <td className="px-4 py-2.5 text-right font-mono">{fmtInt(s.doc_count)}</td>
 <td className="px-4 py-2.5 text-right font-mono font-semibold">{fmtMoney(s.total_baht)}</td>
 </tr>
 );
 })}
 </tbody>
 </table>
 </div>
 )}
 </div>

 <div className="odoo-card mt-6 overflow-hidden">
 <div className="border-b border-odoo-border px-4 py-3">
 <h2 className="text-sm font-semibold text-odoo-text-strong">
 ລາຍລະອຽດ ({fmtInt(rows.length)} ລາຍການ)
 </h2>
 </div>
 <div className="overflow-x-auto">
 <table className="odoo-table">
 <thead>
 <tr>
 <th className="px-4 py-2.5 font-medium">ເລກທີເອກະສານ</th>
 <th className="px-4 py-2.5 font-medium">ເວລາ</th>
 <th className="px-4 py-2.5 font-medium">ລູກຄ້າ</th>
 <th className="px-4 py-2.5 font-medium">ພະນັກງານຂາຍ</th>
 <th className="px-4 py-2.5 font-medium">ສະກຸນ</th>
 <th className="px-4 py-2.5 text-right font-medium">ຈຳນວນ (ສະກຸນ)</th>
 <th className="px-4 py-2.5 text-right font-medium">ຮັບແລກ</th>
 <th className="px-4 py-2.5 text-right font-medium">≈ ບາດ</th>
 <th className="px-4 py-2.5 font-medium">ສະຖານະ</th>
 </tr>
 </thead>
 <tbody className="divide-y divide-odoo-border">
 {rows.length === 0 ? (
 <tr>
 <td colSpan={9} className="px-4 py-12 text-center text-sm text-odoo-text-muted">
 ບໍ່ມີຂໍ້ມູນສຳລັບວັນທີນີ້
 </td>
 </tr>
 ) : (
 rows.map((r) => {
 const cancelled = (r.cancel_type ?? 0) !== 0;
 const norm = normalizeCurrency(r.currency_code);
 const isKip = norm ==="02";
 const saleDisplay = r.sale_nickname && r.sale_nickname !=="0"
 ? r.sale_nickname
 : r.sale_fullname || r.sale_code ||"—";
 return (
 <tr key={r.doc_no} className={cancelled ? "bg-odoo-surface-muted text-odoo-text-soft line-through" : "text-odoo-text-strong"}>
 <td className="px-4 py-2 font-mono text-xs">{r.doc_no}</td>
 <td className="px-4 py-2 text-odoo-text-muted">{r.doc_time ??"—"}</td>
 <td className="px-4 py-2">
 <div>
 {r.cust_name?.trim() || (
 <span className="italic text-odoo-text-soft">ບໍ່ມີຊື່</span>
 )}
 </div>
 <div className="font-mono text-xs text-odoo-text-muted">
 {r.cust_code ??"—"}
 </div>
 </td>
 <td className="px-4 py-2">
 <div>{saleDisplay}</div>
 {r.sale_code && r.sale_code !== saleDisplay && (
 <div className="font-mono text-xs text-odoo-text-muted">{r.sale_code}</div>
 )}
 </td>
 <td className="px-4 py-2">
 <span className="inline-flex rounded-md bg-odoo-surface-muted px-1.5 py-0.5 text-xs font-medium text-odoo-text-strong">
 {currencyShort(r.currency_code)}
 </span>
 </td>
 <td className="px-4 py-2 text-right font-mono">{fmtMoney(r.total_amount_2, isKip ? 0 : 2)}</td>
 <td className="px-4 py-2 text-right font-mono text-xs text-odoo-text-muted">
 {r.exchange_rate != null && r.exchange_rate !== 0 && r.exchange_rate !=="0"
 ? toNum(r.exchange_rate).toLocaleString("en-US", { maximumFractionDigits: 7 })
 :"—"}
 </td>
 <td className="px-4 py-2 text-right font-mono font-semibold">{fmtMoney(r.total_amount)}</td>
 <td className="px-4 py-2">
 {cancelled ? (
 <span className="odoo-pill odoo-pill-danger">
 ຍົກເລີກ
 </span>
 ) : (
 <span className="odoo-pill odoo-pill-success">
 ປົກກະຕິ
 </span>
 )}
 </td>
 </tr>
 );
 })
 )}
 </tbody>
 </table>
 </div>
 </div>
 </div>
 );
}

function StatCard({
 label,
 value,
 sub,
 accent,
 muted,
}: {
 label: string;
 value: string;
 sub?: string;
 accent?: boolean;
 muted?: boolean;
}) {
 return (
 <div
 className={
"odoo-card p-5" +
 (accent
 ?" border-odoo-primary bg-odoo-primary text-white"
 : muted
 ?" bg-odoo-surface-muted"
 :"")
 }
 >
 <div className={"text-xs font-medium " + (accent ? "text-white/80" : "text-odoo-text-muted")}>
 {label}
 </div>
 <div className="mt-2 font-mono text-2xl font-semibold">{value}</div>
 {sub && (
 <div className={"mt-1 text-xs " + (accent ? "text-white/80" : "text-odoo-text-muted")}>
 {sub}
 </div>
 )}
 </div>
 );
}
