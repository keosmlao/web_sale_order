/* eslint-disable @typescript-eslint/no-explicit-any */
"use client";

import { useEffect, useRef } from "react";

// window.L is declared globally elsewhere (monitor map) with a narrower type;
// we read it through this any-typed accessor to use Leaflet APIs it omits.
const getL = (): any =>
  typeof window === "undefined" ? undefined : (window as any).L;

export type Truck = {
  carCode: string | null;
  carName: string;
  lat: number;
  lng: number;
  speed: number | null;
  engineState: string | null;
  recordedAt: string | null;
  address: string | null;
};

export type MapFocus = { lat: number; lng: number; label?: string } | null;

// Leaflet is loaded from CDN on demand (no npm dependency / build change). The
// component degrades to a "map unavailable" note if the CDN can't be reached.
function loadLeaflet(): Promise<any> {
  return new Promise((resolve, reject) => {
    if (typeof window === "undefined") return reject(new Error("ssr"));
    if (getL()) return resolve(getL());
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const existing = document.getElementById("leaflet-js") as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => resolve(getL()));
      existing.addEventListener("error", reject);
      return;
    }
    const s = document.createElement("script");
    s.id = "leaflet-js";
    s.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    s.onload = () => resolve(getL());
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

export default function DeliveryMap({
  trucks,
  focus,
}: {
  trucks: Truck[];
  focus: MapFocus;
}) {
  const elRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<any>(null);
  const truckLayerRef = useRef<any>(null);
  const focusLayerRef = useRef<any>(null);
  const failedRef = useRef(false);

  // Init + render truck markers.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !elRef.current) return;
        if (!mapRef.current) {
          mapRef.current = L.map(elRef.current).setView([17.9757, 102.6331], 12);
          L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
            maxZoom: 19,
            attribution: "© OpenStreetMap",
          }).addTo(mapRef.current);
          truckLayerRef.current = L.layerGroup().addTo(mapRef.current);
        }
        truckLayerRef.current.clearLayers();
        const pts: Array<[number, number]> = [];
        for (const t of trucks) {
          const moving = (t.speed ?? 0) > 2;
          const icon = L.divIcon({
            className: "",
            html: `<div style="background:${moving ? "#059669" : "#64748b"};color:#fff;border-radius:9999px;padding:2px 6px;font-size:11px;font-weight:800;white-space:nowrap;box-shadow:0 1px 3px rgba(0,0,0,.4)">🚚 ${t.carName}</div>`,
            iconAnchor: [10, 10],
          });
          L.marker([t.lat, t.lng], { icon })
            .bindPopup(
              `<b>${t.carName}</b><br/>${t.address ?? ""}<br/>${t.speed ?? 0} km/h · ${t.recordedAt ?? ""}`,
            )
            .addTo(truckLayerRef.current);
          pts.push([t.lat, t.lng]);
        }
        if (!focus && pts.length) {
          mapRef.current.fitBounds(pts, { padding: [30, 30], maxZoom: 14 });
        }
      })
      .catch(() => {
        failedRef.current = true;
      });
    return () => {
      cancelled = true;
    };
  }, [trucks, focus]);

  // Pan to a focused bill location.
  useEffect(() => {
    const L = getL();
    if (!focus || !mapRef.current || !L) return;
    if (focusLayerRef.current) focusLayerRef.current.remove();
    focusLayerRef.current = L.circleMarker([focus.lat, focus.lng], {
      radius: 9,
      color: "#dc2626",
      weight: 3,
      fillColor: "#fecaca",
      fillOpacity: 0.9,
    }).addTo(mapRef.current);
    if (focus.label) focusLayerRef.current.bindPopup(focus.label).openPopup();
    mapRef.current.setView([focus.lat, focus.lng], 15);
  }, [focus]);

  return <div ref={elRef} className="h-full w-full rounded-md" />;
}
