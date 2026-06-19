// Contract between the cashier settle drawer (publisher) and the customer
// display window (subscriber). They run as two windows in the SAME browser, so
// we sync over BroadcastChannel — no server round-trip, instant updates.

export const CUSTOMER_DISPLAY_CHANNEL = "odg-customer-display";
export const CUSTOMER_DISPLAY_ROUTE = "/cashier-display";

export type CustomerDisplayItem = {
  name: string;
  qty: number;
  amount: number; // line total, KIP
};

export type CustomerDisplayState = {
  // present = a bill is on screen; null = idle / welcome screen
  cartNumber: string | null;
  customerName: string | null;
  items: CustomerDisplayItem[];
  total: number; // effective total after discount/redeem, KIP
  paid: number; // running paid amount, KIP
  changeDue: number; // KIP
  remainingDue: number; // KIP
  transferAmount: number; // KIP to show as a BCEL QR (0 = hide QR)
  updatedAt: number;
};

export const IDLE_DISPLAY_STATE: CustomerDisplayState = {
  cartNumber: null,
  customerName: null,
  items: [],
  total: 0,
  paid: 0,
  changeDue: 0,
  remainingDue: 0,
  transferAmount: 0,
  updatedAt: 0,
};

// Open (or re-focus) the customer display in a second window. Returns the
// window handle, or null on SSR.
export function openCustomerDisplayWindow(): Window | null {
  if (typeof window === "undefined") return null;
  return window.open(
    CUSTOMER_DISPLAY_ROUTE,
    CUSTOMER_DISPLAY_CHANNEL,
    "width=900,height=700",
  );
}

// Messages on the channel are discriminated: the cashier pushes "state"; a
// freshly-opened display window pushes "hello" to pull the current bill so it
// populates regardless of which window opened first.
type DisplayMessage =
  | { kind: "state"; state: CustomerDisplayState }
  | { kind: "hello" };

function postMessage(msg: DisplayMessage): void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return;
  }
  const ch = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
  try {
    ch.postMessage(msg);
  } finally {
    ch.close();
  }
}

// Publisher side — push the current bill to any open display window.
export function publishCustomerDisplay(state: CustomerDisplayState): void {
  postMessage({ kind: "state", state });
}

// Display side — ask the cashier window to (re-)publish the current bill.
export function requestCustomerDisplayState(): void {
  postMessage({ kind: "hello" });
}

// Subscribe to channel traffic. Returns an unsubscribe fn. Safe on SSR.
export function subscribeCustomerDisplay(handlers: {
  onState?: (state: CustomerDisplayState) => void;
  onHello?: () => void;
}): () => void {
  if (typeof window === "undefined" || typeof BroadcastChannel === "undefined") {
    return () => {};
  }
  const ch = new BroadcastChannel(CUSTOMER_DISPLAY_CHANNEL);
  ch.onmessage = (ev) => {
    const msg = ev.data as DisplayMessage;
    if (msg?.kind === "state") handlers.onState?.(msg.state);
    else if (msg?.kind === "hello") handlers.onHello?.();
  };
  return () => ch.close();
}
