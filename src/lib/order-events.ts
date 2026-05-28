// In-process pub/sub for "new order" events. The POST /api/orders handler
// publishes after a successful insert; the /api/orders/stream SSE endpoint
// subscribes and forwards each event to connected browsers as JSON.
//
// Scope: single Next.js process. If we ever scale to multiple workers
// behind a load balancer this must move to a shared bus (Redis pubsub,
// Postgres LISTEN/NOTIFY, etc) — but the dev/prod setup today runs one
// node process, so an EventEmitter is enough.

import { EventEmitter } from "node:events";

export type NewOrderEvent = {
  type: "new-order";
  cartNumber: string;
  docNo: string | null;
  total: number | null;
  customerName: string | null;
  salespersonCode: string | null;
  salespersonName: string | null;
  createdAt: string; // ISO timestamp
};

// HMR-safe singleton: dev-mode module reloads would otherwise create a
// new emitter every refresh, breaking active subscriptions.
const SINGLETON_KEY = Symbol.for("__odg_order_events_emitter__");
const globalAny = globalThis as unknown as {
  [SINGLETON_KEY]?: EventEmitter;
};
const emitter: EventEmitter =
  globalAny[SINGLETON_KEY] ??
  (globalAny[SINGLETON_KEY] = new EventEmitter().setMaxListeners(0));

const CHANNEL = "order";

export function publishNewOrder(event: NewOrderEvent): void {
  emitter.emit(CHANNEL, event);
}

export function subscribeOrderEvents(
  handler: (event: NewOrderEvent) => void,
): () => void {
  emitter.on(CHANNEL, handler);
  return () => {
    emitter.off(CHANNEL, handler);
  };
}
