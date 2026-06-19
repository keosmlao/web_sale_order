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

// One layout, three physical sizes. The design is authored once at the "large"
// box (92×84mm) and uniformly scaled down for the smaller sizes — so the tag
// looks identical, just smaller, and the printed box is an exact mm footprint
// the user can cut to. Height stays proportional to keep the layout undistorted.
export type TagSize =
  | "large"
  | "medium"
  | "small"
  | "a5"
  | "a6"
  | "a7"
  | "a8";

const BASE_W = 92;
const BASE_H = 84;

export const TAG_SIZES: Record<
  TagSize,
  { key: TagSize; label: string; widthMm: number; heightMm: number; scale: number }
> = {
  large: { key: "large", label: "ໃຫຍ່", widthMm: 92, heightMm: 84, scale: 1 },
  medium: {
    key: "medium",
    label: "ກາງ",
    widthMm: 70,
    heightMm: Math.round(BASE_H * (70 / BASE_W) * 10) / 10,
    scale: 70 / BASE_W,
  },
  small: {
    key: "small",
    label: "ນ້ອຍ",
    widthMm: 50,
    heightMm: Math.round(BASE_H * (50 / BASE_W) * 10) / 10,
    scale: 50 / BASE_W,
  },
  // A-series (landscape) — one tag fills one physical A-size sheet. The
  // 92×84mm design is scaled to *fit* (contain) inside the sheet and centred
  // by PriceTag, so it prints undistorted with white side margins. The `scale`
  // here is the fit factor (limited by height, since the design is less wide
  // than an A sheet); PriceTag recomputes the same value defensively.
  a5: { key: "a5", label: "A5", widthMm: 210, heightMm: 148, scale: 148 / BASE_H },
  a6: { key: "a6", label: "A6", widthMm: 148, heightMm: 105, scale: 105 / BASE_H },
  a7: { key: "a7", label: "A7", widthMm: 105, heightMm: 74, scale: 74 / BASE_H },
  a8: { key: "a8", label: "A8", widthMm: 74, heightMm: 52, scale: 52 / BASE_H },
};

/** True for the A-series sizes that print one tag per physical A sheet. */
export function isASheetSize(size: TagSize): boolean {
  return size === "a5" || size === "a6" || size === "a7" || size === "a8";
}

export function discountPercent(oldPrice: number | null, newPrice: number): number | null {
  if (!oldPrice || oldPrice <= 0 || newPrice >= oldPrice) return null;
  return Math.round(((oldPrice - newPrice) / oldPrice) * 100);
}

