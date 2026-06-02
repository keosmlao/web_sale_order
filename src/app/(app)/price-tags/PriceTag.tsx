import { encodeCode128B } from "@/lib/barcode128";

const moneyFmt = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });

export type PriceTagData = {
  id: string;
  /** Product name shown big (Lao). */
  productName: string;
  /** Item / barcode value rendered as the Code 128 strip + caption. */
  productCode: string;
  /** Unit label, e.g. "ອັນ", "ຊຸດ". */
  unit: string;
  /** Crossed-out original price. Null/0 → hidden. */
  oldPrice: number | null;
  /** Big red sale price. */
  newPrice: number;
  /** Promotion / free-gift line (red). Empty → hidden. */
  promoText: string;
  /** Ribbon caption, e.g. "SUPER SALE". */
  ribbonText: string;
  /** Validity range, already formatted (e.g. "01-30/06/2026"). Empty → hidden. */
  validText: string;
  /** QR payload (link / handle). Empty → QR hidden. */
  qrText: string;
  /** Footer contact line. */
  contact: string;
  showBarcode: boolean;
  showQr: boolean;
  showRibbon: boolean;
  showLogo: boolean;
};

export function discountPercent(oldPrice: number | null, newPrice: number): number | null {
  if (!oldPrice || oldPrice <= 0 || newPrice >= oldPrice) return null;
  return Math.round(((oldPrice - newPrice) / oldPrice) * 100);
}

function Barcode128({ value }: { value: string }) {
  const encoded = encodeCode128B(value);
  if (!encoded) {
    // Non Code-128 character — fall back to the raw text.
    return <div className="text-center font-mono text-[10px] text-slate-700">{value}</div>;
  }
  const height = 36;
  return (
    <svg
      viewBox={`0 0 ${encoded.width} ${height}`}
      preserveAspectRatio="none"
      className="h-8 w-full"
      role="img"
      aria-label={`barcode ${value}`}
    >
      <rect x={0} y={0} width={encoded.width} height={height} fill="#ffffff" />
      {encoded.bars.map((b, i) => (
        <rect key={i} x={b.x} y={0} width={b.w} height={height} fill="#0f172a" />
      ))}
    </svg>
  );
}

// A single retail price tag, sized in millimetres so the print output is
// physically accurate. The same component renders the on-screen preview and
// each cell of the batch print grid.
export default function PriceTag({ data }: { data: PriceTagData }) {
  const pct = discountPercent(data.oldPrice, data.newPrice);
  const showOld = data.oldPrice != null && data.oldPrice > 0 && data.oldPrice > data.newPrice;

  return (
    <div
      className="pt-tag relative flex flex-col overflow-hidden rounded-xl border border-slate-300 bg-white"
      style={{ width: "92mm", height: "84mm" }}
    >
      {/* Header band */}
      <div className="flex items-center justify-between gap-2 bg-gradient-to-r from-blue-800 to-blue-600 px-3 py-1.5 text-white">
        <div className="flex items-center gap-2">
          {data.showLogo ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src="/odm.png"
              alt="logo"
              width={24}
              height={24}
              className="h-6 w-6 rounded bg-white object-contain p-0.5"
            />
          ) : null}
          <span className="text-[11px] font-black uppercase leading-tight tracking-wide">
            Mid-Year
            <br />
            Super Sale
          </span>
        </div>
        {data.showBarcode ? (
          <div className="flex min-w-0 flex-col items-end">
            <div className="w-[34mm] rounded bg-white px-1 py-0.5">
              <Barcode128 value={data.productCode} />
            </div>
            <span className="mt-0.5 font-mono text-[9px] tracking-widest text-blue-50">
              {data.productCode}
            </span>
          </div>
        ) : null}
      </div>

      {/* Sale ribbon */}
      {data.showRibbon && pct != null ? (
        <div className="pointer-events-none absolute left-[-30px] top-[18mm] z-10 -rotate-45 bg-red-600 px-8 py-0.5 text-center text-[10px] font-black uppercase tracking-wider text-white shadow">
          {data.ribbonText} −{pct}%
        </div>
      ) : null}

      {/* Body */}
      <div className="flex flex-1 flex-col px-3 py-2">
        <div className="text-[10px] font-bold text-slate-400">ຊື່ສິນຄ້າ</div>
        <div className="text-[15px] font-black leading-tight text-slate-900">
          {data.productName}
        </div>

        {data.promoText ? (
          <div className="mt-1 rounded bg-red-50 px-2 py-1 text-[11px] font-bold leading-snug text-red-600">
            {data.promoText}
          </div>
        ) : null}

        {/* Price */}
        <div className="mt-auto flex items-end justify-between">
          <div className="flex flex-col">
            {showOld ? (
              <span className="text-[15px] font-semibold text-slate-400 line-through">
                {moneyFmt.format(data.oldPrice as number)}
              </span>
            ) : null}
            <span className="text-[34px] font-black leading-none text-red-600">
              {moneyFmt.format(data.newPrice)}
            </span>
          </div>
          <span className="pb-1 text-[12px] font-bold text-slate-700">
            Kip/{data.unit || "ອັນ"}
          </span>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between gap-2 border-t border-slate-200 px-3 py-1.5">
        <div className="flex items-center gap-2">
          {data.showQr && data.qrText ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={`/api/qrcode?text=${encodeURIComponent(data.qrText)}&size=120`}
              alt="QR"
              width={40}
              height={40}
              className="h-10 w-10"
            />
          ) : null}
          <span className="text-[9px] font-semibold leading-tight text-slate-500">
            {data.contact}
          </span>
        </div>
        {data.validText ? (
          <span className="text-right text-[9px] font-bold text-slate-600">
            ວັນທີ {data.validText}
          </span>
        ) : null}
      </div>
    </div>
  );
}
