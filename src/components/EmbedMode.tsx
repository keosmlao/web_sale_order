"use client";

import { useEffect } from "react";
import { useSearchParams } from "next/navigation";

// Marks the document when the page is being shown inside the Flutter app's
// sales tab (?embed=1). The app draws its own navigation rail, so the site's
// sidebar, logout button and bottom nav would be a second set of the same
// controls wrapped around the POS. CSS keyed on the attribute hides them —
// see `[data-embed="1"] .app-chrome` in globals.css.
//
// A client component because a server layout in Next 16 is not handed
// searchParams; only pages are.
export default function EmbedMode() {
  const params = useSearchParams();
  const embed = params.get("embed") === "1";

  useEffect(() => {
    const root = document.documentElement;
    if (embed) {
      root.setAttribute("data-embed", "1");
    } else {
      root.removeAttribute("data-embed");
    }
    return () => root.removeAttribute("data-embed");
  }, [embed]);

  return null;
}