function Barcode128({ value, className = "h-7 w-full" }: { value: string; className?: string }) {
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
      className={className}
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

// Landscape full-bleed layout for the A-series sheets (one tag per A sheet).
// The 92×84mm portrait design leaves big white side margins on a wide A sheet,
// so the A sizes get this dedicated landscape layout instead — authored once at
// 210×148mm (A5) and uniformly scaled to the chosen A footprint, with the dark
// background bleeding to every edge so the tag border meets the paper edge.
const BASE_LW = 210;
const BASE_LH = 148;

function PriceTagSheet({
  data,
  dim,
}: {
  data: PriceTagData;
  dim: { widthMm: number; heightMm: number };
}) {
  const pct = discountPercent(data.oldPrice, data.newPrice);
  const showOld = data.oldPrice != null && data.oldPrice > 0 && data.oldPrice > data.newPrice;
  // Fill the footprint by width; the A aspect ratios all ≈ 1.41 so the tiny
  // height remainder (<1mm) is covered by the white outer box behind it.
  const scale = dim.widthMm / BASE_LW;

  return (
    <div
      className="pt-tag overflow-hidden bg-white"
      style={{ width: `${dim.widthMm}mm`, height: `${dim.heightMm}mm` }}
    >
      <div
        className="relative flex flex-row overflow-hidden bg-slate-950 text-white"
        style={{
          width: `${BASE_LW}mm`,
          height: `${BASE_LH}mm`,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
        }}
      >
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_8%_0%,rgba(34,211,238,0.34),transparent_30%),radial-gradient(circle_at_98%_10%,rgba(59,130,246,0.28),transparent_30%),linear-gradient(135deg,rgba(15,23,42,0)_0%,rgba(8,47,73,0.55)_100%)]" />

        {/* LEFT — brand, product, price, barcode */}
        <div className="relative z-10 flex min-w-0 flex-1 flex-col py-[10mm] pl-[13mm] pr-[9mm]">
          <div className="flex items-center gap-[3mm]">
            {data.showLogo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src="/odm.png"
                alt="logo"
                className="h-[16mm] w-[16mm] shrink-0 rounded-[3mm] bg-white object-contain p-[2mm] shadow-[0_0_18px_rgba(34,211,238,0.35)]"
              />
            ) : null}
            {data.showRibbon && data.ribbonText ? (
              <span className="truncate rounded-full border border-cyan-300/45 bg-cyan-300/10 px-[5mm] py-[2mm] text-[18px] font-black uppercase tracking-[0.22em] text-cyan-100">
                {data.ribbonText}
              </span>
            ) : null}
          </div>

          <div className="mt-[6mm]">
            <div
              className="text-[44px] font-black leading-[1.05] text-white"
              style={{ display: "-webkit-box", WebkitBoxOrient: "vertical", WebkitLineClamp: 2, overflow: "hidden" }}
            >
              {data.productName}
            </div>
            <div className="mt-[2mm] font-mono text-[20px] tracking-[0.18em] text-cyan-200/85">
              {data.productCode}
            </div>
          </div>

          {data.promoText ? (
            <div className="mt-[4mm] self-start rounded-[3mm] border border-red-300/35 bg-red-500/15 px-[5mm] py-[2.5mm] text-[20px] font-bold leading-snug text-red-100">
              {data.promoText}
            </div>
          ) : null}

          <div className="mt-auto">
            <div
              className={
                "rounded-[6mm] px-[7mm] py-[5mm] shadow-[0_12px_34px_rgba(2,132,199,0.18)] " +
                (showOld ? "border-2 border-red-200 bg-white" : "border-2 border-cyan-200 bg-white")
              }
            >
              <div className="flex items-end justify-between gap-[4mm]">
                <div className="flex min-w-0 flex-col">
                  {showOld ? (
                    <span className="text-[28px] font-bold leading-none text-slate-400 line-through">
                      {moneyFmt.format(data.oldPrice as number)}
                    </span>
                  ) : null}
                  <div className="mt-[1.5mm] flex items-baseline gap-[2mm]">
                    <span
                      className={
                        "text-[88px] font-black leading-[0.82] tracking-tight " +
                        (showOld ? "text-red-600" : "text-slate-950")
                      }
                    >
                      {moneyFmt.format(data.newPrice)}
                    </span>
                    <span className="text-[30px] font-bold text-slate-500">ກີບ</span>
                  </div>
                </div>
                <span className="shrink-0 pb-[2mm] text-[24px] font-semibold text-slate-400">
                  /{data.unit || "ອັນ"}
                </span>
              </div>
            </div>

            {data.showBarcode ? (
              <div className="mt-[4mm] flex items-center gap-[4mm]">
                <div className="w-[82mm] rounded-[2mm] bg-white px-[3mm] py-[2mm]">
                  <Barcode128 value={data.productCode} className="h-[10mm] w-full" />
                </div>
                <span className="font-mono text-[15px] tracking-[0.2em] text-cyan-100/70">
                  {data.productCode}
                </span>
              </div>
            ) : null}
          </div>
        </div>

        {/* RIGHT — discount badge + QR + meta, centred as one stack */}
        <div className="relative z-10 flex w-[33%] shrink-0 flex-col items-center justify-center gap-[6mm] border-l border-cyan-300/20 py-[10mm] pl-[7mm] pr-[13mm]">
          {pct != null ? (
            <div className="flex h-[34mm] w-[34mm] flex-col items-center justify-center rounded-full border-[1.5mm] border-red-300/70 bg-red-500 text-white shadow-[0_0_26px_rgba(239,68,68,0.45)]">
              <span className="text-[42px] font-black leading-none">−{pct}%</span>
              <span className="text-[16px] font-bold uppercase tracking-[0.18em]">OFF</span>
            </div>
          ) : null}

          <div className="flex flex-col items-center gap-[3mm]">
            {data.showQr && data.qrText ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/qrcode?text=${encodeURIComponent(data.qrText)}&size=240`}
                alt="QR"
                className="h-[42mm] w-[42mm] rounded-[2mm] bg-white p-[2mm]"
              />
            ) : null}
            <div className="text-center leading-tight">
              {data.validText ? (
                <div className="text-[16px] font-bold text-cyan-100">ວັນທີ {data.validText}</div>
              ) : null}
              {data.contact ? (
                <div className="mt-[1mm] text-[15px] font-semibold text-cyan-100/70">{data.contact}</div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// A single retail price tag, sized in millimetres so the print output is
// physically accurate. The same component renders the on-screen preview and
// each cell of the batch print grid. `size` scales the whole design uniformly.
export default function PriceTag({
  data,
  size = "large",
}: {
  data: PriceTagData;
  size?: TagSize;
}) {
  const pct = discountPercent(data.oldPrice, data.newPrice);
  const showOld = data.oldPrice != null && data.oldPrice > 0 && data.oldPrice > data.newPrice;
  const dim = TAG_SIZES[size] ?? TAG_SIZES.large;
  // A-series sheets print one tag per page → use the landscape full-bleed
  // layout so the tag fills the sheet to its edges instead of leaving margins.
  if (isASheetSize(size)) {
    return <PriceTagSheet data={data} dim={dim} />;
  }
  // Fit (contain) the 92×84mm design inside the chosen footprint without
  // distortion. For the custom sizes (large/medium/small) the footprint keeps
  // the design's aspect, so this equals widthMm/92 and fills exactly. For the
  // A-series sheets the aspect differs, so the design is scaled to the limiting
  // dimension and centred (white margins on the sides).
  const scale = Math.min(dim.widthMm / BASE_W, dim.heightMm / BASE_H);
  const scaledW = BASE_W * scale;
  const scaledH = BASE_H * scale;

  return (
    // Outer box = the exact physical footprint at the chosen size. The design
    // is centred inside it; on A sheets that leaves balanced white margins.
    <div
      className="pt-tag flex items-center justify-center overflow-hidden bg-white"
      style={{ width: `${dim.widthMm}mm`, height: `${dim.heightMm}mm` }}
    >
      <div style={{ width: `${scaledW}mm`, height: `${scaledH}mm` }}>
        <div
          className="relative flex flex-col overflow-hidden rounded-[18px] border border-cyan-300/55 bg-slate-950 text-white shadow-[0_18px_45px_rgba(8,47,73,0.30)]"
          style={{
            width: `${BASE_W}mm`,
            height: `${BASE_H}mm`,
            transform: `scale(${scale})`,
            transformOrigin: "top left",
          }}
        >
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_12%_0%,rgba(34,211,238,0.34),transparent_34%),radial-gradient(circle_at_95%_18%,rgba(59,130,246,0.28),transparent_32%),linear-gradient(135deg,rgba(15,23,42,0)_0%,rgba(8,47,73,0.52)_100%)]" />
          <div className="pointer-events-none absolute left-0 right-0 top-[18mm] h-px bg-cyan-300/35" />
          <div className="pointer-events-none absolute bottom-[20mm] left-0 right-0 h-px bg-cyan-300/25" />
          {/* Header — brand eyebrow (left) + discount badge (right) */}
          <div className="relative z-10 flex items-start justify-between gap-2 px-4 pt-3">
            <div className="flex min-w-0 items-center gap-2">
              {data.showLogo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src="/odm.png"
                  alt="logo"
                  width={28}
                  height={28}
                  className="h-8 w-8 shrink-0 rounded-lg bg-white object-contain p-1 shadow-[0_0_18px_rgba(34,211,238,0.35)]"
                />
              ) : null}
              {data.showRibbon && data.ribbonText ? (
                <span className="truncate rounded-full border border-cyan-300/45 bg-cyan-300/10 px-2.5 py-1 text-[9px] font-black uppercase tracking-[0.22em] text-cyan-100">
                  {data.ribbonText}
                </span>
              ) : null}
            </div>
            {pct != null ? (
              <div className="flex h-[14mm] w-[14mm] shrink-0 flex-col items-center justify-center rounded-full border border-red-300/70 bg-red-500 text-white shadow-[0_0_26px_rgba(239,68,68,0.45)]">
                <span className="text-[16px] font-black leading-none">−{pct}%</span>
                <span className="text-[7px] font-bold uppercase tracking-[0.18em]">
                  OFF
                </span>
              </div>
            ) : null}
          </div>

          {/* Product presentation — name is the headline */}
          <div className="relative z-10 px-4 pt-2">
            <div
              className="text-[20px] font-black leading-[1.08] text-white"
              style={{
                display: "-webkit-box",
                WebkitBoxOrient: "vertical",
                WebkitLineClamp: 2,
                overflow: "hidden",
              }}
            >
              {data.productName}
            </div>
            <div className="mt-1 font-mono text-[9px] tracking-[0.18em] text-cyan-200/85">
              {data.productCode}
            </div>
          </div>

          {data.promoText ? (
            <div className="relative z-10 mx-4 mt-2 rounded-lg border border-red-300/35 bg-red-500/15 px-2.5 py-1 text-[10px] font-bold leading-snug text-red-100">
              {data.promoText}
            </div>
          ) : null}

          {/* Price — the hero. Sale price is red on a tinted platform; a plain
              (no-discount) price stays near-black on neutral. */}
          <div className="relative z-10 mt-auto px-4">
            <div
              className={
                "rounded-2xl border px-4 py-2 shadow-[0_12px_34px_rgba(2,132,199,0.18)] " +
                (showOld
                  ? "border-red-200 bg-white"
                  : "border-cyan-200 bg-white")
              }
            >
              <div className="flex items-end justify-between gap-2">
                <div className="flex min-w-0 flex-col">
                  {showOld ? (
                    <span className="text-[13px] font-bold leading-none text-slate-400 line-through">
                      {moneyFmt.format(data.oldPrice as number)}
                    </span>
                  ) : null}
                  <div className="mt-1 flex items-baseline gap-1">
                    <span
                      className={
                        "text-[42px] font-black leading-[0.85] tracking-tight " +
                        (showOld ? "text-red-600" : "text-slate-950")
                      }
                    >
                      {moneyFmt.format(data.newPrice)}
                    </span>
                    <span className="text-[13px] font-bold text-slate-500">ກີບ</span>
                  </div>
                </div>
                <span className="shrink-0 pb-1 text-[10px] font-semibold text-slate-400">
                  /{data.unit || "ອັນ"}
                </span>
              </div>
            </div>
          </div>

          {/* Footer — barcode (left) + meta & QR (right), kept quiet */}
          <div className="relative z-10 mt-1 flex items-center justify-between gap-2 border-t border-cyan-300/20 px-4 py-1.5">
            {data.showBarcode ? (
              <div className="flex min-w-0 flex-col">
                <div className="w-[30mm] rounded bg-white px-1 py-0.5">
                  <Barcode128 value={data.productCode} />
                </div>
                <span className="mt-0.5 font-mono text-[7px] tracking-[0.2em] text-cyan-100/70">
                  {data.productCode}
                </span>
              </div>
            ) : (
              <span />
            )}
            <div className="flex shrink-0 items-center gap-2">
              <div className="text-right leading-tight">
                {data.validText ? (
                  <div className="text-[8px] font-bold text-cyan-100">
                    ວັນທີ {data.validText}
                  </div>
                ) : null}
                {data.contact ? (
                  <div className="text-[8px] font-semibold text-cyan-100/60">
                    {data.contact}
                  </div>
                ) : null}
              </div>
              {data.showQr && data.qrText ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={`/api/qrcode?text=${encodeURIComponent(data.qrText)}&size=120`}
                  alt="QR"
                  width={36}
                  height={36}
                  className="h-8 w-8 shrink-0 rounded bg-white p-0.5"
                />
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
