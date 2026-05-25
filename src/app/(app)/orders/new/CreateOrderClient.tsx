"use client";

import { useEffect, useMemo, useRef, useState } from "react";
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

export default function CreateOrderClient({
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

  const [productQuery, setProductQuery] = useState("");

  const [items, setItems] = useState<Line[]>([]);
  // Mirrors `items` so async helpers (reconcileBonusForTrigger,
  // maybeAutoAddBogoBonus) read the latest qty after a setItems call.
  // setTimeout(0) is not enough — React closes over `items` at render
  // time and the timeout callback still sees the stale value.
  const itemsRef = useRef<Line[]>([]);
  useEffect(() => {
    itemsRef.current = items;
  }, [items]);

  // Cart recovery: persist cart + selected customer to localStorage so
  // the cashier can refresh / crash mid-sale and pick up where they
  // left off. Key scoped per logged-in employee.
  const cartStorageKey = `pos-cart-draft:${me.employeeCode ?? "anon"}`;
  const customerStorageKey = `pos-customer-draft:${me.employeeCode ?? "anon"}`;
  const [cartHydrated, setCartHydrated] = useState(false);
  useEffect(() => {
    try {
      const rawCart = window.localStorage.getItem(cartStorageKey);
      if (rawCart) {
        const parsed = JSON.parse(rawCart) as Line[];
        if (Array.isArray(parsed) && parsed.length > 0) {
          setItems(parsed);
          itemsRef.current = parsed;
        }
      }
      const rawCust = window.localStorage.getItem(customerStorageKey);
      if (rawCust) {
        const parsedCust = JSON.parse(rawCust) as Customer;
        if (parsedCust && typeof parsedCust.id === "string") {
          setCustomer(parsedCust);
        }
      }
    } catch {
      // ignore corrupt entry
    } finally {
      setCartHydrated(true);
    }
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

  const [deliveryName, setDeliveryName] = useState("");
  const [note, setNote] = useState("");
  const [extraDiscount, setExtraDiscount] = useState<number>(0);
  const [extrasOpen, setExtrasOpen] = useState(false);

  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [successNotice, setSuccessNotice] = useState<{ cartNumber: string } | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [eRes, loyaltyRes, whRes] = await Promise.all([
          fetch("/api/employees"),
          fetch("/api/loyalty/config"),
          fetch("/api/settings/sales-warehouses"),
        ]);
        if (!eRes.ok) throw new Error(`employees ${eRes.status}`);
        if (!loyaltyRes.ok) throw new Error(`loyalty ${loyaltyRes.status}`);
        if (!whRes.ok) throw new Error(`warehouses ${whRes.status}`);
        const eData = await eRes.json();
        const loyaltyData = await loyaltyRes.json().catch(() => null);
        const whData = await whRes.json().catch(() => null);
        if (cancelled) return;
        setEmployees((eData ?? []) as Salesperson[]);
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
  const filteredProducts = useMemo(() => {
    const q = productQuery.trim().toLowerCase();
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
    return matched.slice(0, isAirQuery ? matched.length : q ? 10 : 20);
  }, [products, productQuery]);

  const currentPromotions = useMemo(() => {
    const now = new Date();
    return activePromotions.filter((promo) => isPromoActiveNow(promo, now));
  }, [activePromotions]);

  const promotionByProduct = useMemo(() => {
    const map = new Map<string, EnginePromotion[]>();
    for (const promo of currentPromotions) {
      for (const code of [promo.triggerItemCode, promo.bonusItemCode]) {
        const key = code?.trim();
        if (!key) continue;
        const list = map.get(key) ?? [];
        list.push(promo);
        map.set(key, list);
      }
    }
    return map;
  }, [currentPromotions]);

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

  // Open the per-line warehouse picker if the product has stock in more
  // than one warehouse, otherwise add directly. Mirrors the Flutter app's
  // add-to-cart flow where the salesperson always confirms where to pull
  // the stock from.
  async function addProduct(p: Product) {
    setSubmitError(null);
    // Set products (ic_inventory_set) carry no pre-built stock of their own —
    // selling one means drawing the underlying components. Skip the
    // warehouse/location picker entirely and open the set-build modal, which
    // queries per-warehouse component balances and lets the cashier pick a
    // warehouse where the set is actually complete.
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
      // One option per (warehouse, location) — even zero-balance rows are
      // surfaced so the salesperson can see the full picture (where stock
      // *could* be) rather than only positive-balance picks. Negative /
      // zero rows render dimmed and non-clickable in the modal.
      // POS pulls from every warehouse that has the item — the picker is
      // the cashier's single touch point for choosing fulfillment, so
      // we no longer hide locations that aren't on the sales-warehouse
      // whitelist. Salesperson can still configure salesWarehouses to
      // tune the catalog filter; the per-item pick is unconstrained.
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
        // No per-shelf breakdown for this item. If the products cache
        // reports stock at the warehouse level, fall back to a warehouse-
        // only line — the orders endpoint accepts an empty locationCode
        // and validates against the warehouse total in that case. Useful
        // for SKUs that haven't been assigned ic_shelf rows yet.
        if (p.stock > 0) {
          addProductWithLocation(p, warehouseCode, "", p.stock);
          return;
        }
        setSubmitError(
          `ສິນຄ້າ ${p.code} ບໍ່ມີ stock ໃນສາງທີ່ຕັ້ງຄ່າ`,
        );
        return;
      }
      // Auto-add only when there's exactly one option AND it has stock —
      // otherwise we open the picker so the user can confirm the empty
      // row visually rather than getting a silent failure.
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
    const promos = currentPromotions.filter(
      (promo) =>
        promo.promoType === "bogo" &&
        promo.triggerItemCode?.trim() === triggerProduct.id,
    );
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

  function changeQty(idx: number, delta: number) {
    const cur = itemsRef.current;
    const line = cur[idx];
    if (!line) return;
    if (line.promoBonusOfCode) return; // bonus lines are locked
    let maxQty: number;
    if (line.buildFromComponents) {
      maxQty = Math.max(1, Math.floor(line.buildableSets ?? 1));
    } else {
      const selectedLocation = line.locations.find(
        (loc) => loc.location === line.locationCode,
      );
      maxQty = selectedLocation
        ? Math.max(1, Math.floor(selectedLocation.balanceQty))
        : Number.POSITIVE_INFINITY;
    }
    const newQty = Math.min(maxQty, Math.max(1, line.quantity + delta));
    if (newQty === line.quantity) return;
    const next = [...cur];
    next[idx] = { ...line, quantity: newQty };
    commitItems(next);
    void reconcileBonusForTrigger(line.productId);
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
    const lines = applyPromotions(baseLines, activePromotions, new Date());
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
  }, [items, customer, activePromotions]);
  const afterLineDiscounts = linePricing.reduce((sum, it) => sum + it.amount, 0);
  const appliedExtraDiscount = Math.min(
    Math.max(0, extraDiscount || 0),
    afterLineDiscounts,
  );
  const total = afterLineDiscounts - appliedExtraDiscount;
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

  // customer may be null for walk-in sales (no member attached). The
  // server accepts empty cust_code and the settle endpoint treats the
  // resulting SOK as a walk-in too.
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
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          // Walk-in: customer can be null → send empty string. The server
          // treats it as no-customer and skips member-only validation.
          customerId: customer?.id ?? "",
          warehouseCode,
          deliveryName: deliveryName.trim() || undefined,
          note: note.trim() || undefined,
          extraDiscount: appliedExtraDiscount > 0 ? appliedExtraDiscount : undefined,
          salespersonCode: salespersonCode || undefined,
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
      setSelectedLineIdx(null);
      setDeliveryName("");
      setNote("");
      setExtraDiscount(0);
      setExtrasOpen(false);
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
  const itemCountByProduct = new Map(
    items.map((it) => [it.productId, it.quantity] as const),
  );
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
    <div className="pos-shell">
      <div className="pos-products">
        <div className="pos-toolbar pos-toolbar-compact">
          <div className="pos-toolbar-head">
            <div className="pos-toolbar-title-line">
              <h1 className="pos-heading-compact">ສ້າງອໍເດີໃໝ່</h1>
              <span className="pos-stat-chip">
                <span>ສິນຄ້າ</span>
                <strong>{moneyFmt.format(filteredProducts.length)}</strong>
              </span>
              <span className="pos-stat-chip pos-stat-chip-accent">
                <span>ໃນກະຕ່າ</span>
                <strong>{moneyFmt.format(totalQty)}</strong>
              </span>
            </div>
            <button
              type="button"
              onClick={() => setPromoListOpen(true)}
              className="pos-promo-chip"
              title="ເບີ່ງໂປຣໂມຊັນ"
            >
              <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <path d="M20.59 13.41 13 21l-9-9V4h8l8.59 8.59a2 2 0 0 1 0 2.82Z" />
                <circle cx="8" cy="8" r="1.5" />
              </svg>
              <span>ໂປຣໂມຊັນ</span>
              {currentPromotions.length > 0 ? (
                <span className="pos-promo-chip-count">{currentPromotions.length}</span>
              ) : null}
            </button>
          </div>
          <div className="pos-search">
            <div className="pos-search-wrap">
              <span className="pos-search-icon" aria-hidden>
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="m20 20-3-3" />
                </svg>
              </span>
              <input
                type="text"
                value={productQuery}
                onChange={(e) => setProductQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key !== "Enter") return;
                  e.preventDefault();
                  const raw = productQuery.trim();
                  if (!raw) return;
                  const q = raw.toLowerCase();
                  // 1. Exact code match in catalog → fast path.
                  const exactCode = products.find(
                    (p) => p.code.toLowerCase() === q,
                  );
                  if (exactCode && exactCode.stock > 0) {
                    void addProduct(exactCode);
                    setProductQuery("");
                    return;
                  }
                  // 2. Single name match in current filter.
                  const single =
                    filteredProducts.length === 1 ? filteredProducts[0] : null;
                  if (single && single.stock > 0) {
                    void addProduct(single);
                    setProductQuery("");
                    return;
                  }
                  // 3. Fall back to the barcode lookup endpoint — translates
                  //    a scanned EAN/UPC to the real ic_inventory.code, then
                  //    adds the matching catalog product.
                  void (async () => {
                    try {
                      const res = await fetch(
                        `/api/inventory/barcode?code=${encodeURIComponent(raw)}`,
                      );
                      if (!res.ok) return;
                      const data = (await res.json()) as {
                        found?: boolean;
                        item?: { code: string };
                      };
                      if (!data.found || !data.item) {
                        setSubmitError(`ບໍ່ພົບ barcode "${raw}"`);
                        return;
                      }
                      const cat = products.find(
                        (p) => p.code === data.item!.code,
                      );
                      if (!cat) {
                        setSubmitError(
                          `barcode "${raw}" → ${data.item.code} ບໍ່ມີໃນ catalog`,
                        );
                        return;
                      }
                      if (cat.stock <= 0) {
                        setSubmitError(
                          `ສິນຄ້າ ${cat.code} ບໍ່ມີ stock`,
                        );
                        return;
                      }
                      await addProduct(cat);
                      setProductQuery("");
                    } catch (err) {
                      setSubmitError(
                        err instanceof Error
                          ? err.message
                          : "barcode lookup failed",
                      );
                    }
                  })();
                }}
                placeholder="ຄົ້ນຫາ ຫຼື ສະແກນ barcode (Enter = ເພີ່ມ)..."
                className="pos-search-input"
                autoFocus
              />
              {productQuery ? (
                <button
                  type="button"
                  onClick={() => setProductQuery("")}
                  className="pos-search-clear"
                  aria-label="ລ້າງ"
                >
                  <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M6 6l12 12M6 18L18 6" />
                  </svg>
                </button>
              ) : null}
            </div>
          </div>
        </div>

        <div className="pos-product-list">
          {!warehouseCode ? (
            <div className="pos-empty-state">
              ກະລຸນາເລືອກສາງເພື່ອເລີ່ມຂາຍ
            </div>
          ) : loadingProducts ? (
            <div className="pos-empty-state">
              ກຳລັງໂຫລດສິນຄ້າທີ່ມີ stock...
            </div>
          ) : filteredProducts.length === 0 ? (
            <div className="pos-empty-state">
              ບໍ່ພົບສິນຄ້າທີ່ມີ stock ໃນສາງນີ້
            </div>
          ) : (
            <div className="pos-grid">
              {filteredProducts.map((p) => {
                const qtyInCart = itemCountByProduct.get(p.id) ?? 0;
                const remaining = p.stock - qtyInCart;
                const minimumStock = p.minimumStock ?? 0;
                const stockClass =
                  remaining <= 0
                    ? "pos-tile-stock-none"
                    : minimumStock > 0 && remaining < minimumStock
                      ? "pos-tile-stock-low"
                      : "pos-tile-stock-ok";
                const stockLabel =
                  remaining <= 0
                    ? "ໝົດ"
                    : minimumStock > 0 && remaining < minimumStock
                      ? `ຕ່ຳ ${moneyFmt.format(remaining)}`
                      : `${moneyFmt.format(remaining)}`;
                // Disable when either the warehouse has zero stock OR the
                // qty already in the cart has exhausted the available stock.
                // Without this the user can keep clicking past the limit and
                // only sees an error when they save the order.
                const outOfStock = p.stock <= 0 || remaining <= 0;
                const airSet = isAirSetProduct(p);
                const productPromotions = promotionByProduct.get(p.id) ?? [];
                return (
                  <button
                    key={p.id}
                    type="button"
                    onClick={() => addProduct(p)}
                    disabled={outOfStock}
                    className={
                      "pos-tile" +
                      (qtyInCart > 0 ? " pos-tile-in-cart" : "") +
                      (outOfStock ? " pos-tile-out-of-stock" : "") +
                      (airSet ? " pos-tile-air-set" : "")
                    }
                  >
                    <span className={"pos-tile-stock-corner " + stockClass}>
                      <span className="pos-tile-stock-dot" />
                      {stockLabel}
                      {p.unitName && remaining > 0 ? (
                        <span className="pos-tile-stock-unit"> {p.unitName}</span>
                      ) : null}
                    </span>
                    {qtyInCart > 0 ? (
                      <span className="pos-tile-qty" aria-label="ໃນກະຕ່າ">
                        ×{moneyFmt.format(qtyInCart)}
                      </span>
                    ) : null}
                    {productPromotions.length > 0 ? (
                      <span className="pos-promo-badge">
                        ໂປຣ {productPromotions[0].name}
                      </span>
                    ) : null}
                    <div className="pos-tile-body">
                      <div className="pos-tile-name">{p.name}</div>
                      <div className="pos-tile-meta">
                        <span className="pos-tile-code">{p.code}</span>
                        {p.brand ? (
                          <>
                            <span className="pos-tile-meta-dot">·</span>
                            <span className="pos-tile-brand">{p.brand}</span>
                          </>
                        ) : null}
                        {airSet ? (
                          <span className="pos-unit-badge">ຊຸດ</span>
                        ) : null}
                      </div>
                      <div className="pos-tile-price-row">
                        <span className="pos-tile-price">
                          {moneyFmt.format(p.price)}
                        </span>
                        <span className="pos-tile-price-unit">ກີບ</span>
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      <div className="pos-order">
        <div className="pos-order-header">
          <div className="pos-order-title">
            <div>
              <div className="text-base font-bold text-odoo-text-strong">ກະຕ່າຂາຍ</div>
            </div>
            <span className="odoo-pill odoo-pill-muted">
              {items.length} ລາຍການ · {moneyFmt.format(totalQty)} {totalQtyUnit}
            </span>
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
                ຫຼື ປ່ອຍວ່າງ = ລູກຄ້າທົ່ວໄປ (walk-in)
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

        <div className="pos-order-lines">
          {items.length === 0 ? (
            <div className="pos-cart-empty">
              ກົດສິນຄ້າຈາກກະດານຊ້າຍເພື່ອເພີ່ມລາຍການ
            </div>
          ) : (
            <ul>
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
                // Effective unit price *after* the promo. For free bonus
                // lines this is 0; for promo-priced trigger lines this is
                // bonusPriceKip (or whatever the engine resolved to).
                const effectiveUnitPrice =
                  pricing && line.quantity > 0
                    ? pricing.amount / line.quantity
                    : line.unitPrice;
                return (
                  <li
                    key={`${line.productId}-${idx}`}
                    onClick={() => setSelectedLineIdx(idx)}
                    className={
                      "pos-line" +
                      (selected ? " pos-line-selected" : "") +
                      (isFreeBonus ? " pos-line-bonus" : "") +
                      (isPromoSold ? " pos-line-promo" : "")
                    }
                  >
                    <div className="pos-line-info min-w-0">
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
                        <div className="pos-line-name min-w-0 truncate text-sm font-semibold text-odoo-text-strong">
                          {line.productName}
                        </div>
                      </div>
                      <div className="mt-0.5 font-mono text-[10px] font-bold text-odoo-text-muted">
                        {line.productId}
                      </div>
                      <div className="mt-0.5 flex items-center gap-2 font-mono text-[10px]">
                        {isFreeBonus ? (
                          <span className="font-bold text-emerald-700">
                            ຟຣີ
                          </span>
                        ) : (
                          <span
                            className={
                              "font-bold " +
                              (isPromoSold
                                ? "text-indigo-700"
                                : "text-odoo-text-muted")
                            }
                          >
                            {moneyFmt.format(effectiveUnitPrice)}
                          </span>
                        )}
                        {line.unitName ? (
                          <span className="text-odoo-text-muted">/ {line.unitName}</span>
                        ) : null}
                        {isAirSetLine(line) ? (
                          <span className="pos-unit-badge">ຫົວໜ່ວຍ: ຊຸດ</span>
                        ) : null}
                      </div>
                      {hasPromo ? (
                        <div className="mt-1 text-[10px] font-semibold text-odoo-success">
                          {pricing.promoLabel || "Promotion"}
                        </div>
                      ) : null}
                    </div>
                    <div className="pos-line-controls">
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          changeQty(idx, -1);
                        }}
                        disabled={!!line.promoBonusOfCode || line.quantity <= 1}
                        className="pos-iconbtn"
                        aria-label="ຫຼຸດ"
                        title={line.promoBonusOfCode ? "ສິນຄ້າແຖມ — ປ່ຽນຈຳນວນຈາກສິນຄ້າຫຼັກ" : undefined}
                      >
                        −
                      </button>
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
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          changeQty(idx, 1);
                        }}
                        disabled={!!line.promoBonusOfCode}
                        className="pos-iconbtn"
                        aria-label="ເພີ່ມ"
                        title={line.promoBonusOfCode ? "ສິນຄ້າແຖມ — ປ່ຽນຈຳນວນຈາກສິນຄ້າຫຼັກ" : undefined}
                      >
                        +
                      </button>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeLine(idx);
                        }}
                        disabled={!!line.promoBonusOfCode}
                        className="pos-iconbtn ml-1 text-odoo-danger hover:bg-odoo-danger-bg"
                        aria-label="ລົບ"
                        title={line.promoBonusOfCode ? "ສິນຄ້າແຖມ — ລົບສິນຄ້າຫຼັກເພື່ອລົບແຖມ" : undefined}
                      >
                        ✕
                      </button>
                    </div>
                    <div className="pos-line-meta">
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
                      <div className="shrink-0 text-right">
                        <div
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
                        </div>
                      </div>
                    </div>
                    {selected && isAirSetLine(line) ? (
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
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        <div className="pos-order-summary">
          {extrasOpen ? (
            <div className="pos-extras-panel">
              <div className="pos-extras-grid">
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
                <div>
                  <label className="odoo-label">ໝາຍເຫດ</label>
                  <textarea
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                    rows={2}
                    className="odoo-textarea"
                    placeholder="ບໍ່ບັງຄັບ"
                  />
                </div>
                <div>
                  <label className="odoo-label">ສ່ວນຫຼຸດທ້າຍບິນ (ກີບ)</label>
                  <input
                    type="number"
                    min={0}
                    step={1000}
                    value={extraDiscount || ""}
                    onChange={(e) =>
                      setExtraDiscount(Math.max(0, Number(e.target.value) || 0))
                    }
                    placeholder="0"
                    className="odoo-input text-right font-mono"
                  />
                  <div className="mt-2 flex flex-wrap gap-1">
                    {[5, 10, 15].map((pct) => (
                      <button
                        key={pct}
                        type="button"
                        onClick={() =>
                          setExtraDiscount(
                            Math.round(afterLineDiscounts * (pct / 100)),
                          )
                        }
                        className="rounded border border-odoo-border bg-odoo-surface px-2 py-1 text-[11px] font-semibold hover:bg-odoo-surface-muted"
                      >
                        −{pct}%
                      </button>
                    ))}
                    {extraDiscount > 0 ? (
                      <button
                        type="button"
                        onClick={() => setExtraDiscount(0)}
                        className="rounded border border-odoo-border bg-odoo-surface px-2 py-1 text-[11px] font-semibold text-odoo-danger hover:bg-odoo-surface-muted"
                      >
                        ລ້າງ
                      </button>
                    ) : null}
                  </div>
                </div>

              </div>
            </div>
          ) : null}

          <div className="px-4 py-3">
            <div className="space-y-1 text-sm">
              {/* Subtotal mirrors what's visible in the cart lines — sum
                  of post-promo amounts, so the customer never sees a
                  number larger than what they're paying. */}
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
      </div>

      {/* Customer picker overlay */}
      {customerOpen ? (
        <CustomerPicker
          query={customerQuery}
          setQuery={setCustomerQuery}
          matches={customerMatches}
          loading={loadingCustomers}
          onPick={(c) => {
            setCustomer(c);
            setCustomerOpen(false);
          }}
          onAddNew={() => setNewMemberOpen(true)}
          onClose={() => setCustomerOpen(false)}
        />
      ) : null}
      {newMemberOpen ? (
        <NewMemberForm
          onCreated={(c) => {
            setCustomer(c);
            setCustomers((prev) => [c, ...prev.filter((p) => p.id !== c.id)]);
            setNewMemberOpen(false);
            setCustomerOpen(false);
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
  onPick,
  onAddNew,
  onClose,
}: {
  query: string;
  setQuery: (q: string) => void;
  matches: Customer[];
  loading: boolean;
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
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl rounded-md border border-odoo-border bg-odoo-surface">
        <div className="flex items-center justify-between border-b border-odoo-border px-4 py-3">
          <div className="text-base font-bold text-odoo-text-strong">
            ເລືອກລູກຄ້າ
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onAddNew}
              className="odoo-btn odoo-btn-primary"
            >
              + ເພີ່ມສະມາຊິກໃໝ່
            </button>
            <button type="button" onClick={onClose} className="odoo-btn odoo-btn-secondary">
              ປິດ
            </button>
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
          {/* Gold tier banner — mirrors the app's "ສະຖານະເລີ່ມຕົ້ນ: Gold"
              banner so the salesperson sees the auto-assigned 3% perk
              before filling anything in. */}
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
                ສະຖານະເລີ່ມຕົ້ນ: Gold
              </div>
              <div className="mt-0.5 text-[11px] font-bold text-amber-700/85">
                ສ່ວນຫຼຸດ 3% ຕໍ່ບິນ ໂດຍອັດຕະໂນມັດ
              </div>
            </div>
          </div>

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
  function fmtDate(v: Date | string | null) {
    if (!v) return null;
    const d = typeof v === "string" ? new Date(v) : v;
    if (Number.isNaN(d.getTime())) return null;
    return d.toLocaleString();
  }
  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center bg-black/40 p-4 pt-12">
      <button
        type="button"
        aria-label="ປິດ"
        className="absolute inset-0 cursor-default"
        onClick={onClose}
      />
      <div className="relative w-full max-w-2xl overflow-hidden rounded-md border border-odoo-border bg-odoo-surface">
        <header className="flex items-center justify-between border-b border-odoo-border px-5 py-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-widest text-odoo-text-muted">
              POS · Active
            </div>
            <h2 className="mt-1 text-base font-bold text-odoo-text-strong">
              ໂປຣໂມຊັນທີ່ໃຊ້ໄດ້ ({promotions.length})
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="odoo-btn odoo-btn-secondary"
          >
            ປິດ
          </button>
        </header>
        <div className="max-h-[70vh] overflow-y-auto">
          {promotions.length === 0 ? (
            <div className="px-5 py-10 text-center text-sm text-odoo-text-muted">
              ບໍ່ມີໂປຣໂມຊັນທີ່ active ໃນຕອນນີ້
            </div>
          ) : (
            <ul className="divide-y divide-odoo-border">
              {promotions.map((p) => {
                const triggerName = productName(p.triggerItemCode);
                const bonusName = productName(p.bonusItemCode);
                const start = fmtDate(p.startAt);
                const end = fmtDate(p.endAt);
                return (
                  <li key={String(p.id)} className="px-5 py-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="text-sm font-bold text-odoo-text-strong">
                          {p.name}
                        </div>
                        <div className="mt-0.5 text-[11px] font-semibold text-odoo-primary">
                          {promoTypeLabel(p)}
                        </div>
                      </div>
                      <div className="flex shrink-0 flex-col items-end gap-1">
                        {start || end ? (
                          <div className="text-right text-[10px] font-mono text-odoo-text-muted">
                            {start ?? "—"}
                            <div>↓ {end ?? "—"}</div>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          onClick={() => onPick(p)}
                          className="odoo-btn odoo-btn-primary"
                        >
                          ເລືອກ → ກະຕ່າ
                        </button>
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
                            "rounded px-1.5 py-0.5 text-[10px] font-bold " +
                            (tone === "main"
                              ? "bg-indigo-50 text-indigo-700"
                              : tone === "bonus"
                                ? "bg-amber-50 text-amber-700"
                                : "bg-emerald-50 text-emerald-700")
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
                        <div className="flex items-center gap-2">
                          <Pill tone={tone} text={label} />
                          <span className="min-w-0 truncate text-odoo-text-strong">
                            {name ?? "—"}
                          </span>
                          <span className="ml-auto flex shrink-0 items-center gap-2 font-mono text-[10px] text-odoo-text-muted">
                            <span>{code}</span>
                            {qty > 0 ? <span>× {qty}</span> : null}
                          </span>
                          <span className="shrink-0 font-mono text-[11px] font-bold text-odoo-primary">
                            {priceText}
                          </span>
                        </div>
                      );
                      if (p.promoType === "fixed_price_period") {
                        return (
                          <div className="mt-2 grid gap-1 text-[12px]">
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
                          <div className="mt-2 grid gap-1 text-[12px]">
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
                          <div className="mt-2 grid gap-1 text-[12px]">
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
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
