"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  applyPromotions,
  isPromoActiveNow,
  type EngineLine,
  type EnginePromotion,
} from "@/lib/promotions-engine";

type Customer = {
  id: string;
  name: string;
  phone: string | null;
  groupCode: string | null;
  groupName: string | null;
  discountPct: number;
  pointBalance: number;
};

type LoyaltyConfig = {
  earnKipPerPoint: number;
  pointName: string | null;
  isActive: boolean;
};

type TransportType = {
  code: string;
  name: string;
};

type Salesperson = {
  employeeCode: string | null;
  fullnameLo: string | null;
  fullnameEn: string | null;
  nickname: string | null;
};

type Product = {
  id: string;
  code: string;
  name: string;
  price: number;
  unitName: string | null;
  brand: string | null;
  category: string | null;
  categoryName: string | null;
  groupMain: string | null;
  groupMainName: string | null;
  stock: number;
  minimumStock?: number;
  hasSet?: boolean;
};

type LocationBalance = {
  warehouse: string | null;
  warehouseName: string | null;
  location: string | null;
  locationName: string | null;
  balanceQty: number;
};

type SetDetailItem = {
  lineNumber: number;
  itemCode: string;
  itemName: string;
  unitCode: string | null;
  quantity: number;
  price: number;
  amount: number;
};

type SetComponent = {
  lineNumber: number;
  itemCode: string;
  itemName: string;
  unitCode: string | null;
  requiredPerSet: number;
};

type SetWarehouseAvailability = {
  warehouseCode: string;
  warehouseName: string;
  status: "complete" | "incomplete" | "none";
  buildableSets: number;
  components: Array<{
    itemCode: string;
    balanceQty: number;
    sufficient: boolean;
    shortBy: number;
  }>;
};

type Line = {
  productId: string;
  productName: string;
  unitName: string | null;
  unitPrice: number;
  quantity: number;
  categoryCode: string | null;
  warehouseCode: string;
  locationCode: string;
  // Each line carries its own salesperson code so a single cart can credit
  // multiple sellers (matches the SML ic_trans_detail.sale_code shape).
  // Defaults to the cart-level salesperson at add-time.
  salespersonCode: string;
  locations: LocationBalance[];
  loadingLocations: boolean;
  // Warehouse-level stock at add time (from the products cache). Lets the
  // cart distinguish "stock = 0" from "cache says X but the location
  // breakdown query returned nothing" — a data-sync gap that requires a
  // retry, not an out-of-stock error.
  warehouseStock: number;
  locationLoadError: string | null;
  setDetails: SetDetailItem[];
  loadingSetDetails: boolean;
  setDetailError: string | null;
  // Set products that we sell by deducting component stock rather than the
  // pre-built set itself. When true, the line bypasses the standard
  // per-location balance check at submit time and is capped by
  // `buildableSets` instead.
  buildFromComponents?: boolean;
  buildableSets?: number;
  // BOGO bookkeeping. Bonus lines stay locked: the cashier cannot edit
  // their qty or delete them directly. They are recomputed whenever the
  // trigger's qty changes and removed when the trigger is removed.
  promoBonusOfCode?: string;     // trigger ic_code that drove this bonus
  promoId?: string;              // app_promotion.id (stringified)
  // Manual unit-price override. When set, this is the price the cashier
  // negotiated — overrides the catalog price for the cart math. Audit
  // trail keeps the original price so the receipt can show "was X → Y".
  overridePrice?: number;
  originalUnitPrice?: number;
};

const moneyFmt = new Intl.NumberFormat("en-US", {
  minimumFractionDigits: 0,
  maximumFractionDigits: 2,
});

// Browser-local "today" as YYYY-MM-DD for the <input type="date"> default.
// Computed in the local timezone (not UTC) so it matches the cashier's
// calendar day. Only called from client effects/handlers — never at module
// eval or during SSR — so it can't cause a hydration mismatch.
function todayLocalISODate() {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 10);
}

const DEFAULT_WAREHOUSE_CODE = "1102";
const EXCLUDED_POS_CATEGORY_LABELS = [
  "ເຄື່ອງໃຊ້ຫ້ອງການ",
  "ອຸປະກອນການຕະຫຼາດ",
];

function normalizeCategoryLabel(value: string) {
  return value.trim().replace(/\s+/g, " ").toLowerCase();
}

function productCategoryCode(p: Product) {
  return (p.groupMain || p.category || "").trim();
}

function productCategoryLabel(p: Product) {
  const code = productCategoryCode(p);
  return (p.groupMainName || p.categoryName || "").trim() || `ໝວດ ${code}`;
}

function isExcludedPosCategory(p: Product) {
  const label = normalizeCategoryLabel(productCategoryLabel(p));
  const hiddenCategory = EXCLUDED_POS_CATEGORY_LABELS.some((excluded) =>
    label.includes(normalizeCategoryLabel(excluded)),
  );
  const airButNotSet =
    (p.category?.trim() === "032" || p.groupMain?.trim() === "12") &&
    p.hasSet !== true &&
    p.unitName?.trim() !== "ຊຸດ";
  return hiddenCategory || airButNotSet;
}

function isAirSetProduct(
  p: Pick<Product, "category" | "groupMain" | "unitName" | "hasSet">,
) {
  return (
    (p.category?.trim() === "032" || p.groupMain?.trim() === "12") &&
    (p.hasSet === true || p.unitName?.trim() === "ຊຸດ")
  );
}

function isAirSetLine(line: Pick<Line, "categoryCode" | "unitName">) {
  return (
    line.unitName?.trim() === "ຊຸດ" &&
    (line.categoryCode?.trim() === "12" || line.categoryCode?.trim() === "032")
  );
}

