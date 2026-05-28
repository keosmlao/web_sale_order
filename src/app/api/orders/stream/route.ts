// Server-Sent Events stream for "new order" notifications. Browsers
// connect via EventSource and receive a JSON payload each time the POST
// /api/orders handler publishes a new-order event. Self-created orders
// are still forwarded — the client can filter them out using
// salespersonCode if it wants.

import type { NextRequest } from "next/server";
import { getEmployeeFromRequest } from "@/lib/auth";
import { subscribeOrderEvents, type NewOrderEvent } from "@/lib/order-events";

// SSE must stream continuously; force the Node runtime and disable any
// caching that the Next.js router might apply by default.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// EventSource auto-reconnects, but a keepalive comment every 15s prevents
// idle proxies (nginx, cloudflare) from closing the socket on us.
const KEEPALIVE_MS = 15_000;

export async function GET(request: NextRequest) {
  const employee = await getEmployeeFromRequest(request);
  if (!employee) {
    return new Response("Unauthorized", { status: 401 });
  }

  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;

      const safeEnqueue = (chunk: Uint8Array) => {
        if (closed) return;
        try {
          controller.enqueue(chunk);
        } catch {
          closed = true;
        }
      };

      // First frame so the browser knows the channel is alive immediately
      // (otherwise EventSource sits in "connecting" until the first event).
      safeEnqueue(encoder.encode(`data: ${JSON.stringify({ type: "hello" })}\n\n`));

      const send = (event: NewOrderEvent) => {
        safeEnqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      };
      const unsubscribe = subscribeOrderEvents(send);

      const keepalive = setInterval(() => {
        safeEnqueue(encoder.encode(`: keepalive\n\n`));
      }, KEEPALIVE_MS);

      const cleanup = () => {
        if (closed) return;
        closed = true;
        clearInterval(keepalive);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // already closed
        }
      };

      request.signal.addEventListener("abort", cleanup);
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Disable proxy buffering — nginx in particular will hold output
      // until the response closes without this header.
      "X-Accel-Buffering": "no",
    },
  });
}
