import type { ReceiptDetail } from "@/lib/receipts";
import { encodeCode128B } from "@/lib/barcode128";

// ---------------------------------------------------------------------------
// Shop constants — transcribed from the printed ODIEN Mall invoice.
// ⚠️ PLEASE PROOFREAD the Lao spelling / address / account numbers / terms;
// these were read off a photo and may need small corrections.
// ---------------------------------------------------------------------------
const SHOP = {
  nameLo: "ຮ້ານ ໂອດຽນມໍ",
  branchLo: "ສາຂາ ຂົວທ່າງ່ອນ",
  addressLo: "ບ. ໂພນສະຫວ່າງ ມ. ຈັນທະບູລີ ນະຄອນຫຼວງວຽງຈັນ",
  tel: "Tel: (+856-21) 216060, 217225, 412663, 412659",
  email: "info@odien.net",
  service: "02077799899",
};

const BANK_ACCOUNTS = [
  { no: "010-11-00-00101487-001", cur: "KIP" },
  { no: "010-11-02-00101487-001", cur: "BATH" },
  { no: "010-12-01-00101487-001", cur: "USD" },
];

const TERMS: string[] = [
  "ຊື້ສິນຄ້າໄປແລ້ວທາງຮ້ານບໍ່ສາມາດປ່ຽນຄືນສິນຄ້າ ຫຼື ເງິນຄືນໄດ້ : ຮັບປະກັນຄຸນນະພາບ ☐2ປີ ☐1ປີ ☐3ເດືອນ ☐1ເດືອນ (ເລີ່ມແຕ່ມື້ຊື້ສິນຄ້າເປັນຕົ້ນໄປ)",
  "ຮັບປະກັນປ່ຽນຄືນສິນຄ້າ ພາຍໃນ 7 ວັນ ຖ້າສິນຄ້າເປເພອນສາເຫດບົກພ່ອງຈາກໂຮງງານ; ກໍລະນີທີ່ລູກຄ້າໄປແຕະຕ້ອງເອງຈາກການຮັບປະກັນສ້ອມມາກ່ອນ ຖ້າເປັນຮອຍຖືກສິດຂາດຖືວ່າໝົດປະກັນ.",
  "ກໍລະນີຊື້ສິນຄ້າແລ້ວປ່ຽນໃຈເອົາລຸ້ນອື່ນ ຫຼື ສີອື່ນ ຈະເສຍຄ່າປັບໃໝ 300,000 ກີບ",
  "ກໍລະນີຊື້ສິນຄ້າແລ້ວເລື່ອນລູກຄ້າບໍ່ເອົາສິນຄ້າ ຈະເສຍຄ່າປັບໃໝ 30% ຂອງມູນຄ່າສິນຄ້າ",
];

const SIGNATURES = [
  "ຜູ້ອະນຸມັດ",
  "ຜູ້ຮັບ",
  "ຜູ້ສັ່ງ",
  "ຜູ້ຈ່າຍເງິນ",
  "ຜູ້ຮັບເງິນ",
  "ຜູ້ອອກບິນ",
];

// Keep the ruled item area at the same visual height as the paper form.
const MIN_ITEM_ROWS = 11;

const money0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const money2 = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function fmtDate(d: Date | null): string {
  if (!d) return "—";
  const dt = new Date(d);
  const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
  return `${p(dt.getDate())}/${p(dt.getMonth() + 1)}/${dt.getFullYear()}`;
}

function fmtTime(d: Date | null, fallback: string | null): string {
  if (d) {
    const dt = new Date(d);
    const p = (n: number) => (n < 10 ? `0${n}` : `${n}`);
    return `${p(dt.getHours())}:${p(dt.getMinutes())}`;
  }
  return fallback?.slice(0, 5) ?? "";
}

function Barcode({ value }: { value: string }) {
  const enc = encodeCode128B(value);
  if (!enc) return <div className="font-mono text-[10px]">{value}</div>;
  const h = 40;
  return (
    <svg
      viewBox={`0 0 ${enc.width} ${h}`}
      preserveAspectRatio="none"
      className="h-8 w-[44mm]"
      role="img"
      aria-label={`barcode ${value}`}
    >
      {enc.bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={h} fill="#000" />
      ))}
    </svg>
  );
}

