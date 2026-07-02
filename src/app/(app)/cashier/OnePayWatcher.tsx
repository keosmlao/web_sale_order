"use client";

import { useEffect, useRef } from "react";
import Script from "next/script";

// Real-time BCEL OnePay payment listener. When a transfer QR is on screen we
// subscribe to the merchant/shop PubNub channel; the moment BCEL pushes a
// payment event, `onPaid` fires so the cashier screen can auto-confirm.
//
// The PubNub subscribe key + channel format are taken from BCEL's public
// onepay.js SDK (public/onepay.js) — the same values the SDK hard-codes.
const PUBNUB_SUB_KEY = "sub-c-91489692-fa26-11e9-be22-ea7c5aada356";
const PUBNUB_CDN = "https://cdn.pubnub.com/sdk/javascript/pubnub.7.6.1.min.js";

type PubNubClient = {
  addListener: (h: { message: (m: { message: unknown }) => void }) => void;
  subscribe: (p: { channels: string[] }) => void;
  unsubscribeAll?: () => void;
  stop?: () => void;
};

export default function OnePayWatcher({
  active,
  onPaid,
}: {
  active: boolean;
  onPaid: (info: unknown) => void;
}) {
  // Keep the latest callback without re-subscribing.
  const onPaidRef = useRef(onPaid);
  useEffect(() => {
    onPaidRef.current = onPaid;
  });

  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    let client: PubNubClient | null = null;

    const waitForPubNub = async (): Promise<unknown> => {
      for (let i = 0; i < 25 && !cancelled; i++) {
        const pn = (window as unknown as { PubNub?: unknown }).PubNub;
        if (pn) return pn;
        await new Promise((r) => setTimeout(r, 300));
      }
      return null;
    };

    (async () => {
      const PubNub = (await waitForPubNub()) as
        | (new (cfg: Record<string, unknown>) => PubNubClient)
        | null;
      if (!PubNub || cancelled) return;

      let cfg: { configured?: boolean; mcid?: string; shopcode?: string | null };
      try {
        const res = await fetch("/api/cashier/onepay-config");
        cfg = await res.json();
      } catch {
        return;
      }
      if (cancelled || !cfg?.configured || !cfg.mcid) return;

      const channel = cfg.shopcode
        ? `mcid-${cfg.mcid}-${cfg.shopcode}`
        : `mcid-${cfg.mcid}`;

      try {
        client = new PubNub({
          subscribeKey: PUBNUB_SUB_KEY,
          ssl: true,
          userId: "BCELBANK",
        });
        client.addListener({
          message: (m) => {
            let info: unknown = m?.message;
            if (typeof info === "string") {
              try {
                info = JSON.parse(info);
              } catch {
                // leave as raw string
              }
            }
            onPaidRef.current(info);
          },
        });
        client.subscribe({ channels: [channel] });
      } catch {
        // PubNub init/subscribe failed — silently fall back to manual confirm
      }
    })();

    return () => {
      cancelled = true;
      try {
        client?.unsubscribeAll?.();
        client?.stop?.();
      } catch {
        // ignore teardown errors
      }
      client = null;
    };
  }, [active]);

  return (
    <Script src={PUBNUB_CDN} strategy="afterInteractive" />
  );
}