function PosScreen({
  me,
}: {
  me: { employeeCode: string; fullnameLo: string | null; nickname: string | null };
}) {
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loadingCustomers, setLoadingCustomers] = useState(false);
  const [products, setProducts] = useState<Product[]>([]);
  const [activePromotions, setActivePromotions] = useState<EnginePromotion[]>([]);
  const [loyaltyConfig, setLoyaltyConfig] = useState<LoyaltyConfig>({
    earnKipPerPoint: 70000,
    pointName: "ແຕ້ມສະສົມ",
    isActive: true,
  });
  const [loadingProducts, setLoadingProducts] = useState(true);
  const [loadingData, setLoadingData] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [customer, setCustomer] = useState<Customer | null>(null);
  const [customerOpen, setCustomerOpen] = useState(false);
  const [customerQuery, setCustomerQuery] = useState("");
  const [newMemberOpen, setNewMemberOpen] = useState(false);
  const [promoListOpen, setPromoListOpen] = useState(false);
  const [productPickerOpen, setProductPickerOpen] = useState(false);
  const [productPickerQuery, setProductPickerQuery] = useState("");
  const [productPickerProduct, setProductPickerProduct] = useState<Product | null>(null);
  const [productPickerOptions, setProductPickerOptions] = useState<WhLocOption[]>([]);
  const [productPickerLoading, setProductPickerLoading] = useState(false);
  const [productPickerError, setProductPickerError] = useState<string | null>(null);

  const [salesWarehouses, setSalesWarehouses] = useState<string[]>([
    DEFAULT_WAREHOUSE_CODE,
  ]);
  // Cart-level warehouse default. Drives the product catalog filter and seeds
  // the per-item warehouse picker.
  const warehouseCode = salesWarehouses[0] ?? DEFAULT_WAREHOUSE_CODE;
  // code → name lookup for warehouses; fed by /api/warehouses on mount so
  // the cart line can render "ສາງ ${name}" instead of the bare code.
  const [warehouseNames, setWarehouseNames] = useState<Record<string, string>>(
    {},
  );
  useEffect(() => {
    let abort = false;
    (async () => {
      try {
        const res = await fetch("/api/warehouses");
        if (!res.ok) return;
        const data = (await res.json()) as {
          items?: Array<{ code: string | null; name: string | null }>;
        };
        if (abort) return;
        const map: Record<string, string> = {};
        for (const w of data.items ?? []) {
          if (w.code) map[w.code] = w.name?.trim() || w.code;
        }
        setWarehouseNames(map);
      } catch {
        // ignore — falls back to code-only display
      }
    })();
    return () => {
      abort = true;
    };
  }, []);

  // Salesperson cart-level fallback — sent as ic_trans.sale_code at the
  // header level. Per-line salesperson lives on each Line and is what the
  // detail rows persist.
  const [employees, setEmployees] = useState<Salesperson[]>([]);
  const salespersonCode = me.employeeCode ?? "";

  const [items, setItems] = useState<Line[]>([]);
  // Mirrors `items` so async helpers (reconcileBonusForTrigger,
  // maybeAutoAddBogoBonus) read the latest qty after a setItems call.
  // setTimeout(0) is not enough — React closes over `items` at render
  // time and the timeout callback still sees the stale value.
  const itemsRef = useRef<Line[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Restore any in-progress cart/customer so a page refresh doesn't lose
  // the sale. The draft is kept per-employee in localStorage and cleared
  // automatically when the cart empties or an order is submitted (see the
  // save effects below).
  const cartStorageKey = `pos-cart-draft:${me.employeeCode ?? "anon"}`;
  const customerStorageKey = `pos-customer-draft:${me.employeeCode ?? "anon"}`;
  const [cartHydrated, setCartHydrated] = useState(false);
  useEffect(() => {
    let restoredItems: Line[] | null = null;
    let restoredCustomer: Customer | null = null;
    try {
      const savedCart = window.localStorage.getItem(cartStorageKey);
      if (savedCart) {
        const parsed = JSON.parse(savedCart) as Line[];
        if (Array.isArray(parsed) && parsed.length > 0) restoredItems = parsed;
      }
      const savedCustomer = window.localStorage.getItem(customerStorageKey);
      if (savedCustomer) {
        const parsed = JSON.parse(savedCustomer) as Customer;
        if (parsed && parsed.id) restoredCustomer = parsed;
      }
    } catch {
      // localStorage unavailable / corrupt draft — start with an empty cart
    }
    // Defer the setState out of the effect body (matches the rest of this
    // file) so react-hooks/set-state-in-effect stays happy.
    Promise.resolve().then(() => {
      if (restoredItems) setItems(restoredItems);
      if (restoredCustomer) setCustomer(restoredCustomer);
      setCartHydrated(true);
    });
    // intentionally one-shot on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!cartHydrated) return;
    try {
      if (items.length === 0) {
        window.localStorage.removeItem(cartStorageKey);
      } else {
        window.localStorage.setItem(cartStorageKey, JSON.stringify(items));
      }
    } catch {
      // localStorage may be unavailable (Safari private mode) — silent
    }
  }, [items, cartStorageKey, cartHydrated]);
  useEffect(() => {
    if (!cartHydrated) return;
    try {
      if (!customer) {
        window.localStorage.removeItem(customerStorageKey);
      } else {
        window.localStorage.setItem(customerStorageKey, JSON.stringify(customer));
      }
    } catch {
      // silent
    }
  }, [customer, customerStorageKey, cartHydrated]);

  // Customer is optional (walk-in sales allowed) — we no longer force the
  // picker open on mount. The cashier opens it only when attaching a member.
  const [selectedLineIdx, setSelectedLineIdx] = useState<number | null>(null);

  // Per-line warehouse + location picker (mirrors the Flutter add-to-cart
  // flow): each option is one (warehouse, location) pair with its live
  // balance. The salesperson picks where to fulfil from in a single tap;
  // single-option hits skip the modal entirely.
  const [whPicker, setWhPicker] = useState<{
    product: Product;
    options: Array<{
      warehouseCode: string;
      warehouseName: string;
      locationCode: string;
      locationName: string;
      balance: number;
    }>;
  } | null>(null);
  const [whPickerLoading, setWhPickerLoading] = useState(false);

  // Per-trigger promo choice. Keyed by trigger ic_code:
  //   promoId → apply only that promo on this product
  //   null    → opt out of promos for this product (normal price)
  //   (absent)→ default: apply active promos as usual
  // Sent to /api/orders as `promoSelections` so the server honours the same
  // decision at settlement. Mirrored into a ref so the async add / bonus
  // flow reads the latest choice without waiting for a re-render.
  const [promoChoice, setPromoChoice] = useState<Record<string, string | null>>(
    {},
  );
  const promoChoiceRef = useRef<Record<string, string | null>>({});
  function setPromoChoiceFor(code: string, value: string | null) {
    const next = { ...promoChoiceRef.current, [code]: value };
    promoChoiceRef.current = next;
    setPromoChoice(next);
  }
  // Set-build availability modal. Opened when the cashier clicks an
  // ic_inventory_set product. Lists each warehouse with its per-component
  // balance and overall complete/incomplete/none status so the cashier can
  // pick a warehouse that actually has all the components to build the set.
  const [setBuilder, setSetBuilder] = useState<{
    product: Product;
    loading: boolean;
    components: SetComponent[];
    warehouses: SetWarehouseAvailability[];
    error: string | null;
  } | null>(null);

  // Per-line salesperson picker. The chip on each cart line opens this
  // modal; picking sets that one line's salespersonCode.
  const [lineSalespersonPickerIdx, setLineSalespersonPickerIdx] = useState<
    number | null
  >(null);
  const [lineSalespersonQuery, setLineSalespersonQuery] = useState("");

  // Special-price requests, keyed by product id (the shape the orders API
  // expects). The cashier doesn't set a number — they flag the item with an
  // optional reason; a manager approves and sets the price later. The cart
  // still settles at the catalog price until then.
  const [priceRequests, setPriceRequests] = useState<Record<string, string>>(
    {},
  );
  // Which cart line's price-request modal is open, plus its draft reason.
  const [priceRequestIdx, setPriceRequestIdx] = useState<number | null>(null);
  const [priceRequestReason, setPriceRequestReason] = useState("");

  const [transportTypes, setTransportTypes] = useState<TransportType[]>([]);
  const [transportCode, setTransportCode] = useState("");
  const [deliveryName, setDeliveryName] = useState("");
  const [receiveDate, setReceiveDate] = useState("");
  const [deliveryRound, setDeliveryRound] = useState("");
  const [deliveryLocation, setDeliveryLocation] = useState("");
  const [note, setNote] = useState("");
  const [extraDiscount, setExtraDiscount] = useState<number>(0);
  // Default to open so the delivery / note / end-of-bill discount fields are
  // visible without an extra tap. The cashier can still collapse the panel.
  const [extrasOpen, setExtrasOpen] = useState(true);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<{ cartNumber: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [eRes, loyaltyRes, whRes, transportRes] = await Promise.all([
          fetch("/api/employees"),
          fetch("/api/loyalty/config"),
          fetch("/api/settings/sales-warehouses"),
          fetch("/api/transport-types"),
        ]);
        if (!eRes.ok) throw new Error(`employees ${eRes.status}`);
        if (!loyaltyRes.ok) throw new Error(`loyalty ${loyaltyRes.status}`);
        if (!whRes.ok) throw new Error(`warehouses ${whRes.status}`);
        if (!transportRes.ok) throw new Error(`transport ${transportRes.status}`);
        const eData = await eRes.json();
        const loyaltyData = await loyaltyRes.json().catch(() => null);
        const whData = await whRes.json().catch(() => null);
        const transportData = await transportRes.json().catch(() => null);
        if (cancelled) return;
        setEmployees((eData ?? []) as Salesperson[]);
        const transportList = (
          (transportData?.items ?? []) as TransportType[]
        ).filter((row) => row.code && row.name);
        setTransportTypes(transportList);
        // Default the transport mode to self-pickup ("ລູກຄ້າຮັບເອງ") — the
        // most common POS case — so the cashier doesn't have to pick it each
        // sale. Only seed when nothing is chosen yet (transportCode is set via
        // the picker and is never restored from the cart draft).
        const selfPickup = transportList.find((t) =>
          (t.name ?? "").includes("ຮັບເອງ"),
        );
        if (selfPickup) {
          setTransportCode((prev) => prev || selfPickup.code);
        }
        // Default the receive date to today (browser-local). Set here in the
        // client-only load effect — which also gates the form behind
        // `loadingData` — so the field is already filled when the form first
        // renders, with no SSR/CSR hydration mismatch.
        setReceiveDate((prev) => prev || todayLocalISODate());
        const configuredWarehouses = ((whData?.items ?? []) as Array<{
          code?: string;
          isSalesWarehouse?: boolean;
        }>)
          .filter((row) => row.isSalesWarehouse && row.code)
          .map((row) => row.code as string);
        if (configuredWarehouses.length > 0) {
          setSalesWarehouses(configuredWarehouses);
        }
        const config = loyaltyData?.config;
        const earn = Number(config?.earnKipPerPoint);
        setLoyaltyConfig({
          earnKipPerPoint: Number.isFinite(earn) && earn > 0 ? earn : 70000,
          pointName:
            typeof config?.pointName === "string" && config.pointName.trim()
              ? config.pointName.trim()
              : "ແຕ້ມສະສົມ",
          isActive: config?.isActive !== false,
        });
      } catch (err) {
        if (!cancelled) {
          setLoadError(err instanceof Error ? err.message : "ໂຫລດຂໍ້ມູນຜິດພາດ");
        }
      } finally {
        if (!cancelled) {
          setLoadingData(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    if (!customerOpen) return;
    const timer = window.setTimeout(() => {
      setLoadingCustomers(true);
      void (async () => {
        try {
          const params = new URLSearchParams({ limit: "10" });
          const q = customerQuery.trim();
          if (q) params.set("q", q);
          const res = await fetch(`/api/customers?${params.toString()}`);
          if (!res.ok) throw new Error(`customers ${res.status}`);
          const data = await res.json();
          if (!cancelled) setCustomers(data as Customer[]);
        } catch (err) {
          if (!cancelled) {
            setCustomers([]);
            setLoadError(err instanceof Error ? err.message : "ໂຫລດລູກຄ້າຜິດພາດ");
          }
        } finally {
          if (!cancelled) setLoadingCustomers(false);
        }
      })();
    }, customerQuery.trim() ? 250 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [customerOpen, customerQuery]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!warehouseCode) {
        if (!cancelled) {
          setProducts([]);
          setLoadingProducts(false);
        }
        return;
      }
      if (!cancelled) setLoadingProducts(true);
      try {
        const res = await fetch(
          `/api/products?warehouses=${encodeURIComponent(salesWarehouses.join(","))}`,
        );
        if (!res.ok) throw new Error(`products ${res.status}`);
        const data = await res.json();
        if (!cancelled) {
          setProducts(data as Product[]);
          setLoadError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setProducts([]);
          setLoadError(err instanceof Error ? err.message : "ໂຫລດສິນຄ້າຜິດພາດ");
        }
      } finally {
        if (!cancelled) setLoadingProducts(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [warehouseCode, salesWarehouses]);

  useEffect(() => {
    let cancelled = false;
    async function loadPromos() {
      try {
        const res = await fetch("/api/promotions/active", {
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`promotions ${res.status}`);
        const data = await res.json();
        if (!cancelled) setActivePromotions((data ?? []) as EnginePromotion[]);
      } catch {
        if (!cancelled) setActivePromotions([]);
      }
    }
    void loadPromos();
    // Re-fetch whenever the tab regains focus so a promo created in another
    // tab (or the /promotions page next door) shows up without a hard
    // refresh of the POS.
    function onVisible() {
      if (document.visibilityState === "visible") void loadPromos();
    }
    window.addEventListener("focus", onVisible);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      cancelled = true;
      window.removeEventListener("focus", onVisible);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, []);

  // Catalog stock breakdown: once we have a product list, batch-fetch the
  const productPickerProducts = useMemo(() => {
    const q = productPickerQuery.trim().toLowerCase();
    const isAirQuery = q === "ແອ" || q === "air";
    const matched = products.filter((p) => {
      if (isExcludedPosCategory(p)) return false;
      if (!q) return true;
      const searchable = [
        p.name,
        p.code,
        p.brand ?? "",
        p.unitName ?? "",
        p.category ?? "",
        p.categoryName ?? "",
        p.groupMain ?? "",
        p.groupMainName ?? "",
        productCategoryLabel(p),
      ]
        .join(" ")
        .toLowerCase();
      return (
        searchable.includes(q) ||
        (isAirQuery &&
          (searchable.includes("air") ||
            p.category?.trim() === "032" ||
            p.groupMain?.trim() === "12"))
      );
    });
    return matched.slice(0, isAirQuery ? matched.length : q ? 24 : 36);
  }, [products, productPickerQuery]);

  const currentPromotions = useMemo(() => {
    const now = new Date();
    return activePromotions.filter((promo) => isPromoActiveNow(promo, now));
  }, [activePromotions]);

  const customerMatches = useMemo(() => {
    return customers;
  }, [customers]);

  async function fetchLocationsForProduct(
    idx: number,
    productId: string,
    whCode: string,
  ) {
    setItems((prev) => {
      const next = [...prev];
      const target = next[idx];
      if (!target || target.productId !== productId) return prev;
      next[idx] = { ...target, loadingLocations: true, locationLoadError: null };
      return next;
    });
    try {
      const res = await fetch("/api/inventory/stock-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          codes: [productId],
          warehouses: [whCode],
        }),
      });
      if (!res.ok) throw new Error(`stock-balance ${res.status}`);
      const data = await res.json();
      const balanceItem = (data?.items ?? [])[0];
      const locs: LocationBalance[] = balanceItem?.locations ?? [];
      setItems((prev) => {
        const next = [...prev];
        const target = next[idx];
        if (!target || target.productId !== productId) return prev;
        // Only auto-pick from conditions that actually have stock. The
        // shelf list is sorted "ສະພາບດີ" (110201) first, so falling back
        // to the highest-balance one naturally prefers good condition.
        const sellable = locs.filter((l) => l.balanceQty > 0);
        const enoughForQty = sellable.find(
          (l) => l.balanceQty >= target.quantity,
        );
        const mostStocked = [...sellable].sort(
          (a, b) => b.balanceQty - a.balanceQty,
        )[0];
        const preferred =
          enoughForQty?.location ?? mostStocked?.location ?? "";
        next[idx] = {
          ...target,
          locations: locs,
          locationCode: preferred ?? "",
          loadingLocations: false,
          locationLoadError: null,
        };
        return next;
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "ໂຫລດ stock ບໍ່ສຳເລັດ";
      setItems((prev) => {
        const next = [...prev];
        const target = next[idx];
        if (!target || target.productId !== productId) return prev;
        next[idx] = {
          ...target,
          locations: [],
          loadingLocations: false,
          locationLoadError: msg,
        };
        return next;
      });
    }
  }

  async function fetchSetDetailsForProduct(idx: number, productId: string) {
    setItems((prev) => {
      const next = [...prev];
      const target = next[idx];
      if (!target || target.productId !== productId) return prev;
      next[idx] = {
        ...target,
        loadingSetDetails: true,
        setDetailError: null,
      };
      return next;
    });

    try {
      const res = await fetch(
        `/api/products/${encodeURIComponent(productId)}/set`,
      );
      if (!res.ok) throw new Error(`set-detail ${res.status}`);
      const data = await res.json();
      const setDetails = (data?.items ?? []) as SetDetailItem[];
      setItems((prev) => {
        const next = [...prev];
        const target = next[idx];
        if (!target || target.productId !== productId) return prev;
        next[idx] = {
          ...target,
          setDetails,
          loadingSetDetails: false,
          setDetailError: null,
        };
        return next;
      });
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "ໂຫລດລາຍລະອຽດຊຸດບໍ່ສຳເລັດ";
      setItems((prev) => {
        const next = [...prev];
        const target = next[idx];
        if (!target || target.productId !== productId) return prev;
        next[idx] = {
          ...target,
          setDetails: [],
          loadingSetDetails: false,
          setDetailError: msg,
        };
        return next;
      });
    }
  }

  function openProductPicker() {
    setProductPickerOpen(true);
    setProductPickerQuery("");
    setProductPickerProduct(null);
    setProductPickerOptions([]);
    setProductPickerError(null);
  }

  function closeProductPicker() {
    setProductPickerOpen(false);
    setProductPickerQuery("");
    setProductPickerProduct(null);
    setProductPickerOptions([]);
    setProductPickerLoading(false);
    setProductPickerError(null);
  }

  function startOrderForCustomer(nextCustomer: Customer) {
    // Customer is optional and can be attached at any point — keep the
    // current cart so a walk-in sale already in progress isn't lost. The
    // pricing useMemo re-runs on `customer`, so the member discount applies
    // to the existing lines immediately.
    setCustomer(nextCustomer);
    setSubmitError(null);
    setCustomerOpen(false);
    setCustomerQuery("");
  }

  async function pickProductForModal(p: Product) {
    setSubmitError(null);
    setProductPickerProduct(p);
    setProductPickerOptions([]);
    setProductPickerError(null);
    if (isAirSetProduct(p)) {
      closeProductPicker();
      void openSetBuilder(p);
      return;
    }
    setProductPickerLoading(true);
    try {
      const res = await fetch("/api/inventory/stock-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: [p.id] }),
      });
      if (!res.ok) throw new Error(`stock-balance ${res.status}`);
      const data = (await res.json()) as {
        items?: Array<{
          locations?: Array<{
            warehouse: string | null;
            warehouseName: string | null;
            location: string | null;
            locationName: string | null;
            balanceQty: number;
          }>;
        }>;
      };
      const options = (data.items?.[0]?.locations ?? [])
        .filter((loc) => loc.warehouse && loc.location)
        .map((loc) => ({
          warehouseCode: loc.warehouse as string,
          warehouseName: loc.warehouseName?.trim() || (loc.warehouse as string),
          locationCode: loc.location as string,
          locationName: loc.locationName?.trim() || (loc.location as string),
          balance: loc.balanceQty,
        }))
        .sort((a, b) => b.balance - a.balance);

      if (options.length === 0 && p.stock > 0) {
        setProductPickerOptions([
          {
            warehouseCode,
            warehouseName: warehouseNames[warehouseCode] ?? warehouseCode,
            locationCode: "",
            locationName: "ສາງຫຼັກ",
            balance: p.stock,
          },
        ]);
        return;
      }

      if (options.length === 0) {
        setProductPickerError(`ສິນຄ້າ ${p.code} ບໍ່ມີ stock`);
        return;
      }

      setProductPickerOptions(options);
    } catch (err) {
      setProductPickerError(
        err instanceof Error ? err.message : "ບໍ່ສາມາດໂຫລດ stock ໄດ້",
      );
    } finally {
      setProductPickerLoading(false);
    }
  }

  function addPickedProduct(opt: WhLocOption) {
    if (!productPickerProduct || opt.balance <= 0) return;
    addProductWithLocation(
      productPickerProduct,
      opt.warehouseCode,
      opt.locationCode,
      opt.balance,
    );
    closeProductPicker();
  }

  async function addProduct(p: Product) {
    setSubmitError(null);
    if (isAirSetProduct(p)) {
      void openSetBuilder(p);
      return;
    }
    setWhPickerLoading(true);
    try {
      const res = await fetch("/api/inventory/stock-balance", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ codes: [p.id] }),
      });
      if (!res.ok) throw new Error(`stock-balance ${res.status}`);
      const data = (await res.json()) as {
        items?: Array<{
          locations?: Array<{
            warehouse: string | null;
            warehouseName: string | null;
            location: string | null;
            locationName: string | null;
            balanceQty: number;
          }>;
        }>;
      };
      const locations = data.items?.[0]?.locations ?? [];
      const options = locations
        .filter((loc) => loc.warehouse && loc.location)
        .map((loc) => ({
          warehouseCode: loc.warehouse as string,
          warehouseName: loc.warehouseName?.trim() || (loc.warehouse as string),
          locationCode: loc.location as string,
          locationName:
            loc.locationName?.trim() || (loc.location as string),
          balance: loc.balanceQty,
        }))
        .sort((a, b) => b.balance - a.balance);

      if (options.length === 0) {
        if (p.stock > 0) {
          addProductWithLocation(p, warehouseCode, "", p.stock);
          return;
        }
        setSubmitError(
          `ສິນຄ້າ ${p.code} ບໍ່ມີ stock ໃນສາງທີ່ຕັ້ງຄ່າ`,
        );
        return;
      }

      const inStockOptions = options.filter((o) => o.balance > 0);
      if (inStockOptions.length === 1 && options.length === 1) {
        const opt = inStockOptions[0];
        addProductWithLocation(
          p,
          opt.warehouseCode,
          opt.locationCode,
          opt.balance,
        );
        return;
      }
      setWhPicker({ product: p, options });
    } catch (e) {
      setSubmitError(
        e instanceof Error ? e.message : "ບໍ່ສາມາດໂຫລດ stock ໄດ້",
      );
    } finally {
      setWhPickerLoading(false);
    }
  }

  // Inner add. Used both from the single-option fast path and after the
  // user picks a (warehouse, location) pair from the modal.
  function addProductWithLocation(
    p: Product,
    whCode: string,
    locationCode: string,
    locationBalance: number,
    options: {
      skipPromotionBonus?: boolean;
      // When the caller is `maybeAutoAddBogoBonus`, it passes the
      // trigger's ic_code so the bonus line is tagged and locked.
      promoBonusOfCode?: string;
      promoId?: string;
      forcedQuantity?: number;
    } = {},
  ) {
    const cur = itemsRef.current;
    const inCartQty = cur
      .filter(
        (it) =>
          it.productId === p.id &&
          it.warehouseCode === whCode &&
          it.locationCode === locationCode,
      )
      .reduce((sum, it) => sum + it.quantity, 0);
    if (locationBalance <= 0) {
      setSubmitError(
        `ສິນຄ້າ ${p.code} ບໍ່ມີ stock ໃນສາງ ${whCode}${locationCode ? ` (${locationCode})` : ""}`,
      );
      return;
    }
    const addQty = options.forcedQuantity ?? 1;
    if (inCartQty + addQty > locationBalance) {
      setSubmitError(
        `ສິນຄ້າ ${p.code} ມີ stock ໃນ ${whCode}/${locationCode} ພຽງ ${locationBalance}${p.unitName ? ` ${p.unitName}` : ""} (ໃນກະຕ່າແລ້ວ ${inCartQty})`,
      );
      return;
    }
    const existingIdx = cur.findIndex(
      (it) =>
        it.productId === p.id &&
        it.warehouseCode === whCode &&
        it.locationCode === locationCode &&
        // Don't fold a fresh add into an existing bonus line — bonus
        // lines are managed by the engine and stay locked.
        !it.promoBonusOfCode,
    );
    if (existingIdx >= 0) {
      const nextTriggerQty = cur
        .filter((it) => it.productId === p.id && !it.promoBonusOfCode)
        .reduce((sum, it) => sum + it.quantity, 0) + addQty;
      const next = [...cur];
      next[existingIdx] = {
        ...next[existingIdx],
        quantity: next[existingIdx].quantity + addQty,
      };
      commitItems(next);
      setSelectedLineIdx(existingIdx);
      setSubmitError(null);
      if (!options.skipPromotionBonus) {
        void maybeAutoAddBogoBonus(p, whCode, locationCode, nextTriggerQty);
      }
      return;
    }
    const newLine: Line = {
      productId: p.id,
      productName: p.name,
      unitName: p.unitName,
      unitPrice: p.price,
      quantity: addQty,
      categoryCode: (p.groupMain || p.category || "").trim() || null,
      warehouseCode: whCode,
      // Pre-set from the picker; fetchLocationsForProduct refreshes the
      // surrounding `locations` list so the user can still switch later.
      locationCode,
      salespersonCode: salespersonCode || me.employeeCode || "",
      locations: [],
      loadingLocations: true,
      warehouseStock: locationBalance,
      locationLoadError: null,
      setDetails: [],
      loadingSetDetails: isAirSetProduct(p),
      setDetailError: null,
      promoBonusOfCode: options.promoBonusOfCode,
      promoId: options.promoId,
    };
    const newIdx = cur.length;
    commitItems([...cur, newLine]);
    setSelectedLineIdx(newIdx);
    setSubmitError(null);
    void fetchLocationsForProduct(newIdx, p.id, whCode);
    if (isAirSetProduct(p)) {
      void fetchSetDetailsForProduct(newIdx, p.id);
    }
    if (!options.skipPromotionBonus) {
      const nextTriggerQty = cur
        .filter((it) => it.productId === p.id && !it.promoBonusOfCode)
        .reduce((sum, it) => sum + it.quantity, 0) + addQty;
      void maybeAutoAddBogoBonus(p, whCode, locationCode, nextTriggerQty);
    }
  }

  // Open the set-build availability modal: fetch per-warehouse component
  // balances and let the cashier see which warehouse has the complete set.
  async function openSetBuilder(p: Product) {
    setSetBuilder({
      product: p,
      loading: true,
      components: [],
      warehouses: [],
      error: null,
    });
    try {
      const res = await fetch(
        `/api/products/${encodeURIComponent(p.id)}/set/availability`,
      );
      if (!res.ok) throw new Error(`set/availability ${res.status}`);
      const data = (await res.json()) as {
        components?: SetComponent[];
        warehouses?: SetWarehouseAvailability[];
      };
      setSetBuilder((prev) =>
        prev && prev.product.id === p.id
          ? {
            ...prev,
            loading: false,
            components: data.components ?? [],
            warehouses: data.warehouses ?? [],
            error: null,
          }
          : prev,
      );
    } catch (err) {
      const msg =
        err instanceof Error ? err.message : "ໂຫລດຂໍ້ມູນຊຸດບໍ່ສຳເລັດ";
      setSetBuilder((prev) =>
        prev && prev.product.id === p.id
          ? { ...prev, loading: false, error: msg }
          : prev,
      );
    }
  }

  // Confirm a build draw: cashier picked a warehouse that has the complete
  // set, so add (or increment) a cart line for that warehouse. Flagged as
  // `buildFromComponents` so the submit-time stock check uses `buildableSets`
  // rather than pre-built balance.
  function confirmSetBuild(warehouseCode: string) {
    if (!setBuilder) return;
    const wh = setBuilder.warehouses.find(
      (w) => w.warehouseCode === warehouseCode,
    );
    if (!wh || wh.status !== "complete" || wh.buildableSets <= 0) return;
    const product = setBuilder.product;
    const existingIdx = items.findIndex(
      (it) => it.productId === product.id && it.warehouseCode === warehouseCode,
    );
    if (existingIdx >= 0) {
      const current = items[existingIdx];
      if (current.quantity + 1 > wh.buildableSets) {
        setSubmitError(
          `ສິນຄ້າ ${product.code} ສ້າງໄດ້ສູງສຸດ ${wh.buildableSets} ຊຸດໃນສາງ ${warehouseCode} (ໃນກະຕ່າແລ້ວ ${current.quantity})`,
        );
        return;
      }
      setItems((prev) => {
        const next = [...prev];
        next[existingIdx] = {
          ...next[existingIdx],
          quantity: next[existingIdx].quantity + 1,
          buildFromComponents: true,
          buildableSets: wh.buildableSets,
        };
        return next;
      });
      setSelectedLineIdx(existingIdx);
    } else {
      const newLine: Line = {
        productId: product.id,
        productName: product.name,
        unitName: product.unitName,
        unitPrice: product.price,
        quantity: 1,
        categoryCode:
          (product.groupMain || product.category || "").trim() || null,
        warehouseCode,
        locationCode: "",
        salespersonCode: salespersonCode || me.employeeCode || "",
        locations: [],
        loadingLocations: true,
        warehouseStock: 0,
        locationLoadError: null,
        setDetails: [],
        loadingSetDetails: true,
        setDetailError: null,
        buildFromComponents: true,
        buildableSets: wh.buildableSets,
      };
      const newIdx = items.length;
      setItems((prev) => [...prev, newLine]);
      setSelectedLineIdx(newIdx);
      void fetchLocationsForProduct(newIdx, product.id, warehouseCode);
      void fetchSetDetailsForProduct(newIdx, product.id);
    }
    setSubmitError(null);
    setSetBuilder(null);
  }

  async function maybeAutoAddBogoBonus(
    triggerProduct: Product,
    whCode: string,
    locationCode: string,
    nextTriggerQty: number,
  ) {
    // Respect the cashier's per-product promo choice: an opted-out trigger
    // (null) adds no bonus; a specific chosen promoId limits the bonus to
    // that promo only; absent → default (all matching BOGO promos apply).
    const choice = promoChoiceRef.current;
    const promos = currentPromotions.filter((promo) => {
      if (promo.promoType !== "bogo") return false;
      if (promo.triggerItemCode?.trim() !== triggerProduct.id) return false;
      if (Object.prototype.hasOwnProperty.call(choice, triggerProduct.id)) {
        const chosen = choice[triggerProduct.id];
        if (chosen == null || chosen === "") return false;
        return String(promo.id) === String(chosen);
      }
      return true;
    });
    for (const promo of promos) {
      const triggerQty = Number(promo.triggerQty ?? 0);
      const bonusQty = Number(promo.bonusQty ?? 0);
      const bonusCode = promo.bonusItemCode?.trim();
      if (!bonusCode || triggerQty <= 0 || bonusQty <= 0) continue;
      // Desired total bonus qty for the current trigger total.
      const desiredBonusQty =
        Math.floor(nextTriggerQty / triggerQty) * bonusQty;
      const promoId = String(promo.id);
      // Find existing bonus line(s) for (promoId, triggerCode).
      const curItems = itemsRef.current;
      const existingBonusLines = curItems.filter(
        (it) =>
          it.promoBonusOfCode === triggerProduct.id &&
          it.promoId === promoId,
      );
      const existingBonusQty = existingBonusLines.reduce(
        (s, it) => s + it.quantity,
        0,
      );
      if (desiredBonusQty === existingBonusQty) continue;
      if (desiredBonusQty < existingBonusQty) {
        // Shrink: reduce the first bonus line first; remove if it hits 0.
        const delta = existingBonusQty - desiredBonusQty;
        const next = [...curItems];
        let remaining = delta;
        for (let i = 0; i < next.length && remaining > 0; i++) {
          const it = next[i];
          if (
            it.promoBonusOfCode === triggerProduct.id &&
            it.promoId === promoId
          ) {
            const take = Math.min(it.quantity, remaining);
            remaining -= take;
            next[i] = { ...it, quantity: it.quantity - take };
          }
        }
        commitItems(next.filter((it) => it.quantity > 0));
        continue;
      }
      // Grow: add (desired - existing) bonus units, picking a location
      // with stock. Trigger's warehouse first, else fall back to best.
      const earnedQty = desiredBonusQty - existingBonusQty;
      const bonusProduct = products.find((product) => product.id === bonusCode);
      if (!bonusProduct) {
        setSubmitError(`Promotion ${promo.name}: ບໍ່ພົບສິນຄ້າແຖມ ${bonusCode}`);
        continue;
      }
      let pickedWh = whCode;
      let pickedLoc = locationCode;
      let balance = 0;
      try {
        balance = await fetchLocationBalance(bonusProduct.id, whCode, locationCode);
        if (balance <= 0) {
          const alt = await fetchBestLocation(bonusProduct.id);
          if (alt) {
            pickedWh = alt.warehouse;
            pickedLoc = alt.location;
            balance = alt.balance;
          }
        }
      } catch (err) {
        setSubmitError(
          err instanceof Error
            ? err.message
            : `Promotion ${promo.name}: ໂຫລດ stock ສິນຄ້າແຖມບໍ່ສຳເລັດ`,
        );
        continue;
      }
      if (balance <= 0) {
        setSubmitError(
          `Promotion ${promo.name}: ບໍ່ມີ stock ສິນຄ້າແຖມ ${bonusProduct.code}`,
        );
        continue;
      }
      // First, top up an existing bonus line if there is one (keeps a
      // single visible bonus row instead of fragmenting on each step).
      if (existingBonusLines.length > 0) {
        const lineIdx = curItems.findIndex(
          (it) =>
            it.promoBonusOfCode === triggerProduct.id &&
            it.promoId === promoId,
        );
        if (lineIdx >= 0) {
          const next = [...curItems];
          next[lineIdx] = {
            ...next[lineIdx],
            quantity: next[lineIdx].quantity + earnedQty,
          };
          commitItems(next);
          continue;
        }
      }
      addProductWithLocation(bonusProduct, pickedWh, pickedLoc, balance, {
        skipPromotionBonus: true,
        promoBonusOfCode: triggerProduct.id,
        promoId,
        forcedQuantity: earnedQty,
      });
    }
  }

  // Used by the auto-bonus path when the bonus has no stock at the trigger's
  // warehouse/location — picks the (warehouse, location) with the largest
  // positive balance so the bonus is still added without prompting.
  async function fetchBestLocation(productId: string): Promise<
    { warehouse: string; location: string; balance: number } | null
  > {
    const res = await fetch("/api/inventory/stock-balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [productId] }),
    });
    if (!res.ok) throw new Error(`stock-balance ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{ locations?: LocationBalance[] }>;
    };
    const locations = data.items?.[0]?.locations ?? [];
    const sellable = locations
      .filter((l) => l.warehouse && l.location && l.balanceQty > 0)
      .sort((a, b) => b.balanceQty - a.balanceQty);
    const top = sellable[0];
    if (!top || !top.warehouse || !top.location) return null;
    return {
      warehouse: top.warehouse,
      location: top.location,
      balance: top.balanceQty,
    };
  }

  async function fetchLocationBalance(
    productId: string,
    whCode: string,
    locationCode: string,
  ) {
    const res = await fetch("/api/inventory/stock-balance", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ codes: [productId], warehouses: [whCode] }),
    });
    if (!res.ok) throw new Error(`stock-balance ${res.status}`);
    const data = (await res.json()) as {
      items?: Array<{ locations?: LocationBalance[] }>;
    };
    const locations = data.items?.[0]?.locations ?? [];
    return (
      locations.find(
        (loc) => loc.warehouse === whCode && loc.location === locationCode,
      )?.balanceQty ?? 0
    );
  }

  // Replace items with the given array and keep the ref in sync. Use
  // this whenever you need the post-update array for an immediate
  // follow-up read (e.g. reconcileBonusForTrigger) — React's batching
  // means the `items` closure variable would otherwise still be stale.
  function commitItems(next: Line[]) {
    itemsRef.current = next;
    setItems(next);
  }

  function updateLine(idx: number, patch: Partial<Line>) {
    const cur = itemsRef.current;
    const line = cur[idx];
    if (!line) return;
    // Bonus lines are managed by the engine — they can't be edited
    // directly. The cashier changes the trigger qty and the bonus
    // recomputes via reconcileBonusForTrigger.
    if (line.promoBonusOfCode && "quantity" in patch) return;
    const updated = { ...line, ...patch };
    if (updated.buildFromComponents) {
      const cap = Math.max(1, Math.floor(updated.buildableSets ?? 1));
      updated.quantity = Math.min(Math.max(1, updated.quantity), cap);
    } else {
      const selectedLocation = updated.locations.find(
        (loc) => loc.location === updated.locationCode,
      );
      if (selectedLocation) {
        updated.quantity = Math.min(
          updated.quantity,
          Math.max(1, Math.floor(selectedLocation.balanceQty)),
        );
      }
    }
    const next = [...cur];
    next[idx] = updated;
    commitItems(next);
    if ("quantity" in patch && !updated.promoBonusOfCode) {
      void reconcileBonusForTrigger(updated.productId);
    }
  }

  // Recompute bonus quantities for every BOGO promo whose trigger is the
  // given product code. Reads from itemsRef so it always sees the latest
  // state, even when called immediately after a state change.
  async function reconcileBonusForTrigger(triggerCode: string) {
    const cur = itemsRef.current;
    const triggerLine = cur.find(
      (it) => it.productId === triggerCode && !it.promoBonusOfCode,
    );
    if (!triggerLine) {
      // Trigger removed — drop every bonus line tagged to it.
      const next = cur.filter((it) => it.promoBonusOfCode !== triggerCode);
      if (next.length !== cur.length) commitItems(next);
      return;
    }
    const triggerProduct = products.find((p) => p.id === triggerCode);
    if (!triggerProduct) return;
    const totalTriggerQty = cur
      .filter((it) => it.productId === triggerCode && !it.promoBonusOfCode)
      .reduce((s, it) => s + it.quantity, 0);
    await maybeAutoAddBogoBonus(
      triggerProduct,
      triggerLine.warehouseCode,
      triggerLine.locationCode,
      totalTriggerQty,
    );
  }

  function removeLine(idx: number) {
    const cur = itemsRef.current;
    const target = cur[idx];
    if (!target) return;
    if (target.promoBonusOfCode) return; // bonus lines are locked
    const next = cur.filter(
      (it, i) => i !== idx && it.promoBonusOfCode !== target.productId,
    );
    commitItems(next);
    // Forget the promo decision for this product so re-adding it asks again.
    if (
      Object.prototype.hasOwnProperty.call(
        promoChoiceRef.current,
        target.productId,
      )
    ) {
      const nextChoice = { ...promoChoiceRef.current };
      delete nextChoice[target.productId];
      promoChoiceRef.current = nextChoice;
      setPromoChoice(nextChoice);
    }
    // Drop any special-price request tied to this product too.
    setPriceRequests((prev) => {
      if (!Object.prototype.hasOwnProperty.call(prev, target.productId)) {
        return prev;
      }
      const next = { ...prev };
      delete next[target.productId];
      return next;
    });
    setSelectedLineIdx((s) => {
      if (s === null) return null;
      if (s === idx) return null;
      return s > idx ? s - 1 : s;
    });
  }

  // Pricing preview. The server recalculates the same promotion rules in
  // /api/orders when saving; this keeps the POS total and submitted order
  // visually aligned before the user presses submit.
  const linePricing = useMemo<EngineLine[]>(() => {
    const customerDiscountPct = customer?.discountPct ?? 0;
    const baseLines: EngineLine[] = items.map((it) => {
      const gross = it.unitPrice * it.quantity;
      const customerDiscount = gross * (customerDiscountPct / 100);
      return {
        productId: it.productId,
        quantity: it.quantity,
        price: it.unitPrice,
        gross,
        customerDiscount,
        promoDiscount: 0,
        promoLabel: "",
        amount: Math.max(0, gross - customerDiscount),
      };
    });
    // Mirror the server's effectivePromos filter so the POS preview matches
    // what /api/orders will actually charge for the cashier's promo choices.
    const effectivePromos = activePromotions.filter((p) => {
      const trig = (p.triggerItemCode ?? "").trim();
      if (!trig) return true;
      if (!Object.prototype.hasOwnProperty.call(promoChoice, trig)) return true;
      const chosen = promoChoice[trig];
      if (chosen == null || chosen === "") return false;
      return String(p.id) === String(chosen);
    });
    const lines = applyPromotions(baseLines, effectivePromos, new Date());
    // Two independent per-promo flags drive the post-processing:
    //   awardsMemberDiscount=false → zero out the member % on this line
    //   awardsPoints=false         → exclude from the earn calc below
    // The two were one toggle before; admin can now opt out of either
    // benefit on its own.
    for (const line of lines) {
      if (line.awardsMemberDiscount === false) {
        line.customerDiscount = 0;
        line.amount = Math.max(0, line.gross - line.promoDiscount);
      }
    }
    return lines;
    // Include the whole customer object in deps so a swap (or fresh
    // membership) re-runs the math even if the discountPct didn't
    // change — covers e.g. picking a member after items are already
    // in the cart.
  }, [items, customer, activePromotions, promoChoice]);
  const afterLineDiscounts = linePricing.reduce((sum, it) => sum + it.amount, 0);
  // Full value before any discount, and the total line-level discount (member
  // % + promo) — surfaced in the summary so the cashier sees gross → discount
  // → net rather than only the post-discount subtotal.
  const grossTotal = linePricing.reduce((sum, it) => sum + it.gross, 0);
  const lineDiscountTotal = Math.max(0, grossTotal - afterLineDiscounts);
  const appliedExtraDiscount = Math.min(
    Math.max(0, extraDiscount || 0),
    afterLineDiscounts,
  );
  const total = afterLineDiscounts - appliedExtraDiscount;
  // Self-pickup ("ລູກຄ້າຮັບເອງ") means there's no delivery, so the
  // "ຊື່ຜູ້ຮັບ / ຈັດສົ່ງ" field is irrelevant and hidden. Matched by name the
  // same way the default transport is seeded on load.
  const isSelfPickup = !!transportTypes
    .find((t) => t.code === transportCode)
    ?.name?.includes("ຮັບເອງ");
  // Walk-in sales (no customer) earn no loyalty points — no account to
  // credit. Lines touched by a promotion with awardsPoints=false also
  // skip the earn — the admin toggle controls whether a promo stacks
  // with member benefits.
  const pointEligibleTotal = Math.max(
    0,
    linePricing.reduce(
      (sum, it) => sum + (it.awardsPoints === false ? 0 : it.amount),
      0,
    ) - appliedExtraDiscount,
  );
  const earnedPoints =
    customer && loyaltyConfig.isActive && loyaltyConfig.earnKipPerPoint > 0
      ? Math.floor(pointEligibleTotal / loyaltyConfig.earnKipPerPoint)
      : 0;
  const totalQty = items.reduce((sum, it) => sum + it.quantity, 0);
  const hasEnoughStock = items.every((it) => {
    // Sets built from components are gated by `buildableSets` (verified live
    // when the set-build modal opened) rather than per-warehouse balance —
    // the warehouse holds zero pre-built sets by design.
    if (it.buildFromComponents) {
      return it.quantity <= Math.max(0, Math.floor(it.buildableSets ?? 0));
    }
    // Live per-location balances (sum across the conditions returned).
    const locationTotal = it.locations.reduce((s, l) => s + l.balanceQty, 0);
    // When the live function has no breakdown OR returns all-zero rows but
    // the cache reports stock, trust the cache (warehouse-level total). This
    // matches the product picker which is also cache-backed.
    if (locationTotal <= 0 && it.warehouseStock > 0) {
      return it.warehouseStock >= it.quantity;
    }
    if (it.locations.length === 0) {
      return it.warehouseStock >= it.quantity;
    }
    const selectedLocation = it.locations.find(
      (loc) => loc.location === it.locationCode,
    );
    if (selectedLocation && selectedLocation.balanceQty >= it.quantity) {
      return true;
    }
    // Fall back to warehouse total if the picked condition is short but
    // the warehouse has enough across all conditions.
    return locationTotal >= it.quantity;
  });

  // Customer is optional — a blank customer settles as a walk-in sale
  // (the orders API treats an empty customerId as walk-in: no member
  // discount, no loyalty earn). Only warehouse, salesperson and at least
  // one in-stock line are required to check out.
  const canSubmit =
    !!warehouseCode &&
    !!salespersonCode &&
    items.length > 0 &&
    items.every(
      (it) =>
        it.quantity > 0 &&
        it.warehouseCode &&
        // Location is required only when actual per-condition stock exists.
        // If everything is zero per live function but cache reports stock,
        // we proceed warehouse-level (locationCode optional). Sets built
        // from components have no pre-built balance at any location so the
        // requirement is waived entirely.
        (it.buildFromComponents ||
          it.locationCode ||
          (it.locations.reduce((s, l) => s + l.balanceQty, 0) <= 0 &&
            it.warehouseStock > 0)),
    ) &&
    hasEnoughStock &&
    !submitting;

  async function submit() {
    if (!canSubmit) return;
    setSubmitError(null);
    setSubmitting(true);
    try {
      const transport = transportTypes.find((t) => t.code === transportCode);
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Empty when walk-in — the orders API reads a blank customerId
          // as a walk-in sale.
          customerId: customer?.id || undefined,
          warehouseCode,
          // Self-pickup has no recipient/delivery — drop the field even if a
          // value was typed before switching transport modes.
          deliveryName: isSelfPickup ? undefined : deliveryName.trim() || undefined,
          transportCode: transportCode || undefined,
          transportName: transport?.name || undefined,
          receiveDate: receiveDate || undefined,
          deliveryRound: deliveryRound || undefined,
          deliveryLocation: deliveryLocation.trim() || undefined,
          note: note.trim() || undefined,
          extraDiscount: appliedExtraDiscount > 0 ? appliedExtraDiscount : undefined,
          salespersonCode: salespersonCode || undefined,
          // Per-trigger promo choices: { triggerCode: promoId | null }. The
          // server keeps only the chosen promo (or drops all when null) so
          // the settled price matches what the cashier picked in the cart.
          promoSelections: promoChoice,
          // Per-item special-price requests: { productId, reason }. The cart
          // settles at the catalog price; these go to app_price_request for a
          // manager to approve and set the agreed price.
          priceRequests: Object.entries(priceRequests).map(
            ([productId, reason]) => ({
              productId,
              reason: reason.trim() || undefined,
            }),
          ),
          // Tag the creation channel so the order/history views can badge it.
          source: "web",
          items: items.map((it) => ({
            productId: it.productId,
            quantity: it.quantity,
            warehouseCode: it.warehouseCode,
            locationCode: it.locationCode,
            // Per-line salesperson. When unset, the server falls back to
            // the cart-level salespersonCode above so existing call sites
            // keep working.
            salespersonCode: it.salespersonCode || undefined,
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => null);
        setSubmitError(data?.error ?? `ສ້າງ Order ຜິດພາດ (${res.status})`);
        setSubmitting(false);
        return;
      }
      const created = await res.json().catch(() => null);
      setItems([]);
      setCustomer(null);
      promoChoiceRef.current = {};
      setPromoChoice({});
      setPriceRequests({});
      setSelectedLineIdx(null);
      setDeliveryName("");
      // Reset to the self-pickup default ("ລູກຄ້າຮັບເອງ"), not blank, so the
      // next sale starts on the most common transport mode.
      setTransportCode(
        transportTypes.find((t) => (t.name ?? "").includes("ຮັບເອງ"))?.code ??
          "",
      );
      setReceiveDate(todayLocalISODate());
      setDeliveryRound("");
      setDeliveryLocation("");
      setNote("");
      setExtraDiscount(0);
      // Keep the extras panel open for the next sale (cashier preference).
      setExtrasOpen(true);
      setSubmitting(false);
      setSuccessNotice({
        cartNumber: String(created?.id ?? created?.cartNumber ?? ""),
      });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : "ສ້າງ Order ຜິດພາດ");
      setSubmitting(false);
    }
  }

  if (loadingData) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-odoo-text-muted">ກຳລັງໂຫລດ...</div>
      </div>
    );
  }
  if (loadError) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-12">
        <div className="odoo-alert-danger p-4">
          <div className="font-bold">ໂຫລດຂໍ້ມູນຜິດພາດ</div>
          <div className="mt-1 text-sm">{loadError}</div>
        </div>
      </div>
    );
  }

  const selectedLine =
    selectedLineIdx !== null ? items[selectedLineIdx] ?? null : null;
  const selectedSalesperson = employees.find(
    (emp) => emp.employeeCode === salespersonCode,
  );
  const salespersonName =
    selectedSalesperson?.fullnameLo?.trim() ||
    selectedSalesperson?.nickname?.trim() ||
    selectedSalesperson?.employeeCode ||
    me.fullnameLo ||
    me.nickname ||
    me.employeeCode ||
    "—";
  const totalQtyUnit =
    items.length > 0 && items.every((line) => isAirSetLine(line))
      ? "ຊຸດ"
      : "ຊິ້ນ";

  return (
    <div className="pos-shell2">
      <div className="pos-order pos-order-left">
        <div className="pos-flow-panel">
          <div className="pos-flow-list">
            <div className={"pos-step-card " + (customer ? "pos-step-done" : "pos-step-active")}>
              <span className="pos-step-badge">1</span>
              <div className="min-w-0">
                <div className="pos-step-title">ລູກຄ້າ</div>
                <div className="pos-step-text">
                  ບໍ່ບັງຄັບ · ຂ້າມໄດ້ (walk-in)
                </div>
              </div>
            </div>
            <div className={"pos-step-card " + (items.length === 0 ? "pos-step-active" : "pos-step-done")}>
              <span className="pos-step-badge">2</span>
              <div className="min-w-0">
                <div className="pos-step-title">ສິນຄ້າ</div>
                <div className="pos-step-text">
                  ເລືອກສິນຄ້າ ແລະ ສາງ
                </div>
              </div>
            </div>
            <div className={"pos-step-card " + (items.length > 0 ? "pos-step-active" : "pos-step-disabled")}>
              <span className="pos-step-badge">3</span>
              <div className="min-w-0">
                <div className="pos-step-title">ກວດສອບ</div>
                <div className="pos-step-text">
                  ຢືນຢັນກ່ອນຮັບເງິນ
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="pos-order-header">
          <div className="pos-order-title">
            <div>
              <div className="text-base font-bold text-odoo-text-strong">ກະຕ່າຂາຍ</div>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <span className="odoo-pill odoo-pill-muted">
                {items.length} ລາຍການ · {moneyFmt.format(totalQty)} {totalQtyUnit}
              </span>
            </div>
          </div>
          {customer ? (
            <button
              type="button"
              onClick={() => {
                setCustomerOpen(true);
                setCustomerQuery("");
              }}
              className="pos-customer-card"
            >
              <div className="min-w-0">
                <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-primary">
                  ລູກຄ້າ
                </div>
                <div className="mt-0.5 truncate font-bold text-odoo-text-strong">
                  {customer.name}
                </div>
                <div className="font-mono text-[11px] text-odoo-text-muted">
                  {customer.id}
                  {customer.phone ? ` · ${customer.phone}` : ""}
                </div>
              </div>
              {customer.discountPct > 0 ? (
                <span className="odoo-pill odoo-pill-success">
                  −{customer.discountPct}%
                </span>
              ) : null}
              <span className="odoo-pill odoo-pill-muted">
                {moneyFmt.format(customer.pointBalance ?? 0)} ແຕ້ມ
              </span>
            </button>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setCustomerOpen(true);
                  setCustomerQuery("");
                }}
                className="pos-customer-empty flex-1"
              >
                + ເລືອກລູກຄ້າ (ສະມາຊິກ)
              </button>
              <div className="text-[11px] text-odoo-text-muted">
                ບໍ່ບັງຄັບ — ຖ້າບໍ່ເລືອກຈະຂາຍແບບ walk-in (ບໍ່ໄດ້ສ່ວນຫຼຸດ/ແຕ້ມ)
              </div>
            </div>
          )}
          <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-odoo-text-muted">
            <span className="truncate">
              ຜູ້ຂາຍ: {salespersonName}
            </span>
            {selectedLine ? (
              <span className="shrink-0 font-mono">
                ເລືອກ #{selectedLineIdx !== null ? selectedLineIdx + 1 : ""}
              </span>
            ) : null}
          </div>
        </div>

        <div className="pos-add-bar">
          <button
            type="button"
            onClick={openProductPicker}
            disabled={loadingProducts}
            className="pos-add-big"
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M12 5v14" />
              <path d="M5 12h14" />
            </svg>
            <span>
              {loadingProducts ? "ກຳລັງໂຫລດສິນຄ້າ..." : "ເພີ່ມສິນຄ້າ"}
            </span>
          </button>
          <button
            type="button"
            onClick={() => setPromoListOpen(true)}
            className="pos-promo-chip pos-add-promo"
            title="ໂປຣໂມຊັນ"
          >
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M20.59 13.41 13 21l-9-9V4h8l8.59 8.59a2 2 0 0 1 0 2.82Z" />
              <circle cx="8" cy="8" r="1.5" />
            </svg>
            <span>ໂປຣ</span>
            {currentPromotions.length > 0 ? (
              <span className="pos-promo-chip-count">{currentPromotions.length}</span>
            ) : null}
          </button>
        </div>

        <div className="pos-order-lines m-3 rounded-2xl border border-slate-200 bg-white shadow-sm">
          {items.length === 0 ? (
            <div className="pos-cart-empty">
              <div className="pos-cart-empty-inner">
                <div className="pos-cart-empty-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="34" height="34" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="9" cy="21" r="1" />
                    <circle cx="20" cy="21" r="1" />
                    <path d="M1 1h4l2.68 13.39a2 2 0 0 0 2 1.61h9.72a2 2 0 0 0 2-1.61L23 6H6" />
                  </svg>
                </div>
                <div className="mt-2 text-sm font-black text-odoo-text-strong">
                  ກະຕ່າຍັງວ່າງ
                </div>
                <div className="mt-1 text-[12px] text-odoo-text-muted">
                  ກົດ “ເພີ່ມສິນຄ້າ” ດ້ານເທິງ ເພື່ອເລືອກສິນຄ້າ ແລະ ເລືອກສາງ/location.
                </div>
              </div>
            </div>
          ) : (
            <table className="pos-cart-table">
              <thead>
                <tr>
                  <th className="pos-cart-th-product">ສິນຄ້າ</th>
                  <th className="pos-cart-th-price">ລາຄາ/ໜ່ວຍ</th>
                  <th className="pos-cart-th-qty">ຈຳນວນ</th>
                  <th className="pos-cart-th-total">ສ່ວນຫຼຸດ / ລວມ</th>
                  <th className="pos-cart-th-seller">ພະນັກງານ / ສາງ</th>
                  <th className="pos-cart-th-actions" aria-hidden></th>
                </tr>
              </thead>
              <tbody>
                {items.map((line, idx) => {
                  const selected = selectedLineIdx === idx;
                  const pricing = linePricing[idx];
                  // Classify the line so cashier can tell at a glance which
                  // item is being sold (with or without a promo price) vs.
                  // which one is being given away for free. The engine
                  // already does the math; we just read amount/discount to
                  // tag the line.
                  const hasPromo = !!pricing && !!pricing.promoLabel;
                  const isFreeBonus =
                    hasPromo &&
                    pricing.gross > 0 &&
                    pricing.amount === 0 &&
                    pricing.promoDiscount >= pricing.gross;
                  const isPromoSold = hasPromo && !isFreeBonus;
                  // Per-line discount (member % + promo) = full value minus
                  // the net the engine resolved. Surfaced in its own column
                  // so the cashier sees price → discount → net per item.
                  const lineDiscount = pricing
                    ? Math.max(0, pricing.gross - pricing.amount)
                    : 0;
                  // Whether this product is flagged for a special-price
                  // request (awaiting manager approval).
                  const hasPriceRequest = Object.prototype.hasOwnProperty.call(
                    priceRequests,
                    line.productId,
                  );
                  return (
                    <Fragment key={`${line.productId}-${idx}`}>
                      <tr
                        onClick={() => setSelectedLineIdx(idx)}
                        className={
                          "pos-cart-row" +
                          (selected ? " pos-cart-row-selected" : "") +
                          (isFreeBonus ? " pos-cart-row-bonus" : "") +
                          (isPromoSold ? " pos-cart-row-promo" : "")
                        }
                      >
                        <td className="pos-cart-cell pos-cart-product">
                          <div className="flex items-center gap-2">
                            <span
                              className={
                                "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide " +
                                (isFreeBonus
                                  ? "bg-emerald-100 text-emerald-700"
                                  : isPromoSold
                                    ? "bg-indigo-100 text-indigo-700"
                                    : "bg-odoo-surface-muted text-odoo-text-muted")
                              }
                            >
                              {isFreeBonus ? "ແຖມ" : isPromoSold ? "ໂປຣ" : "ຂາຍ"}
                            </span>
                            <span className="pos-cart-name text-xs font-semibold text-odoo-text-strong">
                              {line.productName}
                            </span>
                          </div>
                          <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px] font-bold text-odoo-text-muted">
                            <span>{line.productId}</span>
                            {isAirSetLine(line) ? (
                              <span className="pos-unit-badge">ຫົວໜ່ວຍ: ຊຸດ</span>
                            ) : null}
                          </div>
                          {hasPromo ? (
                            <div className="mt-1 text-[10px] font-semibold text-odoo-success">
                              {pricing.promoLabel || "Promotion"}
                            </div>
                          ) : null}
                          {line.promoBonusOfCode ? null : (
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setPriceRequestIdx(idx);
                                setPriceRequestReason(
                                  priceRequests[line.productId] ?? "",
                                );
                              }}
                              className={
                                "mt-1 inline-flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] font-semibold transition " +
                                (hasPriceRequest
                                  ? "border-amber-300 bg-amber-50 text-amber-700"
                                  : "border-odoo-border bg-odoo-surface-muted text-odoo-text-muted hover:border-odoo-primary")
                              }
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3 w-3"
                              >
                                <path d="M20.59 13.41 13 21l-9-9V4h8l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                                <circle cx="8" cy="8" r="1.5" />
                              </svg>
                              <span>
                                {hasPriceRequest
                                  ? "ລໍຖ້າອະນຸມັດລາຄາ"
                                  : "ຂໍລາຄາພິເສດ"}
                              </span>
                            </button>
                          )}
                        </td>
                        <td className="pos-cart-cell pos-cart-price">
                          <span className="font-bold text-odoo-text-strong">
                            {moneyFmt.format(line.unitPrice)}
                          </span>
                          {line.unitName ? (
                            <span className="ml-1 text-[10px] text-odoo-text-muted">
                              / {line.unitName}
                            </span>
                          ) : null}
                        </td>
                        <td className="pos-cart-cell pos-cart-qty">
                          <div className="pos-cart-stepper">
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={line.quantity}
                              disabled={!!line.promoBonusOfCode}
                              onClick={(e) => e.stopPropagation()}
                              onChange={(e) =>
                                updateLine(idx, {
                                  quantity: Math.max(
                                    1,
                                    Math.floor(Number(e.target.value) || 0),
                                  ),
                                })
                              }
                              className={
                                "pos-qty-input" +
                                (line.promoBonusOfCode ? " opacity-60" : "")
                              }
                            />
                          </div>
                        </td>
                        <td className="pos-cart-cell pos-cart-total">
                          <span
                            className={
                              "font-mono text-sm font-bold " +
                              (isFreeBonus
                                ? "text-emerald-700"
                                : isPromoSold
                                  ? "text-odoo-primary"
                                  : "text-odoo-text-strong")
                            }
                          >
                            {moneyFmt.format(pricing ? pricing.amount : line.unitPrice * line.quantity)}
                          </span>
                          {lineDiscount > 0 ? (
                            <div
                              className={
                                "font-mono text-[10px] font-bold " +
                                (isFreeBonus
                                  ? "text-emerald-700"
                                  : "text-odoo-danger")
                              }
                            >
                              − {moneyFmt.format(lineDiscount)}
                            </div>
                          ) : null}
                        </td>
                        <td className="pos-cart-cell pos-cart-seller">
                          <div className="flex flex-col items-start gap-1">
                            <button
                              type="button"
                              onClick={(e) => {
                                e.stopPropagation();
                                setLineSalespersonPickerIdx(idx);
                                setLineSalespersonQuery("");
                              }}
                              className="inline-flex items-center gap-1 rounded border border-odoo-border bg-odoo-surface-muted px-1.5 py-0.5 text-[10px] font-semibold text-odoo-text-strong transition hover:border-odoo-primary"
                              aria-label="ປ່ຽນພະນັກງານຂາຍ"
                            >
                              <svg
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="1.8"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                className="h-3 w-3 text-odoo-text-muted"
                              >
                                <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
                                <circle cx="12" cy="7" r="4" />
                              </svg>
                              <span>
                                {(() => {
                                  const emp = employees.find(
                                    (e) => e.employeeCode === line.salespersonCode,
                                  );
                                  return (
                                    emp?.fullnameLo?.trim() ||
                                    emp?.nickname?.trim() ||
                                    emp?.employeeCode ||
                                    line.salespersonCode ||
                                    "ເລືອກພະນັກງານ"
                                  );
                                })()}
                              </span>
                            </button>
                            {line.loadingLocations ? (
                              <span className="text-[10px] text-odoo-text-muted">
                                ກຳລັງໂຫລດ stock...
                              </span>
                            ) : line.buildFromComponents ? null : line.locations.length === 0 ? (
                              line.warehouseStock > 0 ? (
                                <span className="text-[10px] text-odoo-text-muted">
                                  ສາງ {warehouseNames[line.warehouseCode] ?? line.warehouseCode}
                                </span>
                              ) : (
                                <span className="text-[10px] font-semibold text-odoo-danger">
                                  ບໍ່ມີ stock
                                </span>
                              )
                            ) : (() => {
                              // Hide conditions with zero balance. When the live
                              // function shows nothing but the warehouse cache
                              // does, synthesize a single "ສະພາບດີ" row so the
                              // cart line stays visually consistent (always a
                              // dropdown, never a plain text fallback).
                              const nonEmpty = line.locations.filter(
                                (l) => l.balanceQty > 0,
                              );
                              const options: Array<{
                                code: string;
                                name: string;
                                qty: number;
                              }> =
                                nonEmpty.length > 0
                                  ? nonEmpty.map((l) => ({
                                    code: l.location ?? "",
                                    name: l.locationName ?? l.location ?? "—",
                                    qty: l.balanceQty,
                                  }))
                                  : line.warehouseStock > 0
                                    ? [
                                      {
                                        code: "",
                                        name: "ສະພາບດີ",
                                        qty: line.warehouseStock,
                                      },
                                    ]
                                    : [];
                              if (options.length === 0) {
                                return (
                                  <span className="text-[10px] font-semibold text-odoo-danger">
                                    ບໍ່ມີ stock
                                  </span>
                                );
                              }
                              const sel = options.find(
                                (o) => o.code === line.locationCode,
                              );
                              const isGoodCondition =
                                sel?.code === "" || sel?.code.endsWith("01");
                              return (
                                <span
                                  className={
                                    "text-[10px] font-semibold " +
                                    (sel && !isGoodCondition
                                      ? "text-odoo-warning"
                                      : "text-odoo-text-muted")
                                  }
                                >
                                  ສາງ {warehouseNames[line.warehouseCode] ?? line.warehouseCode}
                                  {" · "}
                                  {sel?.name ?? "—"}
                                  {" · "}
                                  {moneyFmt.format(sel?.qty ?? line.warehouseStock)}
                                </span>
                              );
                            })()}
                            {(() => {
                              const selectedLocation = line.locations.find(
                                (loc) => loc.location === line.locationCode,
                              );
                              if (!selectedLocation || selectedLocation.balanceQty >= line.quantity) return null;
                              return (
                                <span className="text-[10px] font-semibold text-odoo-danger">
                                  stock ບໍ່ພໍ
                                </span>
                              );
                            })()}
                          </div>
                        </td>
                        <td className="pos-cart-cell pos-cart-actions">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeLine(idx);
                            }}
                            disabled={!!line.promoBonusOfCode}
                            className="pos-iconbtn text-odoo-danger hover:bg-odoo-danger-bg"
                            aria-label="ລົບ"
                            title={line.promoBonusOfCode ? "ສິນຄ້າແຖມ — ລົບສິນຄ້າຫຼັກເພື່ອລົບແຖມ" : undefined}
                          >
                            ✕
                          </button>
                        </td>
                      </tr>
                      {selected && isAirSetLine(line) ? (
                        <tr className="pos-cart-detail-tr">
                          <td colSpan={6} className="pos-cart-detail-cell">
                            <div className="pos-set-detail">
                              <div className="pos-set-detail-head">
                                <span>ລາຍລະອຽດຊຸດ</span>
                                <strong>{line.setDetails.length} ລາຍການ</strong>
                              </div>
                              {line.loadingSetDetails ? (
                                <div className="pos-set-detail-empty">
                                  ກຳລັງໂຫລດລາຍລະອຽດຊຸດ...
                                </div>
                              ) : line.setDetailError ? (
                                <div className="pos-set-detail-error">
                                  {line.setDetailError}
                                </div>
                              ) : line.setDetails.length === 0 ? (
                                <div className="pos-set-detail-empty">
                                  ບໍ່ພົບລາຍການພາຍໃນຊຸດ
                                </div>
                              ) : (
                                <div className="pos-set-detail-list">
                                  {line.setDetails.map((detail) => (
                                    <div
                                      key={`${detail.lineNumber}-${detail.itemCode}`}
                                      className="pos-set-detail-row"
                                    >
                                      <div className="min-w-0">
                                        <div className="truncate font-semibold text-odoo-text-strong">
                                          {detail.itemName}
                                        </div>
                                        <div className="font-mono text-[10px] text-odoo-text-muted">
                                          {detail.itemCode}
                                        </div>
                                      </div>
                                      <div className="text-right font-mono text-[11px] font-bold text-odoo-text-strong">
                                        {moneyFmt.format(detail.quantity * line.quantity)}
                                        {detail.unitCode ? ` ${detail.unitCode}` : ""}
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <aside className="pos-checkout-col">
        <div className="pos-order-summary pos-checkout-card">
          <div className="px-4 py-3">
            <div className="space-y-1 text-sm">
              {/* Gross before any discount, then the line-level discount,
                  then the post-discount subtotal — so the cashier sees the
                  full → discount → net breakdown. */}
              <SummaryRow
                label="ມູນຄ່າເຕັມ (ກ່ອນຫຼຸດ)"
                value={moneyFmt.format(grossTotal)}
              />
              {lineDiscountTotal > 0 ? (
                <SummaryRow
                  label="ສ່ວນຫຼຸດ"
                  value={`− ${moneyFmt.format(lineDiscountTotal)}`}
                />
              ) : null}
              <SummaryRow
                label="ລວມລາຍການ"
                value={moneyFmt.format(afterLineDiscounts)}
              />
              {appliedExtraDiscount > 0 ? (
                <SummaryRow
                  label="ສ່ວນຫຼຸດທ້າຍບິນ"
                  value={`− ${moneyFmt.format(appliedExtraDiscount)}`}
                />
              ) : null}
              {customer && loyaltyConfig.isActive && earnedPoints > 0 ? (
                <SummaryRow
                  label={`ໄດ້${loyaltyConfig.pointName ?? "ແຕ້ມສະສົມ"}`}
                  value={`${moneyFmt.format(earnedPoints)} ແຕ້ມ`}
                />
              ) : null}
              <div className="pos-total-line">
                <div className="text-xs font-bold uppercase tracking-widest text-odoo-text-strong">
                  ລວມຍອດ
                </div>
                <div className="flex items-baseline gap-1.5">
                  <div className="font-mono text-2xl font-bold text-odoo-primary">
                    {moneyFmt.format(total)}
                  </div>
                  <div className="text-xs font-semibold text-odoo-text-muted">
                    ກີບ
                  </div>
                </div>
              </div>
            </div>

            {/* ຂົນສົ່ງ · ໝາຍເຫດ — ຍ້າຍລົງລຸ່ມຍອດລວມ */}
            <div className="mt-3 overflow-hidden rounded-md border border-odoo-border">
              <button
                type="button"
                onClick={() => setExtrasOpen((v) => !v)}
                className="flex w-full items-center justify-between gap-2 bg-odoo-surface-muted px-3 py-2.5 text-left text-[12px] font-bold text-odoo-text-strong transition hover:brightness-95"
              >
                <span className="flex items-center gap-2">
                  <svg
                    viewBox="0 0 24 24"
                    width="15"
                    height="15"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden
                  >
                    <rect x="1" y="3" width="15" height="13" rx="1" />
                    <path d="M16 8h4l3 3v5h-7z" />
                    <circle cx="5.5" cy="18.5" r="2" />
                    <circle cx="18.5" cy="18.5" r="2" />
                  </svg>
                  <span>ຂົນສົ່ງ · ໝາຍເຫດ</span>
                </span>
                <span className="text-odoo-text-muted">
                  {extrasOpen ? "▲" : "▼"}
                </span>
              </button>
              {extrasOpen ? (
                <div className="border-t border-odoo-border bg-odoo-surface-muted px-3 py-3">
                  <div className="pos-extras-grid">
                    <div>
                      <label className="odoo-label">ຂົນສົ່ງ</label>
                      <select
                        value={transportCode}
                        onChange={(e) => setTransportCode(e.target.value)}
                        className="odoo-input"
                      >
                        <option value="">ເລືອກຂົນສົ່ງ</option>
                        {transportTypes.map((t) => (
                          <option key={t.code} value={t.code}>
                            {t.name}
                          </option>
                        ))}
                      </select>
                    </div>
                    {isSelfPickup ? null : (
                      <div>
                        <label className="odoo-label">ຊື່ຜູ້ຮັບ / ຈັດສົ່ງ</label>
                        <input
                          type="text"
                          value={deliveryName}
                          onChange={(e) => setDeliveryName(e.target.value)}
                          className="odoo-input"
                          placeholder="ບໍ່ບັງຄັບ"
                        />
                      </div>
                    )}
                    <div>
                      <label className="odoo-label">ວັນຮັບສິນຄ້າ</label>
                      <input
                        type="date"
                        value={receiveDate}
                        onChange={(e) => setReceiveDate(e.target.value)}
                        className="odoo-input"
                      />
                    </div>
                    <div className="col-span-full">
                      <label className="odoo-label">ໝາຍເຫດ</label>
                      <textarea
                        value={note}
                        onChange={(e) => setNote(e.target.value)}
                        rows={2}
                        className="odoo-textarea"
                        placeholder="ບໍ່ບັງຄັບ"
                      />
                    </div>
                  </div>
                </div>
              ) : null}
            </div>

            {submitError ? (
              <div className="odoo-alert-danger mt-2 px-3 py-2 text-xs font-semibold">
                {submitError}
              </div>
            ) : null}

            <div className="pos-action-row">
              <button
                type="button"
                onClick={() => {
                  if (selectedLineIdx !== null) removeLine(selectedLineIdx);
                }}
                disabled={selectedLineIdx === null}
                className="pos-iconaction pos-iconaction-danger"
                title="ລົບລາຍການທີ່ເລືອກ"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 6h18" />
                  <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                  <path d="m5 6 1 14a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2l1-14" />
                </svg>
              </button>
              <button
                type="button"
                onClick={() => {
                  setItems([]);
                  setSelectedLineIdx(null);
                }}
                disabled={items.length === 0}
                className="pos-iconaction"
                title="ລ້າງກະຕ່າທັງໝົດ"
              >
                <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M3 3v5h5" />
                  <path d="M3.5 13a9 9 0 1 0 .8-5" />
                </svg>
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={!canSubmit}
                className="pos-cta"
              >
                <span>{submitting ? "ກຳລັງສ້າງ..." : "ສົ່ງໄປຮັບເງິນ"}</span>
                <span aria-hidden>→</span>
              </button>
            </div>
          </div>
        </div>
      </aside>

      {/* Customer picker overlay */}
      {productPickerOpen ? (
        <ProductPickerModal
          query={productPickerQuery}
          setQuery={setProductPickerQuery}
          products={productPickerProducts}
          selectedProduct={productPickerProduct}
          options={productPickerOptions}
          loadingProducts={loadingProducts}
          loadingOptions={productPickerLoading}
          error={productPickerError}
          onPickProduct={pickProductForModal}
          onPickLocation={addPickedProduct}
          onClose={closeProductPicker}
        />
      ) : null}
      {customerOpen ? (
        <CustomerPicker
          query={customerQuery}
          setQuery={setCustomerQuery}
          matches={customerMatches}
          loading={loadingCustomers}
          required={false}
          onPick={startOrderForCustomer}
          onAddNew={() => setNewMemberOpen(true)}
          onClose={() => setCustomerOpen(false)}
        />
      ) : null}
      {newMemberOpen ? (
        <NewMemberForm
          onCreated={(c) => {
            setCustomers((prev) => [c, ...prev.filter((p) => p.id !== c.id)]);
            startOrderForCustomer(c);
            setNewMemberOpen(false);
          }}
          onClose={() => setNewMemberOpen(false)}
        />
      ) : null}
      {successNotice ? (
        <SuccessModal
          cartNumber={successNotice.cartNumber}
          onClose={() => setSuccessNotice(null)}
        />
      ) : null}
      {whPicker ? (
        <WarehouseLocationPickerModal
          product={whPicker.product}
          options={whPicker.options}
          onPick={(opt) => {
            const product = whPicker.product;
            setWhPicker(null);
            addProductWithLocation(
              product,
              opt.warehouseCode,
              opt.locationCode,
              opt.balance,
            );
          }}
          onClose={() => setWhPicker(null)}
        />
      ) : null}
      {whPickerLoading ? (
        <div className="fixed inset-0 z-[55] flex items-center justify-center bg-black/30">
          <div className="rounded-md bg-white px-5 py-3 text-sm font-semibold text-odoo-text-strong shadow-lg">
            ກຳລັງໂຫລດ stock...
          </div>
        </div>
      ) : null}
      {setBuilder ? (
        <SetBuilderModal
          state={setBuilder}
          onPickWarehouse={confirmSetBuild}
          onClose={() => setSetBuilder(null)}
        />
      ) : null}
      {promoListOpen ? (
        <PromotionListModal
          promotions={currentPromotions}
          products={products}
          onPick={(promo) => {
            const triggerCode = promo.triggerItemCode?.trim();
            if (!triggerCode) {
              setSubmitError(`ໂປຣ ${promo.name}: ບໍ່ມີສິນຄ້າຂາຍ`);
              return;
            }
            const triggerProduct = products.find(
              (p) => p.id === triggerCode,
            );
            if (!triggerProduct) {
              setSubmitError(
                `ໂປຣ ${promo.name}: ບໍ່ພົບສິນຄ້າ ${triggerCode} ໃນ catalog`,
              );
              return;
            }
            setPromoListOpen(false);
            // Picking from the promo list is an explicit "use this promo"
            // action — record the choice so pricing + settlement honour it.
            setPromoChoiceFor(triggerCode, String(promo.id));
            // addProduct handles the picker + stock check + auto-adds the
            // BOGO bonus afterwards, so one click on a promotion lands
            // both lines in the cart ready to settle.
            void addProduct(triggerProduct);
          }}
          onClose={() => setPromoListOpen(false)}
        />
      ) : null}
      {lineSalespersonPickerIdx !== null ? (() => {
        const idx = lineSalespersonPickerIdx;
        const target = items[idx];
        if (!target) return null;
        const q = lineSalespersonQuery.trim().toLowerCase();
        const matches = q
          ? employees.filter(
            (emp) =>
              (emp.fullnameLo ?? "").toLowerCase().includes(q) ||
              (emp.fullnameEn ?? "").toLowerCase().includes(q) ||
              (emp.nickname ?? "").toLowerCase().includes(q) ||
              (emp.employeeCode ?? "").toLowerCase().includes(q),
          )
          : employees;
        return (
          <ToolbarPickerModal
            title="ເລືອກພະນັກງານຂາຍ"
            query={lineSalespersonQuery}
            setQuery={setLineSalespersonQuery}
            options={matches.map((emp) => ({
              id: emp.employeeCode ?? "",
              primary:
                (emp.fullnameLo?.trim() ||
                  emp.nickname?.trim() ||
                  emp.employeeCode) ??
                "—",
              secondary:
                emp.employeeCode === me.employeeCode
                  ? `${emp.employeeCode ?? ""} · ຂ້ອຍ`
                  : emp.employeeCode ?? "",
            }))}
            selectedId={target.salespersonCode}
            onPick={(id) => {
              updateLine(idx, { salespersonCode: id });
              setLineSalespersonPickerIdx(null);
              setLineSalespersonQuery("");
            }}
            onClose={() => {
              setLineSalespersonPickerIdx(null);
              setLineSalespersonQuery("");
            }}
          />
        );
      })() : null}
      {priceRequestIdx !== null ? (() => {
        const target = items[priceRequestIdx];
        if (!target) return null;
        const existing = Object.prototype.hasOwnProperty.call(
          priceRequests,
          target.productId,
        );
        const close = () => {
          setPriceRequestIdx(null);
          setPriceRequestReason("");
        };
        return (
          <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
            <button
              type="button"
              aria-label="ປິດ"
              className="absolute inset-0 cursor-default"
              onClick={close}
            />
            <div className="relative w-full max-w-md overflow-hidden rounded-md bg-white shadow-xl">
              <header className="border-b border-odoo-border px-5 py-4">
                <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
                  ຂໍລາຄາພິເສດ
                </div>
                <div className="mt-1 text-base font-bold text-odoo-text-strong">
                  {target.productName}
                </div>
                <div className="font-mono text-[11px] text-odoo-text-muted">
                  {target.productId}
                </div>
              </header>
              <div className="px-5 py-4">
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-[12px] font-semibold text-amber-700">
                  ບິນຈະອອກໃນລາຄາປົກກະຕິກ່ອນ — ລາຄາພິເສດຈະນຳໃຊ້ເມື່ອຜູ້ຈັດການອະນຸມັດ
                </div>
                <label className="mt-3 grid gap-1">
                  <span className="odoo-label">ເຫດຜົນ (ບໍ່ບັງຄັບ)</span>
                  <textarea
                    value={priceRequestReason}
                    onChange={(e) => setPriceRequestReason(e.target.value)}
                    rows={3}
                    className="odoo-textarea"
                    placeholder="ເຊັ່ນ: ລູກຄ້າຕໍ່ລາຄາ, ຊື້ຈຳນວນຫຼາຍ..."
                    autoFocus
                  />
                </label>
              </div>
              <footer className="flex items-center justify-between gap-3 border-t border-odoo-border px-5 py-3">
                {existing ? (
                  <button
                    type="button"
                    onClick={() => {
                      setPriceRequests((prev) => {
                        const next = { ...prev };
                        delete next[target.productId];
                        return next;
                      });
                      close();
                    }}
                    className="odoo-btn odoo-btn-secondary text-odoo-danger"
                  >
                    ຍົກເລີກຄຳຂໍ
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={close}
                    className="odoo-btn odoo-btn-secondary"
                  >
                    ປິດ
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPriceRequests((prev) => ({
                        ...prev,
                        [target.productId]: priceRequestReason.trim(),
                      }));
                      close();
                    }}
                    className="odoo-btn odoo-btn-primary"
                  >
                    {existing ? "ບັນທຶກ" : "ສົ່ງຄຳຂໍ"}
                  </button>
                </div>
              </footer>
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}

function SuccessModal({
  cartNumber,
  onClose,
}: {
  cartNumber: string;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="ປິດ modal"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-sm rounded-md border border-odoo-success-border bg-white p-6 text-center shadow-xl">
        <div className="mx-auto inline-flex h-14 w-14 items-center justify-center rounded-md bg-odoo-success text-3xl font-bold text-white">
          ✓
        </div>
        <h2 className="mt-4 text-lg font-bold text-odoo-success">
          ສົ່ງໄປຮັບເງິນສຳເລັດ
        </h2>
        {cartNumber ? (
          <div className="mt-3 text-sm text-odoo-text">
            ເລກບິນ
            <span className="ml-2 font-mono text-base font-bold text-odoo-text-strong">
              #{cartNumber}
            </span>
          </div>
        ) : null}
        <div className="mt-1 text-sm text-odoo-text-muted">
          ກະຕ່າຖືກລ້າງແລ້ວ
        </div>
        <button
          type="button"
          onClick={onClose}
          className="odoo-btn odoo-btn-primary mt-5 w-full justify-center"
        >
          ຕົກລົງ
        </button>
      </div>
    </div>
  );
}

// Shared modal — used by the per-line salesperson picker. `query`/`setQuery`
// are optional in case a future caller wants a no-search variant.
function ToolbarPickerModal({
  title,
  query,
  setQuery,
  options,
  selectedId,
  onPick,
  onClose,
}: {
  title: string;
  query?: string;
  setQuery?: (v: string) => void;
  options: Array<{ id: string; primary: string; secondary: string }>;
  selectedId: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-md bg-white shadow-xl">
        <header className="border-b border-odoo-border px-5 py-4">
          <div className="text-sm font-bold text-odoo-text-strong">{title}</div>
        </header>
        {setQuery ? (
          <div className="border-b border-odoo-border px-5 py-3">
            <input
              type="text"
              autoFocus
              value={query ?? ""}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="ຄົ້ນຫາ..."
              className="odoo-input w-full"
            />
          </div>
        ) : null}
        <ul className="max-h-[60vh] divide-y divide-odoo-border overflow-y-auto">
          {options.length === 0 ? (
            <li className="px-5 py-6 text-center text-sm text-odoo-text-muted">
              ບໍ່ພົບ
            </li>
          ) : (
            options.map((opt) => (
              <li key={opt.id}>
                <button
                  type="button"
                  onClick={() => onPick(opt.id)}
                  className={
                    "flex w-full items-center justify-between px-5 py-3 text-left transition hover:bg-odoo-primary-50 " +
                    (opt.id === selectedId ? "bg-odoo-primary-50" : "")
                  }
                >
                  <div>
                    <div className="text-sm font-bold text-odoo-text-strong">
                      {opt.primary}
                    </div>
                    <div className="font-mono text-[11px] text-odoo-text-muted">
                      {opt.secondary}
                    </div>
                  </div>
                  {opt.id === selectedId ? (
                    <svg
                      viewBox="0 0 24 24"
                      fill="none"
                      stroke="currentColor"
                      strokeWidth="2.2"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      className="h-4 w-4 text-odoo-primary"
                    >
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  ) : null}
                </button>
              </li>
            ))
          )}
        </ul>
        <footer className="border-t border-odoo-border px-5 py-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="odoo-btn odoo-btn-secondary"
          >
            ຍົກເລີກ
          </button>
        </footer>
      </div>
    </div>
  );
}

function SummaryRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="text-odoo-text-muted">{label}</div>
      <div className="font-mono font-semibold text-odoo-text-strong">
        {value}
      </div>
    </div>
  );
}

// One row per (warehouse, location) — the salesperson picks both in a
// single tap. Mirrors the Flutter add-to-cart sheet.
type WhLocOption = {
  warehouseCode: string;
  warehouseName: string;
  locationCode: string;
  locationName: string;
  balance: number;
};

function ProductPickerModal({
  query,
  setQuery,
  products,
  selectedProduct,
  options,
  loadingProducts,
  loadingOptions,
  error,
  onPickProduct,
  onPickLocation,
  onClose,
}: {
  query: string;
  setQuery: (q: string) => void;
  products: Product[];
  selectedProduct: Product | null;
  options: WhLocOption[];
  loadingProducts: boolean;
  loadingOptions: boolean;
  error: string | null;
  onPickProduct: (p: Product) => void;
  onPickLocation: (opt: WhLocOption) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/45 p-0 backdrop-blur-sm sm:items-center sm:p-4">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="product-picker-modal relative flex h-[92dvh] w-full max-w-5xl flex-col overflow-hidden rounded-t-2xl border border-odoo-border bg-white shadow-2xl sm:h-[82dvh] sm:rounded-2xl">
        <header className="flex items-center justify-between gap-3 border-b border-odoo-border bg-white px-4 py-3">
          <div className="min-w-0">
            <div className="text-base font-black text-odoo-text-strong">
              ເພີ່ມສິນຄ້າ
            </div>
            <div className="mt-0.5 text-[11px] font-semibold text-odoo-text-muted">
              1. ເລືອກສິນຄ້າ · 2. ເລືອກສາງ/location · 3. ເຂົ້າ cart
            </div>
          </div>
          <button type="button" onClick={onClose} className="odoo-btn odoo-btn-secondary">
            ປິດ
          </button>
        </header>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
          <section className="flex min-h-0 flex-col border-b border-odoo-border md:border-b-0 md:border-r">
            <div className="border-b border-odoo-border p-3">
              <div className="pos-search-wrap">
                <span className="pos-search-icon" aria-hidden>
                  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="7" />
                    <path d="m20 20-3-3" />
                  </svg>
                </span>
                <input
                  type="text"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="ຄົ້ນຫາສິນຄ້າ / barcode / ລະຫັດ..."
                  className="pos-search-input"
                  autoFocus
                />
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto bg-odoo-surface-muted p-3">
              {loadingProducts ? (
                <div className="pos-empty-state">ກຳລັງໂຫລດສິນຄ້າ...</div>
              ) : products.length === 0 ? (
                <div className="pos-empty-state">ບໍ່ພົບສິນຄ້າ</div>
              ) : (
                <div className="product-picker-grid">
                  {products.map((p) => {
                    const selected = selectedProduct?.id === p.id;
                    const out = p.stock <= 0 && !isAirSetProduct(p);
                    return (
                      <button
                        key={p.id}
                        type="button"
                        onClick={() => onPickProduct(p)}
                        disabled={out}
                        className={
                          "product-picker-item " +
                          (selected ? "product-picker-item-active " : "") +
                          (out ? "product-picker-item-disabled" : "")
                        }
                      >
                        <div className="min-w-0">
                          <div className="product-picker-name">
                            {p.name}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 font-mono text-[10px] font-bold text-odoo-text-muted">
                            <span>{p.code}</span>
                            {p.brand ? <span>{p.brand}</span> : null}
                            {isAirSetProduct(p) ? <span className="pos-unit-badge">ຊຸດ</span> : null}
                          </div>
                        </div>
                        <div className="mt-3 flex items-end justify-between gap-2">
                          <span
                            className={
                              "rounded-full px-2 py-1 text-[10px] font-black " +
                              (out
                                ? "bg-odoo-danger-bg text-odoo-danger"
                                : "bg-odoo-success-bg text-odoo-success-text")
                            }
                          >
                            {isAirSetProduct(p)
                              ? "ປະກອບຊຸດ"
                              : out
                                ? "ໝົດ stock"
                                : `stock ${moneyFmt.format(p.stock)}`}
                          </span>
                          <span className="font-mono text-[15px] font-black text-odoo-text-strong">
                            {moneyFmt.format(p.price)}
                          </span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>

          <section className="flex min-h-0 flex-col bg-white">
            <div className="border-b border-odoo-border px-4 py-3">
              <div className="text-sm font-black text-odoo-text-strong">
                ເລືອກສາງ / location
              </div>
              <div className="mt-0.5 text-[11px] font-semibold text-odoo-text-muted">
                {selectedProduct
                  ? `${selectedProduct.code} · ${selectedProduct.name}`
                  : "ເລືອກສິນຄ້າກ່ອນ"}
              </div>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {!selectedProduct ? (
                <div className="pos-empty-state">ເລືອກສິນຄ້າຈາກລາຍການກ່ອນ</div>
              ) : loadingOptions ? (
                <div className="pos-empty-state">ກຳລັງໂຫລດ stock...</div>
              ) : error ? (
                <div className="odoo-alert-danger text-sm font-semibold">{error}</div>
              ) : options.length === 0 ? (
                <div className="pos-empty-state">ບໍ່ພົບ stock ສຳລັບສິນຄ້ານີ້</div>
              ) : (
                <div className="grid gap-2">
                  {options.map((opt) => {
                    const empty = opt.balance <= 0;
                    return (
                      <button
                        key={`${opt.warehouseCode}-${opt.locationCode || "warehouse"}`}
                        type="button"
                        onClick={() => onPickLocation(opt)}
                        disabled={empty}
                        className={
                          "product-picker-location " +
                          (empty ? "product-picker-location-disabled" : "")
                        }
                      >
                        <div className="min-w-0">
                          <div className="truncate text-sm font-black text-odoo-text-strong">
                            {opt.warehouseName}
                          </div>
                          <div className="font-mono text-[11px] font-semibold text-odoo-text-muted">
                            ສາງ {opt.warehouseCode}
                            {opt.locationCode ? ` · ${opt.locationName}` : ""}
                          </div>
                        </div>
                        <div className="shrink-0 text-right">
                          <div
                            className={
                              "font-mono text-base font-black " +
                              (empty ? "text-odoo-danger" : "text-odoo-success-text")
                            }
                          >
                            {empty ? "0" : moneyFmt.format(opt.balance)}
                          </div>
                          <div className="text-[10px] font-bold text-odoo-text-muted">
                            {empty ? "ບໍ່ມີ stock" : "ກົດເພີ່ມ"}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function WarehouseLocationPickerModal({
  product,
  options,
  onPick,
  onClose,
}: {
  product: Product;
  options: WhLocOption[];
  onPick: (opt: WhLocOption) => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-md bg-white shadow-xl">
        <header className="border-b border-odoo-border px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
            ເລືອກສາງ ແລະ ສະພາບ
          </div>
          <div className="mt-1 text-base font-bold text-odoo-text-strong">
            {product.name}
          </div>
          <div className="font-mono text-[11px] text-odoo-text-muted">
            {product.code}
          </div>
        </header>
        <ul className="max-h-[60vh] divide-y divide-odoo-border overflow-y-auto">
          {options.map((opt) => {
            // Empty rows still render so the user sees every existing
            // (warehouse, location) — they just can't be picked. Matches
            // the "list shows everything" UX requested.
            const empty = opt.balance <= 0;
            return (
              <li key={`${opt.warehouseCode}-${opt.locationCode}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (!empty) onPick(opt);
                  }}
                  disabled={empty}
                  className={
                    "flex w-full items-center justify-between px-5 py-3 text-left transition " +
                    (empty
                      ? "cursor-not-allowed opacity-50"
                      : "hover:bg-odoo-primary-50")
                  }
                >
                  <div className="min-w-0">
                    <div className="truncate text-sm font-bold text-odoo-text-strong">
                      {opt.warehouseName}
                    </div>
                    <div className="font-mono text-[11px] text-odoo-text-muted">
                      ສາງ {opt.warehouseCode} · {opt.locationName}
                    </div>
                  </div>
                  <div
                    className={
                      "ml-3 shrink-0 font-mono text-sm font-bold " +
                      (empty
                        ? "text-odoo-text-muted"
                        : "text-odoo-text-strong")
                    }
                  >
                    {empty ? "ບໍ່ມີ stock" : moneyFmt.format(opt.balance)}
                    {!empty && product.unitName ? (
                      <span className="ml-1 text-[10px] font-semibold text-odoo-text-muted">
                        {product.unitName}
                      </span>
                    ) : null}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
        <footer className="border-t border-odoo-border px-5 py-3 text-right">
          <button
            type="button"
            onClick={onClose}
            className="odoo-btn odoo-btn-secondary"
          >
            ຍົກເລີກ
          </button>
        </footer>
      </div>
    </div>
  );
}

