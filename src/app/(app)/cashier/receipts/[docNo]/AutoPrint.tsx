"use client";

import { useEffect } from "react";

// Mounted when the page is opened with ?print=1 — the ພິມ button in the
// receipt list. The browser's print dialog opens as soon as the receipt
// has rendered, so "print" is one tap, not tap-then-find-the-button.
export default function AutoPrint() {
  useEffect(() => {
    const t = setTimeout(() => window.print(), 250);
    return () => clearTimeout(t);
  }, []);
  return null;
}
