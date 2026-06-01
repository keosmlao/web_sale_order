"use client";

import { useEffect, useMemo, useRef, useState } from "react";

type Device = {
  employeeCode: string;
  name: string;
  role: string | null;
  online: boolean;
  lastSeenAt: string;
  secondsSinceSeen: number;
  platform: string | null;
  appVersion: string | null;
  deviceModel: string | null;
  osVersion: string | null;
  batteryPct: number | null;
  charging: boolean | null;
  currentScreen: string | null;
  lat: number | null;
  lng: number | null;
  locationAt: string | null;
};

type Feed = {
  serverTime: string;
  onlineThresholdSeconds: number;
  onlineCount: number;
  total: number;
  devices: Device[];
};

const POLL_MS = 15000;

function relTime(seconds: number): string {
  if (seconds < 30) return "ຕອນນີ້";
  if (seconds < 60) return `${seconds} ວິກ່ອນ`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m} ນາທີກ່ອນ`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} ຊມກ່ອນ`;
  const d = Math.floor(h / 24);
  return `${d} ມື້ກ່ອນ`;
}

function batteryTone(pct: number): string {
  if (pct <= 15) return "text-rose-600";
  if (pct <= 35) return "text-amber-600";
  return "text-emerald-600";
}

export default function MonitorClient() {
  const [feed, setFeed] = useState<Feed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [selected, setSelected] = useState<string | null>(null);

  // Poll the feed on an interval. The phones only report on activity, so the
  // dashboard does the live refreshing instead.
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    async function tick() {
      try {
        const res = await fetch("/api/monitor/devices", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as Feed;
        if (!cancelled) {
          setFeed(data);
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "ໂຫລດຂໍ້ມູນບໍ່ສຳເລັດ");
        }
      } finally {
        if (!cancelled) timer = setTimeout(tick, POLL_MS);
      }
    }
    void tick();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const devices = useMemo(() => {
    const list = feed?.devices ?? [];
    return onlineOnly ? list.filter((d) => d.online) : list;
  }, [feed, onlineOnly]);

  const located = useMemo(
    () => devices.filter((d) => d.lat != null && d.lng != null),
    [devices],
  );

  return (
    <div className="px-6 py-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-odoo-text-strong">
            ຕິດຕາມມືຖືພະນັກງານຂາຍ
          </h1>
          <p className="mt-1 text-sm text-odoo-text-muted">
            ສະຖານະ online, ຕຳແໜ່ງ, ແບັດເຕີຣີ ແລະ ໜ້າຈໍທີ່ກຳລັງໃຊ້ — ອັບເດດທຸກ{" "}
            {POLL_MS / 1000} ວິນາທີ.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-sm font-bold text-emerald-700">
            <span className="relative flex h-2.5 w-2.5">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-500" />
            </span>
            Online {feed?.onlineCount ?? 0}/{feed?.total ?? 0}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm font-semibold text-odoo-text-muted">
            <input
              type="checkbox"
              checked={onlineOnly}
              onChange={(e) => setOnlineOnly(e.target.checked)}
            />
            ສະເພາະ online
          </label>
        </div>
      </div>

      {error ? (
        <div className="odoo-alert-danger mb-4 px-3 py-2 text-sm">{error}</div>
      ) : null}

      <MonitorMap
        devices={located}
        selected={selected}
        onSelect={setSelected}
      />

      <div className="mt-5 overflow-hidden rounded border border-odoo-border bg-white">
        <table className="min-w-full text-sm">
          <thead className="bg-odoo-surface-muted text-left text-[11px] uppercase text-odoo-text-muted">
            <tr>
              <th className="px-4 py-3">ສະຖານະ</th>
              <th className="px-4 py-3">ພະນັກງານ</th>
              <th className="px-4 py-3">ໜ້າຈໍປະຈຸບັນ</th>
              <th className="px-4 py-3 text-center">ແບັດເຕີຣີ</th>
              <th className="px-4 py-3">ເຄື່ອງ</th>
              <th className="px-4 py-3">ເຫັນຫຼ້າສຸດ</th>
              <th className="px-4 py-3">ຕຳແໜ່ງ</th>
            </tr>
          </thead>
          <tbody>
            {devices.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-odoo-text-muted"
                >
                  {feed ? "ຍັງບໍ່ມີຂໍ້ມູນ" : "ກຳລັງໂຫລດ..."}
                </td>
              </tr>
            ) : (
              devices.map((d) => (
                <tr
                  key={d.employeeCode}
                  className={
                    "border-t border-odoo-border transition " +
                    (selected === d.employeeCode
                      ? "bg-odoo-primary-50"
                      : "hover:bg-odoo-surface-muted")
                  }
                  onClick={() =>
                    setSelected((s) =>
                      s === d.employeeCode ? null : d.employeeCode,
                    )
                  }
                >
                  <td className="px-4 py-3">
                    <span
                      className={
                        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10px] font-bold " +
                        (d.online
                          ? "bg-emerald-50 text-emerald-700"
                          : "bg-odoo-surface-muted text-odoo-text-muted")
                      }
                    >
                      <span
                        className={
                          "h-1.5 w-1.5 rounded-full " +
                          (d.online ? "bg-emerald-500" : "bg-odoo-text-muted")
                        }
                      />
                      {d.online ? "Online" : "Offline"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="font-semibold text-odoo-text-strong">
                      {d.name}
                    </div>
                    <div className="font-mono text-[11px] text-odoo-text-muted">
                      {d.employeeCode}
                      {d.role ? ` · ${d.role}` : ""}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {d.currentScreen ? (
                      <span className="inline-flex rounded bg-indigo-50 px-2 py-0.5 text-[11px] font-semibold text-indigo-700">
                        {d.currentScreen}
                      </span>
                    ) : (
                      <span className="text-odoo-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {d.batteryPct != null ? (
                      <span
                        className={
                          "inline-flex items-center gap-1 font-mono text-xs font-bold " +
                          batteryTone(d.batteryPct)
                        }
                      >
                        {d.charging ? "⚡" : ""}
                        {d.batteryPct}%
                      </span>
                    ) : (
                      <span className="text-odoo-text-muted">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-odoo-text">
                    <div className="font-medium text-odoo-text-strong">
                      {d.deviceModel ?? "—"}
                    </div>
                    <div className="text-[10px] text-odoo-text-muted">
                      {[d.platform, d.osVersion, d.appVersion ? `v${d.appVersion}` : null]
                        .filter(Boolean)
                        .join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-xs text-odoo-text-muted">
                    {relTime(d.secondsSinceSeen)}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {d.lat != null && d.lng != null ? (
                      <a
                        href={`https://www.google.com/maps?q=${d.lat},${d.lng}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="font-semibold text-odoo-primary hover:underline"
                      >
                        ເບິ່ງແຜນທີ່
                      </a>
                    ) : (
                      <span className="text-odoo-text-muted">ບໍ່ມີ GPS</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// Leaflet is loaded from CDN on demand so we don't pull a map dependency into
// the bundle. The map renders coloured dots (green = online) per located
// device; clicking a dot selects the matching table row and vice versa.
type LeafletMap = {
  setView: (c: [number, number], z: number) => LeafletMap;
  remove: () => void;
  fitBounds: (b: [number, number][], opts?: unknown) => void;
};
type LeafletLayer = {
  addTo: (m: LeafletMap) => LeafletLayer;
  bindPopup: (html: string) => LeafletLayer;
  on: (ev: string, cb: () => void) => LeafletLayer;
  openPopup: () => void;
};
type Leaflet = {
  map: (el: HTMLElement, opts?: unknown) => LeafletMap;
  tileLayer: (url: string, opts?: unknown) => LeafletLayer;
  circleMarker: (c: [number, number], opts?: unknown) => LeafletLayer;
};

declare global {
  interface Window {
    L?: Leaflet;
  }
}

function loadLeaflet(): Promise<Leaflet> {
  return new Promise((resolve, reject) => {
    if (window.L) {
      resolve(window.L);
      return;
    }
    if (!document.getElementById("leaflet-css")) {
      const link = document.createElement("link");
      link.id = "leaflet-css";
      link.rel = "stylesheet";
      link.href = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";
      document.head.appendChild(link);
    }
    const existing = document.getElementById(
      "leaflet-js",
    ) as HTMLScriptElement | null;
    if (existing) {
      existing.addEventListener("load", () => {
        if (window.L) resolve(window.L);
        else reject(new Error("Leaflet failed to load"));
      });
      return;
    }
    const script = document.createElement("script");
    script.id = "leaflet-js";
    script.src = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
    script.async = true;
    script.onload = () => {
      if (window.L) resolve(window.L);
      else reject(new Error("Leaflet failed to load"));
    };
    script.onerror = () => reject(new Error("Leaflet failed to load"));
    document.head.appendChild(script);
  });
}

function MonitorMap({
  devices,
  selected,
  onSelect,
}: {
  devices: Device[];
  selected: string | null;
  onSelect: (code: string | null) => void;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const markersRef = useRef<Map<string, LeafletLayer>>(new Map());
  const [ready, setReady] = useState(false);
  const onSelectRef = useRef(onSelect);
  useEffect(() => {
    onSelectRef.current = onSelect;
  }, [onSelect]);

  // Init the map once Leaflet is available.
  useEffect(() => {
    const markers = markersRef.current;
    let disposed = false;
    void loadLeaflet()
      .then((L) => {
        if (disposed || !containerRef.current || mapRef.current) return;
        const map = L.map(containerRef.current).setView([17.9757, 102.6331], 12);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "© OpenStreetMap",
        }).addTo(map);
        mapRef.current = map;
        setReady(true);
      })
      .catch(() => {
        // Map is best-effort; the table still shows everything.
      });
    return () => {
      disposed = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
      markers.clear();
    };
  }, []);

  // Re-draw markers whenever the located devices change.
  useEffect(() => {
    const map = mapRef.current;
    const L = typeof window !== "undefined" ? window.L : undefined;
    if (!map || !L || !ready) return;
    for (const marker of markersRef.current.values()) {
      (marker as unknown as { remove?: () => void }).remove?.();
    }
    markersRef.current.clear();
    const pts: [number, number][] = [];
    for (const d of devices) {
      if (d.lat == null || d.lng == null) continue;
      const pt: [number, number] = [d.lat, d.lng];
      pts.push(pt);
      const marker = L.circleMarker(pt, {
        radius: 8,
        color: d.online ? "#059669" : "#9ca3af",
        fillColor: d.online ? "#10b981" : "#d1d5db",
        fillOpacity: 0.9,
        weight: 2,
      })
        .addTo(map)
        .bindPopup(
          `<b>${escapeHtml(d.name)}</b><br/>${escapeHtml(
            d.currentScreen ?? "—",
          )}<br/>${relTime(d.secondsSinceSeen)}`,
        )
        .on("click", () => onSelectRef.current(d.employeeCode));
      markersRef.current.set(d.employeeCode, marker);
    }
    if (pts.length > 0) {
      map.fitBounds(pts, { padding: [40, 40], maxZoom: 15 });
    }
  }, [devices, ready]);

  // Open the popup of the selected device.
  useEffect(() => {
    if (!selected) return;
    const marker = markersRef.current.get(selected);
    marker?.openPopup();
  }, [selected]);

  return (
    <div className="overflow-hidden rounded border border-odoo-border bg-white">
      <div
        ref={containerRef}
        className="h-[360px] w-full"
        style={{ background: "#e5e7eb" }}
      />
      {devices.length === 0 ? (
        <div className="border-t border-odoo-border px-4 py-2 text-center text-xs text-odoo-text-muted">
          ຍັງບໍ່ມີຕຳແໜ່ງ GPS ຈາກເຄື່ອງໃດ
        </div>
      ) : null}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