function SetBuilderModal({
  state,
  onPickWarehouse,
  onClose,
}: {
  state: {
    product: Product;
    loading: boolean;
    components: SetComponent[];
    warehouses: SetWarehouseAvailability[];
    error: string | null;
  };
  onPickWarehouse: (warehouseCode: string) => void;
  onClose: () => void;
}) {
  const { product, loading, components, warehouses, error } = state;
  const completeCount = warehouses.filter((w) => w.status === "complete").length;

  function componentName(itemCode: string) {
    return (
      components.find((c) => c.itemCode === itemCode)?.itemName ?? itemCode
    );
  }
  function componentUnit(itemCode: string) {
    return components.find((c) => c.itemCode === itemCode)?.unitCode ?? null;
  }
  function componentRequired(itemCode: string) {
    return (
      components.find((c) => c.itemCode === itemCode)?.requiredPerSet ?? 0
    );
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 px-4">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-md bg-white shadow-xl">
        <header className="border-b border-odoo-border px-5 py-4">
          <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
            ກວດເບີ່ງສາງທີ່ປະກອບຊຸດໄດ້
          </div>
          <div className="mt-1 text-base font-bold text-odoo-text-strong">
            {product.name}
          </div>
          <div className="font-mono text-[11px] text-odoo-text-muted">
            {product.code} · {components.length} ສ່ວນປະກອບ
          </div>
        </header>
        <div className="max-h-[65vh] overflow-y-auto">
          {loading ? (
            <div className="px-5 py-8 text-center text-sm text-odoo-text-muted">
              ກຳລັງກວດເບີ່ງສ່ວນປະກອບໃນທຸກສາງ...
            </div>
          ) : error ? (
            <div className="px-5 py-6 text-center text-sm font-semibold text-odoo-danger">
              {error}
            </div>
          ) : warehouses.length === 0 ? (
            <div className="px-5 py-6 text-center text-sm text-odoo-text-muted">
              ບໍ່ພົບສາງສຳລັບກວດເບີ່ງ
            </div>
          ) : (
            <ul className="divide-y divide-odoo-border">
              {warehouses.map((w) => {
                const statusLabel =
                  w.status === "complete"
                    ? `ຄົບຊຸດ · ສ້າງໄດ້ ${moneyFmt.format(w.buildableSets)}`
                    : w.status === "incomplete"
                      ? "ບໍ່ຄົບ"
                      : "ບໍ່ມີ";
                const statusClass =
                  w.status === "complete"
                    ? "bg-emerald-100 text-emerald-700"
                    : w.status === "incomplete"
                      ? "bg-amber-100 text-amber-700"
                      : "bg-rose-100 text-rose-700";
                const isComplete = w.status === "complete";
                return (
                  <li key={w.warehouseCode} className="px-5 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-bold text-odoo-text-strong">
                          {w.warehouseName}
                        </div>
                        <div className="font-mono text-[11px] text-odoo-text-muted">
                          ສາງ {w.warehouseCode}
                        </div>
                      </div>
                      <span
                        className={
                          "shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold " +
                          statusClass
                        }
                      >
                        {statusLabel}
                      </span>
                      <button
                        type="button"
                        onClick={() => onPickWarehouse(w.warehouseCode)}
                        disabled={!isComplete}
                        className={
                          "odoo-btn shrink-0 " +
                          (isComplete
                            ? "odoo-btn-primary"
                            : "odoo-btn-secondary opacity-50 cursor-not-allowed")
                        }
                      >
                        ເລືອກ
                      </button>
                    </div>
                    {w.status !== "none" ? (
                      <ul className="mt-2 grid gap-1">
                        {w.components.map((c) => {
                          const required = componentRequired(c.itemCode);
                          const unit = componentUnit(c.itemCode);
                          return (
                            <li
                              key={c.itemCode}
                              className="flex items-center justify-between rounded bg-odoo-bg-muted/50 px-2 py-1 text-[11px]"
                            >
                              <div className="min-w-0 truncate text-odoo-text-strong">
                                <span className="font-semibold">
                                  {componentName(c.itemCode)}
                                </span>
                                <span className="ml-1 font-mono text-odoo-text-muted">
                                  · ຕ້ອງການ {moneyFmt.format(required)}
                                  {unit ? ` ${unit}` : ""}
                                </span>
                              </div>
                              <div
                                className={
                                  "ml-2 shrink-0 font-mono font-bold " +
                                  (c.sufficient
                                    ? "text-emerald-700"
                                    : "text-rose-700")
                                }
                              >
                                {moneyFmt.format(c.balanceQty)}
                                {unit ? (
                                  <span className="ml-1 text-[10px] text-odoo-text-muted">
                                    {unit}
                                  </span>
                                ) : null}
                                {!c.sufficient && c.shortBy > 0 ? (
                                  <span className="ml-1 text-[10px] font-semibold">
                                    (ຂາດ {moneyFmt.format(c.shortBy)})
                                  </span>
                                ) : null}
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
        <footer className="flex items-center justify-between gap-3 border-t border-odoo-border px-5 py-3">
          <div className="text-[12px] font-semibold text-odoo-text-strong">
            {loading || error
              ? null
              : completeCount > 0
                ? `ມີ ${completeCount} ສາງທີ່ປະກອບໄດ້`
                : "ບໍ່ມີສາງໃດປະກອບໄດ້"}
          </div>
          <button
            type="button"
            onClick={onClose}
            className="odoo-btn odoo-btn-secondary"
          >
            ປິດ
          </button>
        </footer>
      </div>
    </div>
  );
}

function CustomerPicker({
  query,
  setQuery,
  matches,
  loading,
  required,
  onPick,
  onAddNew,
  onClose,
}: {
  query: string;
  setQuery: (q: string) => void;
  matches: Customer[];
  loading: boolean;
  required?: boolean;
  onPick: (c: Customer) => void;
  onAddNew: () => void;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-16">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={() => {
          if (!required) onClose();
        }}
      />
      <div className="relative w-full max-w-2xl rounded-md border border-odoo-border bg-odoo-surface">
        <div className="flex items-center justify-between border-b border-odoo-border px-4 py-3">
          <div>
            <div className="text-base font-bold text-odoo-text-strong">
              ເລືອກລູກຄ້າ
            </div>
            {required ? (
              <div className="mt-0.5 text-[11px] font-semibold text-odoo-danger">
                ຕ້ອງເລືອກລູກຄ້າກ່ອນເລີ່ມ POS
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAddNew}
              className="odoo-btn odoo-btn-primary"
            >
              + ເພີ່ມສະມາຊິກໃໝ່
            </button>
            {!required ? (
              <button type="button" onClick={onClose} className="odoo-btn odoo-btn-secondary">
                ປິດ
              </button>
            ) : null}
          </div>
        </div>
        <div className="border-b border-odoo-border px-4 py-3">
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ຄົ້ນຫາ: ຊື່, ລະຫັດ, ເບີໂທ"
            autoFocus
            className="odoo-input"
          />
        </div>
        <ul className="max-h-[60vh] overflow-y-auto">
          {loading ? (
            <li className="px-4 py-6 text-center text-sm text-odoo-text-muted">
              ກຳລັງໂຫລດລູກຄ້າ...
            </li>
          ) : matches.length === 0 ? (
            <li className="px-4 py-6 text-center text-sm text-odoo-text-muted">
              {query.trim() ? "ບໍ່ພົບລູກຄ້າ" : "ພິມຄົ້ນຫາເພື່ອເບິ່ງລາຍການອື່ນ"}
            </li>
          ) : (
            matches.map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  onClick={() => onPick(c)}
                  className="flex w-full items-center justify-between gap-3 border-b border-odoo-border px-4 py-3 text-left transition hover:bg-odoo-primary-50"
                >
                  <div className="min-w-0">
                    <div className="truncate font-semibold text-odoo-text-strong">
                      {c.name}
                    </div>
                    <div className="font-mono text-[11px] text-odoo-text-muted">
                      {c.id}
                      {c.phone ? ` · ${c.phone}` : ""}
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    {c.discountPct > 0 ? (
                      <span className="odoo-pill odoo-pill-success">
                        −{c.discountPct}%
                      </span>
                    ) : null}
                    <span className="odoo-pill odoo-pill-muted">
                      {moneyFmt.format(c.pointBalance ?? 0)} ແຕ້ມ
                    </span>
                  </div>
                </button>
              </li>
            ))
          )}
        </ul>
      </div>
    </div>
  );
}

type LocationOption = { code: string; name: string };
type AmperOption = LocationOption & { province: string | null };

function NewMemberForm({
  onCreated,
  onClose,
}: {
  onCreated: (c: Customer) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // ປະເພດສະມາຊິກ: "general" = ສະມາຊິກທົ່ວໄປ (ບໍ່ມີສ່ວນຫຼຸດ),
  // "line_oa" = ສະມາຊິກ LINE O.A (Gold + ສ່ວນຫຼຸດ 3%).
  const [memberType, setMemberType] = useState<"general" | "line_oa">(
    "general",
  );
  const [provinceCode, setProvinceCode] = useState("");
  const [amperCode, setAmperCode] = useState("");
  const [tambonCode, setTambonCode] = useState("");
  const [provinces, setProvinces] = useState<LocationOption[]>([]);
  const [ampers, setAmpers] = useState<AmperOption[]>([]);
  const [tambons, setTambons] = useState<LocationOption[]>([]);
  const [loadingLocations, setLoadingLocations] = useState(true);
  const [loadingTambons, setLoadingTambons] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Initial load: provinces (~20) + ampers (~149). Both lists are tiny so
  // we ship them up front and filter ampers client-side as the cashier
  // cascades down. Tambons (~10k rows) are fetched on demand once the
  // district is picked — see the second effect.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/locations");
        if (!res.ok) throw new Error(`locations ${res.status}`);
        const data = (await res.json()) as {
          provinces?: LocationOption[];
          ampers?: AmperOption[];
        };
        if (cancelled) return;
        setProvinces(data.provinces ?? []);
        setAmpers(data.ampers ?? []);
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error ? err.message : "ໂຫລດຂໍ້ມູນທີ່ຢູ່ຜິດພາດ",
          );
        }
      } finally {
        if (!cancelled) setLoadingLocations(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // Tambons are reset to [] by the province/amper onChange handlers
    // whenever the district context changes — keeping the clear out of this
    // effect avoids `react-hooks/set-state-in-effect` cascading renders.
    if (!amperCode) return;
    let cancelled = false;
    (async () => {
      // setState lives inside the async callback so it always runs after
      // the effect body returns — keeps the `react-hooks/set-state-in-effect`
      // rule happy without changing observable behavior.
      if (!cancelled) setLoadingTambons(true);
      try {
        const res = await fetch(
          `/api/locations?amper=${encodeURIComponent(amperCode)}`,
        );
        if (!res.ok) throw new Error(`tambons ${res.status}`);
        const data = (await res.json()) as { tambons?: LocationOption[] };
        if (cancelled) return;
        setTambons(data.tambons ?? []);
      } catch {
        if (!cancelled) setTambons([]);
      } finally {
        if (!cancelled) setLoadingTambons(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [amperCode]);

  const filteredAmpers = provinceCode
    ? ampers.filter((a) => a.province === provinceCode)
    : [];

  function nameByCode(list: LocationOption[], code: string) {
    return list.find((it) => it.code === code)?.name ?? "";
  }

  // Mirrors the Flutter `_validatePhone` in create_order_screen.dart so the
  // POS surfaces the same prefix/length rule the app does (server also
  // rechecks at POST /api/customers).
  function validatePhone(p: string): string | null {
    if (!p) return "ກະລຸນາໃສ່ເບີໂທ";
    if (/^20\d{8}$/.test(p)) return null;
    if (/^30\d{7}$/.test(p)) return null;
    return "ເບີໂທຕ້ອງຂຶ້ນຕົ້ນດ້ວຍ 20 (10 ຕົວ) ຫຼື 30 (9 ຕົວ)";
  }

  async function submit() {
    if (submitting) return;
    setError(null);
    const trimmedName = name.trim();
    const digitPhone = phone.replace(/\D+/g, "");
    if (!trimmedName) {
      setError("ກະລຸນາໃສ່ຊື່ລູກຄ້າ");
      return;
    }
    const phoneError = validatePhone(digitPhone);
    if (phoneError) {
      setError(phoneError);
      return;
    }
    setSubmitting(true);
    try {
      // Compose the address as "ບ້ານ X, ເມືອງ Y, ແຂວງ Z" so ar_customer.address
      // stays a single human-readable string; only non-empty parts are
      // included so partial entries don't leave dangling labels. Labels are
      // resolved from the picker codes against the loaded option lists so
      // typos / partial selections can never end up in the address.
      const provinceName = nameByCode(provinces, provinceCode);
      const amperName = nameByCode(filteredAmpers, amperCode);
      const tambonName = nameByCode(tambons, tambonCode);
      const parts: string[] = [];
      if (tambonName) parts.push(`ບ້ານ ${tambonName}`);
      if (amperName) parts.push(`ເມືອງ ${amperName}`);
      if (provinceName) parts.push(`ແຂວງ ${provinceName}`);
      const composedAddress = parts.join(", ");
      const res = await fetch("/api/customers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: trimmedName,
          phone: digitPhone,
          address: composedAddress || undefined,
          memberType,
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        setError(data?.error ?? `ຜິດພາດ ${res.status}`);
        setSubmitting(false);
        return;
      }
      onCreated(data as Customer);
    } catch (err) {
      setError(err instanceof Error ? err.message : "ບັນທຶກບໍ່ສຳເລັດ");
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[55] flex items-start justify-center bg-black/40 p-4 pt-12">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative flex w-full max-w-xl flex-col overflow-hidden rounded-md border border-odoo-border bg-odoo-surface">
        <div className="flex items-center justify-between border-b border-odoo-border px-4 py-3">
          <div className="text-base font-bold text-odoo-text-strong">
            ສ້າງລູກຄ້າໃໝ່
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="odoo-btn odoo-btn-secondary"
          >
            ປິດ
          </button>
        </div>
        <div className="grid gap-4 px-5 py-5">
          {/* ປະເພດສະມາຊິກ — ສະມາຊິກທົ່ວໄປ (ບໍ່ມີສ່ວນຫຼຸດ) ຫຼື
              ສະມາຊິກ LINE O.A (Gold + ສ່ວນຫຼຸດ 3%). */}
          <div className="grid gap-2">
            <span className="odoo-label">ປະເພດສະມາຊິກ *</span>
            <div className="grid gap-2 sm:grid-cols-2">
              <button
                type="button"
                onClick={() => setMemberType("general")}
                aria-pressed={memberType === "general"}
                className={
                  "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition " +
                  (memberType === "general"
                    ? "border-odoo-primary bg-odoo-primary/10 ring-1 ring-odoo-primary"
                    : "border-odoo-border hover:bg-odoo-surface-muted")
                }
              >
                <span className="text-[13px] font-bold text-odoo-text-strong">
                  ສະມາຊິກທົ່ວໄປ
                </span>
                <span className="text-[11px] font-semibold text-odoo-text-muted">
                  ບໍ່ມີສ່ວນຫຼຸດ
                </span>
              </button>
              <button
                type="button"
                onClick={() => setMemberType("line_oa")}
                aria-pressed={memberType === "line_oa"}
                className={
                  "flex flex-col items-start gap-0.5 rounded-md border px-3 py-2.5 text-left transition " +
                  (memberType === "line_oa"
                    ? "border-amber-500 bg-amber-50 ring-1 ring-amber-500"
                    : "border-odoo-border hover:bg-odoo-surface-muted")
                }
              >
                <span className="text-[13px] font-bold text-odoo-text-strong">
                  ສະມາຊິກ LINE O.A
                </span>
                <span className="text-[11px] font-semibold text-amber-700">
                  Gold · ສ່ວນຫຼຸດ 3%
                </span>
              </button>
            </div>
          </div>

          {/* ປ້າຍສະຖານະຕາມປະເພດທີ່ເລືອກ */}
          {memberType === "line_oa" ? (
            <div
              className="flex items-center gap-3 rounded-md border px-3 py-3"
              style={{
                background:
                  "linear-gradient(135deg, rgba(250,204,21,0.18), rgba(253,224,71,0.10))",
                borderColor: "rgba(202,138,4,0.35)",
              }}
            >
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md text-white"
                style={{
                  background: "linear-gradient(135deg, #fde047, #ca8a04)",
                  boxShadow: "0 3px 8px rgba(202,138,4,0.3)",
                }}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6"
                >
                  <path d="M9 11.75l-2.21-1.16-1.16-2.21L4.47 10.59 2.26 11.75l2.21 1.16 1.16 2.21 1.16-2.21 2.21-1.16zM19.53 13.41L18.37 11.2l-2.21-1.16 2.21-1.16L19.53 6.67l1.16 2.21 2.21 1.16-2.21 1.16-1.16 2.21zM12 2l-2.4 5.6L4 9l4.6 3.5L7.3 18 12 14.9 16.7 18l-1.3-5.5L20 9l-5.6-1.4L12 2z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-black text-amber-700">
                  ສະຖານະ: Gold
                </div>
                <div className="mt-0.5 text-[11px] font-bold text-amber-700/85">
                  ສ່ວນຫຼຸດ 3% ຕໍ່ບິນ ໂດຍອັດຕະໂນມັດ
                </div>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-3 rounded-md border border-odoo-border bg-odoo-surface-muted px-3 py-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-slate-200 text-slate-600">
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  className="h-6 w-6"
                >
                  <path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z" />
                </svg>
              </div>
              <div className="min-w-0">
                <div className="text-[14px] font-black text-odoo-text-strong">
                  ສະມາຊິກທົ່ວໄປ
                </div>
                <div className="mt-0.5 text-[11px] font-bold text-odoo-text-muted">
                  ບໍ່ມີສ່ວນຫຼຸດ
                </div>
              </div>
            </div>
          )}

          <label className="grid gap-1">
            <span className="odoo-label">ຊື່ *</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="odoo-input"
              autoFocus
            />
          </label>
          <label className="grid gap-1">
            <span className="odoo-label">ເບີໂທ *</span>
            <input
              type="tel"
              inputMode="numeric"
              maxLength={10}
              value={phone}
              onChange={(e) =>
                setPhone(e.target.value.replace(/\D+/g, "").slice(0, 10))
              }
              className="odoo-input"
            />
            <span className="text-[11px] text-odoo-text-muted">
              ຂຶ້ນຕົ້ນ 20 (10 ຕົວ) ຫຼື 30 (9 ຕົວ)
            </span>
          </label>
          <div className="grid gap-3">
            <span className="odoo-label">
              ທີ່ຢູ່
              {loadingLocations ? (
                <span className="ml-2 text-[11px] font-normal text-odoo-text-muted">
                  ກຳລັງໂຫລດ...
                </span>
              ) : null}
            </span>
            <div className="grid gap-3 sm:grid-cols-3">
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-odoo-text-muted">
                  ແຂວງ
                </span>
                <select
                  value={provinceCode}
                  onChange={(e) => {
                    setProvinceCode(e.target.value);
                    setAmperCode("");
                    setTambonCode("");
                    setTambons([]);
                  }}
                  disabled={loadingLocations}
                  className="odoo-input"
                >
                  <option value="">— ເລືອກແຂວງ —</option>
                  {provinces.map((p) => (
                    <option key={p.code} value={p.code}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-odoo-text-muted">
                  ເມືອງ
                </span>
                <select
                  value={amperCode}
                  onChange={(e) => {
                    const next = e.target.value;
                    setAmperCode(next);
                    setTambonCode("");
                    if (!next) setTambons([]);
                  }}
                  disabled={!provinceCode || loadingLocations}
                  className="odoo-input"
                >
                  <option value="">— ເລືອກເມືອງ —</option>
                  {filteredAmpers.map((a) => (
                    <option key={a.code} value={a.code}>
                      {a.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1">
                <span className="text-[11px] font-semibold text-odoo-text-muted">
                  ບ້ານ
                  {loadingTambons ? (
                    <span className="ml-1 text-[10px] font-normal">
                      (ກຳລັງໂຫລດ…)
                    </span>
                  ) : null}
                </span>
                <select
                  value={tambonCode}
                  onChange={(e) => setTambonCode(e.target.value)}
                  disabled={!amperCode || loadingTambons}
                  className="odoo-input"
                >
                  <option value="">— ເລືອກບ້ານ —</option>
                  {tambons.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.name}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          </div>
          {error ? (
            <div className="flex items-start gap-2 rounded-md border border-rose-300 bg-rose-50 px-3 py-2 text-[13px] font-semibold text-odoo-danger">
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="mt-0.5 h-5 w-5 shrink-0"
              >
                <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h2v-2h-2v2zm0-4h2V7h-2v6z" />
              </svg>
              <span>{error}</span>
            </div>
          ) : null}
        </div>
        <div className="border-t border-odoo-border px-5 py-3">
          <button
            type="button"
            onClick={submit}
            disabled={submitting}
            className="odoo-btn odoo-btn-primary h-11 w-full justify-center text-[15px] font-black"
          >
            {submitting ? "ກຳລັງບັນທຶກ…" : "ບັນທຶກ"}
          </button>
        </div>
      </div>
    </div>
  );
}

// Per-promotion label that reflects the actual configured quantities.
// Falls back to a generic name when the promo is missing required qty
// fields. Caller decides the bonus name lookup separately so we keep
// this pure (no DB / catalog access).
function promoTypeLabel(p: EnginePromotion): string {
  const tQty = p.triggerQty ? Number(p.triggerQty) : 0;
  const bQty = p.bonusQty ? Number(p.bonusQty) : 0;
  if (p.promoType === "bogo") {
    if (tQty > 0 && bQty > 0) return `ຊື້ ${tQty} ແຖມ ${bQty}`;
    return "ຊື້ ແຖມ";
  }
  if (p.promoType === "item_pair_price") {
    return "ຊື້ ຄູ່ ໄດ້ລາຄາພິເສດ";
  }
  if (p.promoType === "fixed_price_period") {
    return "ລາຄາພິເສດ ໃນຊ່ວງເວລາ";
  }
  return p.promoType;
}

function PromotionListModal({
  promotions,
  products,
  onPick,
  onClose,
}: {
  promotions: EnginePromotion[];
  products: Product[];
  onPick: (promo: EnginePromotion) => void;
  onClose: () => void;
}) {
  function productName(code: string | null) {
    const c = code?.trim();
    if (!c) return null;
    const p = products.find((it) => it.id === c);
    return p ? p.name : c;
  }
  function shortDate(v: Date | string | null) {
    if (!v) return null;
    const d = typeof v === "string" ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) return null;
    const day = String(d.getDate()).padStart(2, "0");
    const mon = String(d.getMonth() + 1).padStart(2, "0");
    return `${day}/${mon}/${d.getFullYear()}`;
  }
  // Per-type visual theme: accent bar + badge colours + an icon so a
  // cashier recognises the promo kind at a glance.
  const TYPE_THEME: Record<
    string,
    { bar: string; badge: string; icon: string }
  > = {
    bogo: {
      bar: "bg-emerald-500",
      badge: "bg-emerald-100 text-emerald-700",
      icon: "🎁",
    },
    item_pair_price: {
      bar: "bg-indigo-500",
      badge: "bg-indigo-100 text-indigo-700",
      icon: "🔗",
    },
    fixed_price_period: {
      bar: "bg-amber-500",
      badge: "bg-amber-100 text-amber-700",
      icon: "🏷️",
    },
  };
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-10 backdrop-blur-sm">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative flex max-h-[80vh] w-full max-w-md flex-col overflow-hidden rounded-xl bg-odoo-surface shadow-2xl">
        <header className="flex items-center justify-between gap-3 bg-odoo-primary px-4 py-2.5 text-white">
          <h2 className="flex items-center gap-2 text-base font-black leading-tight">
            <span>★</span>
            ໂປຣໂມຊັນທີ່ໃຊ້ໄດ້
            <span className="rounded-full bg-white/25 px-2 py-0.5 text-xs font-bold">
              {promotions.length}
            </span>
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-white/15 px-2.5 py-1 text-sm font-semibold text-white transition hover:bg-white/30"
          >
            ປິດ
          </button>
        </header>
        <div className="flex-1 overflow-y-auto bg-odoo-surface-muted px-3 py-3">
          {promotions.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-5 py-12 text-center">
              <div className="text-4xl opacity-25">🏷️</div>
              <div className="text-sm font-semibold text-odoo-text-muted">
                ບໍ່ມີໂປຣໂມຊັນທີ່ໃຊ້ໄດ້ໃນຕອນນີ້
              </div>
            </div>
          ) : (
            <div className="grid gap-2">
              {promotions.map((p) => {
                const triggerName = productName(p.triggerItemCode);
                const bonusName = productName(p.bonusItemCode);
                const end = shortDate(p.endAt);
                const theme = TYPE_THEME[p.promoType] ?? {
                  bar: "bg-odoo-border",
                  badge: "bg-odoo-surface-muted text-odoo-text-muted",
                  icon: "🏷️",
                };
                return (
                  <button
                    type="button"
                    key={String(p.id)}
                    onClick={() => onPick(p)}
                    className="group relative block w-full overflow-hidden rounded-xl border border-odoo-border bg-odoo-surface text-left shadow-sm transition hover:border-odoo-primary hover:bg-odoo-primary-50 hover:shadow active:scale-[0.99]"
                  >
                    <div
                      className={"absolute inset-y-0 left-0 w-1 " + theme.bar}
                    />
                    <div className="py-2 pl-4 pr-2.5">
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex min-w-0 items-center gap-2">
                          <span
                            className={
                              "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold " +
                              theme.badge
                            }
                          >
                            <span>{theme.icon}</span>
                            {promoTypeLabel(p)}
                          </span>
                          <span className="truncate text-[13px] font-bold text-odoo-text-strong">
                            {p.name}
                          </span>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {end ? (
                            <span className="font-mono text-[10px] font-semibold text-odoo-text-muted">
                              ໝົດ {end}
                            </span>
                          ) : null}
                          <span className="flex h-6 w-6 items-center justify-center rounded-full bg-odoo-surface-muted text-base font-bold text-odoo-text-muted transition group-hover:bg-odoo-primary group-hover:text-white">
                            +
                          </span>
                        </div>
                      </div>
                      {(() => {
                        // Promo-type-aware rendering. The same schema fields
                        // mean different things per type, so we describe what
                        // the cashier actually pays for each item:
                        //   fixed_price_period — trigger only, sold at fixedPriceKip
                        //   item_pair_price    — main = trigger (full price),
                        //                         bonus = bonusPriceKip per unit
                        //   bogo               — main = trigger at bonusPriceKip,
                        //                         bonus = 0 (free)
                        const triggerQty = p.triggerQty ? Number(p.triggerQty) : 0;
                        const bonusQty = p.bonusQty ? Number(p.bonusQty) : 0;
                        const bonusPrice = p.bonusPriceKip
                          ? Number(p.bonusPriceKip)
                          : 0;
                        const fixedPrice = p.fixedPriceKip
                          ? Number(p.fixedPriceKip)
                          : 0;
                        const Pill = ({ tone, text }: { tone: "main" | "bonus" | "free"; text: string }) => (
                          <span
                            className={
                              "shrink-0 rounded px-1.5 py-0.5 text-[9px] font-bold text-white " +
                              (tone === "main"
                                ? "bg-indigo-500"
                                : tone === "bonus"
                                  ? "bg-amber-500"
                                  : "bg-emerald-500")
                            }
                          >
                            {text}
                          </span>
                        );
                        const ItemRow = ({
                          tone,
                          label,
                          name,
                          code,
                          qty,
                          priceText,
                        }: {
                          tone: "main" | "bonus" | "free";
                          label: string;
                          name: string | null;
                          code: string;
                          qty: number;
                          priceText: string;
                        }) => (
                          <div className="flex items-center gap-2 py-0.5">
                            <Pill tone={tone} text={label} />
                            <span className="min-w-0 flex-1 truncate text-[12px] font-semibold text-odoo-text-strong">
                              {name ?? "—"}
                            </span>
                            <span className="shrink-0 font-mono text-[10px] text-odoo-text-muted">
                              {code}
                              {qty > 0 ? ` ×${qty}` : ""}
                            </span>
                            <span
                              className={
                                "shrink-0 text-[12px] font-extrabold " +
                                (tone === "free"
                                  ? "text-emerald-600"
                                  : "text-odoo-text-strong")
                              }
                            >
                              {priceText}
                            </span>
                          </div>
                        );
                        if (p.promoType === "fixed_price_period") {
                          return (
                            <div className="mt-1.5 grid gap-0.5 text-[12px]">
                              {p.triggerItemCode ? (
                                <ItemRow
                                  tone="main"
                                  label="ສິນຄ້າຫຼັກ"
                                  name={triggerName}
                                  code={p.triggerItemCode}
                                  qty={0}
                                  priceText={`${moneyFmt.format(fixedPrice)} ກີບ/ໜ່ວຍ`}
                                />
                              ) : null}
                            </div>
                          );
                        }
                        if (p.promoType === "item_pair_price") {
                          return (
                            <div className="mt-1.5 grid gap-0.5 text-[12px]">
                              {p.triggerItemCode ? (
                                <ItemRow
                                  tone="main"
                                  label="ສິນຄ້າຫຼັກ"
                                  name={triggerName}
                                  code={p.triggerItemCode}
                                  qty={triggerQty}
                                  priceText="ລາຄາປົກກະຕິ"
                                />
                              ) : null}
                              {p.bonusItemCode ? (
                                <ItemRow
                                  tone="bonus"
                                  label="ສິນຄ້າແຖມ"
                                  name={bonusName}
                                  code={p.bonusItemCode}
                                  qty={bonusQty}
                                  priceText={`${moneyFmt.format(bonusPrice)} ກີບ/ໜ່ວຍ`}
                                />
                              ) : null}
                            </div>
                          );
                        }
                        if (p.promoType === "bogo") {
                          return (
                            <div className="mt-1.5 grid gap-0.5 text-[12px]">
                              {p.triggerItemCode ? (
                                <ItemRow
                                  tone="main"
                                  label={`ຊື້ ${triggerQty}`}
                                  name={triggerName}
                                  code={p.triggerItemCode}
                                  qty={triggerQty}
                                  priceText={`${moneyFmt.format(bonusPrice)} ກີບ/ໜ່ວຍ`}
                                />
                              ) : null}
                              {p.bonusItemCode ? (
                                <ItemRow
                                  tone="free"
                                  label={`ແຖມ ${bonusQty}`}
                                  name={bonusName}
                                  code={p.bonusItemCode}
                                  qty={bonusQty}
                                  priceText="ຟຣີ"
                                />
                              ) : null}
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Page entry. The (app) layout already enforces auth server-side
// (requireEmployee), so here we just fetch the current employee for the
// POS UI and render the screen once it arrives.
export default function NewOrderPage() {
  const [me, setMe] = useState<{
    employeeCode: string;
    fullnameLo: string | null;
    nickname: string | null;
  } | null>(null);
  const [authError, setAuthError] = useState(false);

  useEffect(() => {
    let abort = false;
    void fetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (abort) return;
        if (!d || !d.employeeCode) {
          setAuthError(true);
          return;
        }
        setMe({
          employeeCode: d.employeeCode ?? "",
          fullnameLo: d.fullnameLo ?? null,
          nickname: d.nickname ?? null,
        });
      })
      .catch(() => {
        if (!abort) setAuthError(true);
      });
    return () => {
      abort = true;
    };
  }, []);

  if (authError) {
    return (
      <div className="flex h-screen items-center justify-center text-odoo-text-muted">
        ກະລຸນາເຂົ້າສູ່ລະບົບໃໝ່
      </div>
    );
  }
  if (!me) {
    return (
      <div className="flex h-screen items-center justify-center text-odoo-text-muted">
        ກຳລັງໂຫລດ...
      </div>
    );
  }
  return <PosScreen me={me} />;
}