// Render the ODIEN Mall sales invoice (ບິນຂາຍສິນຄ້າ). The page sets up the
// screen toolbar; this component is the printed body.
export default function ReceiptPrintView({ receipt }: { receipt: ReceiptDetail }) {
  const r = receipt;

  const subtotal = r.items.reduce((a, it) => a + it.sumKip, 0);
  const discount = r.totals.billDiscountKip;
  const vat = 0; // not tracked yet
  const advance = 0; // not tracked yet
  const grand = r.totals.amountKip || subtotal - discount + vat - advance;

  const fillerRows = Math.max(0, MIN_ITEM_ROWS - r.items.length);
  const issuerName = r.cashier?.name ?? r.salesperson?.name ?? "";

  return (
    <article className="receipt-sheet receipt-invoice mx-auto min-h-[277mm] w-[190mm] bg-white px-[5mm] py-[4mm] text-black shadow-sm print:min-h-0 print:w-auto print:px-0 print:py-0">
      {/* ---- Header ---- */}
      <header className="grid grid-cols-[28mm_1fr_55mm] items-start gap-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/odm.png" alt="ODIEN Mall" className="mt-1 h-[18mm] w-[27mm] object-contain" />
        <div className="text-center text-[10px] leading-[1.35]">
          <div className="flex items-baseline justify-center gap-8">
            <span className="text-[15px] font-black">{SHOP.nameLo}</span>
            <span className="text-[13px] font-bold">{SHOP.branchLo}</span>
          </div>
          <div>{SHOP.addressLo}</div>
          <div className="text-[11px]">{SHOP.tel}</div>
          <div className="text-[11px]">{SHOP.email}</div>
        </div>
        <div className="text-right">
          <div className="text-[19px] font-black">ບິນຂາຍສິນຄ້າ(ສົດ)</div>
          <div className="text-[11px]">(ສຳລັບລູກຄ້າ)</div>
        </div>
      </header>

      {/* ---- Barcode + doc no ---- */}
      <div className="mt-1 flex items-end justify-between px-1">
        <Barcode value={r.docNo} />
        <div className="text-[12px]">
          <span>ເລກທີ : </span>
          <span className="font-mono text-[13px]">{r.docNo}</span>
        </div>
      </div>

      {/* ---- Customer / document boxes ---- */}
      <div className="mt-1 grid grid-cols-[58%_42%] text-[11px]">
        <div className="border border-black px-3 py-1">
          <Field label="ລູກຄ້າ" value={r.customer.name ?? ""} extraLabel="ເບີໂທ" extraValue={r.customer.phone ?? ""} />
          <Field label="ທີ່ຢູ່" value={r.customer.address ?? ""} />
          <Field label="ສະມາຊິກ" value={r.customer.name ?? ""} />
          <Field label="ບັດສະມາຊິກ" value="" />
        </div>
        <div className="-ml-px border border-black px-3 py-1">
          <Field label="ວັນທີ" value={`${fmtDate(r.createdAt ?? r.docDate)}    ${fmtTime(r.createdAt, r.docTime)}`} />
          <Field label="ພະນັກງານຂາຍ" value={r.salesperson?.name ?? ""} />
          <Field label="ເບີໂທ" value="" />
          <Field label="Service" value={SHOP.service} />
          <Field label="ປະເພດການສັ່ງ" value="ລູກຄ້າຮັບເອງ   WALKIN" />
        </div>
      </div>

      {/* ---- Items grid ---- */}
      <table className="-mt-px w-full table-fixed border-collapse border-b border-black text-[10px]">
        <colgroup>
          <col className="w-[5%]" />
          <col className="w-[14%]" />
          <col className="w-[36%]" />
          <col className="w-[14%]" />
          <col className="w-[12%]" />
          <col className="w-[8%]" />
          <col className="w-[11%]" />
        </colgroup>
        <thead>
          <tr className="bg-odoo-surface-muted text-center font-bold">
            <Th>ລ/ດ</Th>
            <Th>ລະຫັດ</Th>
            <Th>ລາຍການ</Th>
            <Th>ຈຳນວນ / ຫົວໜ່ວຍ</Th>
            <Th>ລາຄາ</Th>
            <Th>ສ່ວນຫຼຸດ</Th>
            <Th>ເປັນເງິນ</Th>
          </tr>
        </thead>
        <tbody>
          {r.items.map((it, idx) => (
            <tr key={it.lineNumber} className="h-[7mm] align-top">
              <Td className="text-center">{idx + 1}</Td>
              <Td className="font-mono">{it.itemCode}</Td>
              <Td>{it.itemName ?? it.itemCode}</Td>
              <Td className="text-center">
                <span className="font-mono">{money2.format(it.qty)}</span>
                {it.unitCode ? ` ${it.unitCode}` : ""}
              </Td>
              <Td className="text-right font-mono">
                {it.priceKip > 0 ? money0.format(it.priceKip) : ""}
              </Td>
              <Td className="text-right font-mono">
                {it.discountAmountKip > 0 ? money0.format(it.discountAmountKip) : ""}
              </Td>
              <Td className="text-right font-mono">
                {it.sumKip > 0 ? money0.format(it.sumKip) : ""}
              </Td>
            </tr>
          ))}
          {Array.from({ length: fillerRows }).map((_, i) => (
            <tr key={`f${i}`} className="h-[7mm]">
              <Td>&nbsp;</Td>
              <Td>&nbsp;</Td>
              <Td>&nbsp;</Td>
              <Td>&nbsp;</Td>
              <Td>&nbsp;</Td>
              <Td>&nbsp;</Td>
              <Td>&nbsp;</Td>
            </tr>
          ))}
        </tbody>
      </table>

      <div className="border-x border-b border-black px-2 py-0.5 text-[10px]">
        <span className="font-bold">ໝາຍເຫດ : </span>
        <span className="whitespace-pre-wrap">{r.remark || " "}</span>
      </div>

      {/* ---- Terms, bank accounts and totals ---- */}
      <div className="mt-2 border border-black px-2 py-1 text-[10px]">
        <ol className="list-decimal pl-4 leading-[1.35]">
          {TERMS.map((t, i) => <li key={i}>{t}</li>)}
        </ol>
      </div>

      <div className="mt-1 grid grid-cols-[1fr_63mm] gap-4 text-[10px]">
        <div>
          <div className="mb-1">
            <span>ໝາຍເຫດ: </span>
            <span>{fmtDate(r.createdAt ?? r.docDate)} {r.remark || ""}</span>
          </div>
          <div className="font-bold">ທະນາຄານການຄ້າ :</div>
          {BANK_ACCOUNTS.map((b) => (
            <div key={b.cur} className="font-mono leading-[1.35]">
              {b.no} <span className="ml-1">{b.cur}</span>
            </div>
          ))}
        </div>
        <div className="text-[11px]">
          <TotalRow label="ລວມເງິນ" value={`${money2.format(subtotal)}`} unit="ກີບ" />
          <TotalRow label="ສ່ວນຫຼຸດ" value={money2.format(discount)} />
          <TotalRow label="ອມພ : 10%" value={money2.format(vat)} />
          <TotalRow label="ຫັກເງິນລ່ວງໜ້າ" value={money2.format(advance)} />
          <div className="flex items-baseline justify-between font-black">
            <span>ລວມເງິນທັງໝົດ :</span>
            <span className="font-mono text-[13px]">{money2.format(grand)}</span>
            <span>ກີບ</span>
          </div>
        </div>
      </div>

      {/* ---- Signatures ---- */}
      <div className="mt-2 grid grid-cols-6 gap-4 text-center text-[10px]">
        {SIGNATURES.map((s, i) => (
          <div key={s}>
            <div className="h-8">
              {/* issuer name printed above the last signature line */}
              {i === SIGNATURES.length - 1 ? (
                <span className="font-bold text-[10px]">{issuerName}</span>
              ) : null}
            </div>
            <div className="border-b border-dotted border-black pb-1">{s}</div>
          </div>
        ))}
      </div>
    </article>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="border border-black px-1 py-0.5">{children}</th>;
}

function Td({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return <td className={`border-x border-black px-1 py-0.5 ${className}`}>{children}</td>;
}

function Field({
  label,
  value,
  extraLabel,
  extraValue,
}: {
  label: string;
  value: string;
  extraLabel?: string;
  extraValue?: string;
}) {
  return (
    <div className="flex min-h-[4.3mm] items-baseline gap-1">
      <span>{label} :</span>
      <span className="flex-1 font-semibold">{value || " "}</span>
      {extraLabel ? (
        <>
          <span>{extraLabel} :</span>
          <span className="font-semibold">{extraValue || " "}</span>
        </>
      ) : null}
    </div>
  );
}

function TotalRow({
  label,
  value,
  unit,
}: {
  label: string;
  value: string;
  unit?: string;
}) {
  return (
    <div className="flex items-baseline justify-between py-0.5">
      <span>{label} :</span>
      <span className="font-mono">{value}</span>
      <span className="w-6 text-right">{unit ?? ""}</span>
    </div>
  );
}
